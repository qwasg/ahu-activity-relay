import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";
import { db, json } from "../../../../packages/db/src/index.js";
import { Storage, type StoredFile } from "../../../../packages/storage/src/index.js";
import { acceptSubmission } from "../../../api/src/modules/submissions/service.js";
import { isSystemMail } from "./outbound.js";
import type { Config } from "../../../api/src/config.js";

export function parseSubmissionMail(subject: string, text: string, email: string) {
  const match = subject.match(/^\[([a-z0-9-]+)\]\s+([A-Za-z0-9_-]{3,30})\s+(.{1,60})$/);
  if (!match) throw new Error("投稿标题应为 [活动标识] 学号 姓名");
  const field = (name: string) => text.match(new RegExp(`^${name}[：:]\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  return {
    activitySlug: match[1], studentId: match[2], name: match[3].trim(), email,
    department: field("院系"), major: field("专业"), className: field("班级"),
    text: text.split(/作品说明[：:]/)[1]?.trim() ?? "",
    link: field("作品链接"), consent: /^同意邮箱归档和AI分析[：:]\s*是\s*$/m.test(text),
  };
}
export async function ingestMail(raw: Buffer, metadata: { mailbox: string; uidValidity: string; uid: number; receivedAt: Date }, config: Config, storage: Storage) {
  const unique = { mailbox_uidValidity_uid: { mailbox: metadata.mailbox, uidValidity: metadata.uidValidity, uid: metadata.uid } };
  if (await db.inboundMail.findUnique({ where: unique })) return;
  const mail = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  if (await isSystemMail(mail.messageId, mail.headers.get("x-ahu-signature"), config)) {
    await db.inboundMail.create({ data: { ...metadata, messageId: mail.messageId, status: "system" } }); return;
  }
  const hash = createHash("sha256").update(raw).digest("hex");
  const duplicate = await db.inboundMail.findFirst({ where: { messageId: mail.messageId ?? null, hash, status: "accepted" } });
  if (duplicate) {
    await db.inboundMail.create({ data: { ...metadata, messageId: mail.messageId, hash, status: "duplicate", submissionId: duplicate.submissionId } }); return;
  }
  const activities = await db.activity.findMany({ select: { slug: true } });
  const subject = mail.subject ?? "";
  const related = activities.some(a => subject.includes(a.slug));
  if (!related) {
    await db.inboundMail.create({ data: { ...metadata, status: "unrelated", messageId: mail.messageId } }); return;
  }
  const files: StoredFile[] = [];
  let retained = false;
  try {
    const input = parseSubmissionMail(subject, mail.text ?? "", mail.from?.value[0]?.address ?? "");
    for (const a of mail.attachments) {
      if (files.length >= 5) throw new Error("附件超过5个");
      files.push(await storage.put(a.content, a.filename ?? "", a.contentType));
    }
    const result = await acceptSubmission(input, files, `mail:${metadata.mailbox}:${hash}`, { source: "mail", receivedAt: metadata.receivedAt });
    retained = !result.reused;
    await db.inboundMail.create({ data: { ...metadata, messageId: mail.messageId, hash, status: "accepted", submissionId: result.submission.id } });
  } catch (e) {
    const saved = await storage.putRaw(raw, "message.eml", "message/rfc822");
    await db.inboundMail.create({ data: { ...metadata, messageId: mail.messageId, hash, status: "pending", rawKey: saved.key,
      error: `${subject.slice(0, 150)}: ${e instanceof Error ? e.message.slice(0, 500) : "解析失败"}` } });
  } finally { if (!retained) await Promise.all(files.map(f => storage.remove(f.key))); }
}
export async function pollMailbox(config: Config, storage: Storage) {
  if (!config.MAIL_ENABLED) return;
  const mailbox = `${config.MAIL_USER}/${config.IMAP_FOLDER}`;
  const client = new ImapFlow({ host: config.IMAP_HOST, port: config.IMAP_PORT, secure: config.IMAP_SECURE,
    auth: { user: config.IMAP_USER || config.MAIL_USER, pass: config.MAIL_PASSWORD }, logger: false, connectionTimeout: 15000, socketTimeout: 60000 });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.IMAP_FOLDER);
    try {
      if (!client.mailbox) throw new Error("MAILBOX_MISSING");
      const validity = String(client.mailbox.uidValidity);
      const previous = await db.mailCursor.findUnique({ where: { mailbox } });
      const since = previous?.since ?? (config.IMAP_SINCE ? new Date(config.IMAP_SINCE) : new Date(new Date().setHours(0, 0, 0, 0)));
      const from = previous?.uidValidity === validity ? previous.uid + 1 : 1;
      const uids = await client.search({ since, uid: `${from}:*` }, { uid: true });
      for (const uid of uids || []) {
        if (uid < from) continue;
        const meta = await client.fetchOne(uid, { size: true, internalDate: true }, { uid: true });
        if (!meta) continue;
        const receivedAt = new Date(meta.internalDate ?? Date.now());
        if (meta.size && meta.size > 22 * 1024 ** 2) {
          await db.inboundMail.upsert({ where: { mailbox_uidValidity_uid: { mailbox, uidValidity: validity, uid } }, update: {}, create: { mailbox, uidValidity: validity, uid, receivedAt, status: "pending", error: "邮件超过22 MiB，请在邮箱中人工查看" } });
        } else {
          const message = await client.fetchOne(uid, { source: true }, { uid: true });
          if (message && message.source) await ingestMail(message.source, { mailbox, uidValidity: validity, uid, receivedAt }, config, storage);
        }
        await db.mailCursor.upsert({ where: { mailbox }, create: { mailbox, uidValidity: validity, uid, since }, update: { uidValidity: validity, uid } });
      }
    } finally { lock.release(); }
    await db.serviceState.upsert({ where: { key: "imap" }, create: { key: "imap", value: { ok: true } }, update: { value: { ok: true } } });
  } catch (e) {
    await db.serviceState.upsert({ where: { key: "imap" }, create: { key: "imap", value: json({ ok: false, code: (e as { code?: string }).code ?? "IMAP_FAILED" }) }, update: { value: json({ ok: false, code: (e as { code?: string }).code ?? "IMAP_FAILED" }) } });
  } finally { await client.logout().catch(() => client.close()); }
}
