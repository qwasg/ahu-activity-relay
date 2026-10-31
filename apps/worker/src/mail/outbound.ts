import { createHmac, createHash } from "node:crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { db, json } from "../../../../packages/db/src/index.js";
import { Storage } from "../../../../packages/storage/src/index.js";
import { renderReport, escapeHtml, type ReportData } from "../../../api/src/modules/reports/index.js";
import type { Config } from "../../../api/src/config.js";

type Attachment = { filename: string; content: Buffer; contentType?: string };
const sign = (id: string, secret: string) => createHmac("sha256", secret).update(id).digest("hex");
export function splitAttachments(attachments: Attachment[], maxBytes = 19 * 1024 ** 2) {
  const parts: Attachment[][] = [[]];
  let size = 100000;
  for (const a of attachments) {
    const encoded = Math.ceil(a.content.length / 3) * 4 * 1.04 + 4096;
    if (encoded > maxBytes - 100000) throw new Error("单个附件超过邮件编码上限");
    if (size + encoded > maxBytes) { parts.push([]); size = 100000; }
    parts.at(-1)!.push(a); size += encoded;
  }
  return parts;
}
export async function prepareMail(kind: string, targetId: string, storage: Storage) {
  if (kind === "archive") {
    const s = await db.submission.findUniqueOrThrow({ where: { id: targetId }, include: { attachments: true, activity: true } });
    const text = `原件归档 ${s.id}\n活动：${s.activity.title}\n学号：${s.studentId}\n姓名：${s.name}\n院系：${s.department}\n专业：${s.major}\n班级：${s.className}\n邮箱：${s.email}\n接收：${s.receivedAt.toISOString()}\n链接：${s.link}\n\n${s.text}`;
    const attachments = await Promise.all(s.attachments.map(async a => ({ filename: a.name, content: await storage.read(a.key), contentType: a.mime })));
    attachments.unshift({ filename: "submission.txt", content: Buffer.from(text), contentType: "text/plain" });
    return { subject: `[AHU-SYSTEM][原件归档] ${s.id}`, text, html: `<h1>作业原件归档</h1><pre>${escapeHtml(text)}</pre>`, attachments };
  }
  if (kind === "draft") {
    const s = await db.submission.findUniqueOrThrow({ where: { id: targetId }, include: { aiReview: true } });
    const text = `AI 评分草稿，未经人工审核，不代表最终成绩。\n提交编号：${s.id}\n${JSON.stringify(s.aiReview?.result ?? {}, null, 2)}`;
    const html = `<!doctype html><meta charset="utf-8"><h1>AI 评分建议 · 待审核</h1><pre>${escapeHtml(text)}</pre>`;
    return { subject: `[AHU-SYSTEM][待审核] ${s.id}`, text, html, attachments: [{ filename: "draft.html", content: Buffer.from(html), contentType: "text/html" }] };
  }
  const s = await db.resultSnapshot.findUniqueOrThrow({ where: { id: targetId } });
  const data = s.data as unknown as ReportData;
  const attachments: Attachment[] = [];
  for (const format of ["html", "xlsx", "csv"] as const) attachments.push({ filename: `${data.slug}-v${s.version}.${format}`, content: await renderReport(data, s.version, format) });
  const manifest = attachments.map(a => `${a.filename} SHA256 ${createHash("sha256").update(a.content).digest("hex")}`).join("\n");
  return { subject: `[AHU-SYSTEM][正式结果 v${s.version}] ${data.title}`, text: `已发布，详见附件。系统记录不等于学校官方入账。\n${manifest}`, html: `<h1>${escapeHtml(data.title)}</h1><p>正式版本 ${s.version}，完整结果见附件。</p><p>系统记录不等于学校官方入账。</p><pre>${escapeHtml(manifest)}</pre>`, attachments };
}
export async function enqueueMail(event: { key: string; kind: string; targetId: string }, config: Config, storage: Storage) {
  const content = await prepareMail(event.kind, event.targetId, storage);
  const groups = splitAttachments(content.attachments);
  for (let i = 0; i < groups.length; i++) {
    const eventKey = `${event.key}:part:${i}`;
    const messageId = `<${createHash("sha256").update(eventKey).digest("hex")}@ahu-relay.local>`;
    await db.outboundMail.upsert({ where: { eventKey }, update: {}, create: { eventKey, kind: event.kind, targetId: event.targetId, recipient: event.kind === "archive" ? config.MAIL_USER : config.REPORT_EMAIL, messageId } });
  }
}
export async function deliverNext(config: Config, storage: Storage) {
  if (!config.MAIL_ENABLED) return;
  const row = await db.outboundMail.findFirst({ where: { status: { in: ["pending", "retry"] }, nextAt: { lte: new Date() } }, orderBy: { nextAt: "asc" } });
  if (!row) return;
  const acquired = await db.outboundMail.updateMany({ where: { id: row.id, status: row.status }, data: { status: "sending", attempts: { increment: 1 } } });
  if (!acquired.count) return;
  try {
    const content = await prepareMail(row.kind, row.targetId, storage);
    const groups = splitAttachments(content.attachments);
    const index = Number(row.eventKey.match(/:part:(\d+)$/)?.[1] ?? 0);
    const raw = await new MailComposer({
      from: config.MAIL_USER, to: row.recipient, subject: `${content.subject} (${index + 1}/${groups.length})`,
      messageId: row.messageId, headers: { "X-AHU-Signature": sign(row.messageId, config.MAIL_SIGNATURE_SECRET) },
      text: content.text, html: content.html, attachments: groups[index],
    }).compile().build();
    if (raw.length > 20 * 1024 ** 2) throw Object.assign(new Error("MIME_SIZE"), { code: "MIME_SIZE" });
    const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
      ...(config.MAIL_PASSWORD ? { auth: { user: config.MAIL_USER, pass: config.MAIL_PASSWORD } } : {}),
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000 });
    try { await transport.sendMail({ envelope: { from: config.MAIL_USER, to: [row.recipient] }, raw }); } finally { transport.close(); }
    await db.outboundMail.update({ where: { id: row.id }, data: { status: "sent", error: null } });
    if (row.kind === "archive") {
      const remaining = await db.outboundMail.count({ where: { kind: "archive", targetId: row.targetId, status: { not: "sent" } } });
      if (!remaining) await db.submission.update({ where: { id: row.targetId }, data: { archiveStatus: "sent" } });
    }
  } catch (error) {
    const e = error as { code?: string; command?: string };
    const uncertain = ["ETIMEDOUT", "ESOCKET", "ECONNRESET"].includes(e.code ?? "") && !["CONN", "AUTH"].includes(e.command ?? "");
    const delays = [60, 300, 1800, 7200, 21600];
    const delay = delays[row.attempts];
    await db.outboundMail.update({ where: { id: row.id }, data: {
      status: uncertain ? "uncertain" : delay && e.code !== "MIME_SIZE" ? "retry" : "failed",
      error: e.code ?? "SMTP_FAILED", nextAt: new Date(Date.now() + (delay ?? 0) * 1000),
    } });
    await db.serviceState.upsert({ where: { key: "smtp" }, create: { key: "smtp", value: json({ ok: false, code: e.code ?? "SMTP_FAILED" }) }, update: { value: json({ ok: false, code: e.code ?? "SMTP_FAILED" }) } });
  }
}
export async function isSystemMail(messageId: string | undefined, signature: unknown, config: Config) {
  if (!messageId || typeof signature !== "string" || signature !== sign(messageId, config.MAIL_SIGNATURE_SECRET)) return false;
  return !!await db.outboundMail.findUnique({ where: { messageId } });
}
