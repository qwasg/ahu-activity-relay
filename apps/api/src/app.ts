import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { verify } from "argon2";
import { randomBytes, createHash } from "node:crypto";
import { z, ZodError } from "zod";
import { db, json, activityLock } from "../../../packages/db/src/index.js";
import { AppError, ruleSchema, limits } from "../../../packages/contracts/src/index.js";
import { scoreTotal } from "../../../packages/domain/src/index.js";
import { Storage, type StoredFile } from "../../../packages/storage/src/index.js";
import { acceptSubmission } from "./modules/submissions/service.js";
import { parseRoster } from "./modules/roster/index.js";
import { preview, publish } from "./modules/results/service.js";
import { renderReport, type ReportData } from "./modules/reports/index.js";
import type { Config } from "./config.js";
import { simpleParser } from "mailparser";
import { parseSubmissionMail } from "../../worker/src/mail/inbound.js";

const hashToken = (s: string) => createHash("sha256").update(s).digest("hex");
const idParams = z.object({ id: z.string().min(1).max(100) });
export async function buildApp(config: Config) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.body", "res.headers.authorization"] }, disableRequestLogging: true, bodyLimit: 16 * 1024 ** 2,
    trustProxy: config.TRUST_PROXY_CIDRS ? config.TRUST_PROXY_CIDRS.split(",").map(s => s.trim()) : false });
  const storage = new Storage(config.STORAGE_DIR);
  await app.register(cors, { origin: config.ALLOWED_ORIGINS.split(",").map(s => s.trim()) });
  await app.register(helmet);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: limits.file, files: 5, fields: 12, fieldSize: 100000, parts: 17 } });
  await app.register(swagger, { openapi: { info: { title: "AHU 活动邮箱转接 API", version: "1.0.0" } } });
  app.setErrorHandler((error, request, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    const status = e instanceof ZodError ? 422 : e.statusCode ?? 500;
    if (status >= 500) request.log.error({ code: e.code ?? "INTERNAL", requestId: request.id }, "请求失败");
    reply.code(status).send({ code: e instanceof ZodError ? "VALIDATION" : e.code ?? "INTERNAL", message: status >= 500 ? "服务暂时不可用，请联系管理员" : e.message, requestId: request.id, ...(e instanceof AppError && e.details ? { details: e.details } : {}) });
  });
  app.get("/health/live", async () => ({ ok: true }));
  app.get("/health/ready", async (_, reply) => {
    await db.$queryRaw`SELECT 1`;
    const heartbeat = await db.serviceState.findUnique({ where: { key: "worker" } });
    const ready = !!heartbeat && Date.now() - heartbeat.updatedAt.getTime() < 120000;
    return reply.code(ready ? 200 : 503).send({ database: true, worker: ready });
  });
  app.get("/api/v1/activities", async () => db.activity.findMany({ select: { id: true, slug: true, title: true, description: true, startsAt: true, endsAt: true, registrationStart: true, registrationEnd: true, groups: true, rules: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { startsAt: "asc" } }));
  app.get("/api/v1/activities/:slug", async request => {
    const { slug } = z.object({ slug: z.string() }).parse(request.params);
    const a = await db.activity.findUnique({ where: { slug }, select: { id: true, slug: true, title: true, description: true, startsAt: true, endsAt: true, registrationStart: true, registrationEnd: true, groups: true, rules: { orderBy: { version: "desc" }, take: 1 } } });
    if (!a) throw new AppError(404, "ACTIVITY", "活动不存在");
    return { ...a, mailbox: config.MAIL_USER };
  });
  app.post("/api/v1/submissions", { config: { rateLimit: { max: config.UPLOAD_IP_LIMIT, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const key = z.string().uuid().parse(request.headers["idempotency-key"]);
    const fields: Record<string, unknown> = {};
    const files: StoredFile[] = [];
    let retained = false;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const data = await part.toBuffer();
          if (part.file.truncated) throw new AppError(413, "FILE_SIZE", "文件过大");
          files.push(await storage.put(data, part.filename, part.mimetype));
          if (files.reduce((s, f) => s + f.size, 0) > limits.total) throw new AppError(413, "FILES_SIZE", "附件合计不能超过15 MiB");
        } else {
          if (part.fieldname in fields) throw new AppError(422, "DUPLICATE_FIELD", "字段重复");
          fields[part.fieldname] = part.value;
        }
      }
      fields.consent = fields.consent === "true";
      const result = await acceptSubmission(fields, files, key, { dailyLimit: config.SUBMISSION_DAILY_LIMIT });
      retained = !result.reused;
      return reply.code(202).send({ id: result.submission.id, receiptToken: result.submission.receiptToken, late: result.submission.late });
    } finally { if (!retained) await Promise.all(files.map(f => storage.remove(f.key))); }
  });
  app.get("/api/v1/receipts/:token", async request => {
    const { token } = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).parse(request.params);
    const s = await db.submission.findUnique({ where: { receiptToken: token }, select: { status: true } });
    if (!s) throw new AppError(404, "RECEIPT", "收件凭证不存在");
    return { status: s.status === "failed" ? "需联系管理员" : s.status === "reviewed" ? "已处理" : "已接收，待处理" };
  });
  await app.register(async admin => {
    admin.addHook("preHandler", async request => {
      if (request.routeOptions.url === "/api/v1/admin/login") return;
      const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const session = token ? await db.adminSession.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
      if (!session || session.expiresAt <= new Date()) throw new AppError(401, "AUTH", "请重新登录");
      (request as typeof request & { adminId: string }).adminId = session.adminId;
    });
    const who = (r: unknown) => (r as { adminId: string }).adminId;
    admin.post("/login", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async request => {
      const input = z.object({ username: z.string().max(100), password: z.string().max(500) }).parse(request.body);
      const user = await db.admin.findUnique({ where: { username: input.username } });
      if (!user || !await verify(user.passwordHash, input.password)) throw new AppError(401, "LOGIN", "用户名或密码错误");
      const token = randomBytes(32).toString("hex");
      await db.adminSession.create({ data: { tokenHash: hashToken(token), adminId: user.id, expiresAt: new Date(Date.now() + 3600000) } });
      return { token, expiresIn: 3600 };
    });
    admin.post("/logout", async request => {
      await db.adminSession.deleteMany({ where: { tokenHash: hashToken(request.headers.authorization!.slice(7)) } });
      return { ok: true };
    });
    admin.get("/openapi", async () => app.swagger());
    admin.get("/activities/:id/submissions", async request => {
      const { id } = idParams.parse(request.params);
      const q = z.object({ page: z.coerce.number().int().min(1).default(1), status: z.string().optional(), studentId: z.string().optional() }).parse(request.query);
      const where = { activityId: id, ...(q.status ? { status: q.status } : {}), ...(q.studentId ? { studentId: q.studentId } : {}) };
      return { total: await db.submission.count({ where }), items: await db.submission.findMany({ where, take: 50, skip: (q.page - 1) * 50, orderBy: { receivedAt: "desc" }, include: { review: true } }) };
    });
    admin.get("/submissions/:id", async request => {
      const { id } = idParams.parse(request.params);
      const s = await db.submission.findUnique({ where: { id }, include: { attachments: true, review: true, aiReview: true, activity: { include: { rules: { orderBy: { version: "desc" }, take: 1 } } } } });
      if (!s) throw new AppError(404, "SUBMISSION", "提交不存在");
      return { ...s, candidates: await db.submission.findMany({ where: { activityId: s.activityId, studentId: s.studentId }, select: { id: true, name: true, email: true, receivedAt: true, review: true } }),
        roster: await db.rosterEntry.findUnique({ where: { activityId_studentId: { activityId: s.activityId, studentId: s.studentId } } }) };
    });
    admin.get("/attachments/:id/download", async (request, reply) => {
      const file = await db.attachment.findUnique({ where: idParams.parse(request.params) });
      if (!file) throw new AppError(404, "FILE", "附件不存在");
      return reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`).type("application/octet-stream").send(await storage.read(file.key));
    });
    for (const action of ["preview", "import"]) admin.post(`/activities/:id/roster/${action}`, async request => {
      const { id } = idParams.parse(request.params);
      const part = await request.file({ limits: { fileSize: 2 * 1024 ** 2, files: 1 } });
      if (!part) throw new AppError(422, "ROSTER", "请选择名单文件");
      const buffer = await part.toBuffer();
      if (part.file.truncated) throw new AppError(413, "ROSTER", "名单文件过大");
      const parsed = await parseRoster(buffer, part.filename);
      if (action === "preview") return parsed;
      if (parsed.errors.length) throw new AppError(422, "ROSTER", "名单存在错误", parsed.errors);
      await db.$transaction(async tx => {
        await activityLock(tx, id);
        for (const entry of parsed.entries) await tx.rosterEntry.upsert({ where: { activityId_studentId: { activityId: id, studentId: entry.studentId } }, update: entry, create: { ...entry, activityId: id } });
        await tx.activity.update({ where: { id }, data: { revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { adminId: who(request), action: "roster-import", targetId: id, details: { count: parsed.entries.length } } });
      }, { timeout: 60000 });
      return { imported: parsed.entries.length };
    });
    admin.get("/activities/:id/roster", async request => db.rosterEntry.findMany({ where: { activityId: idParams.parse(request.params).id }, orderBy: { studentId: "asc" } }));
    admin.put("/activities/:id/rules", async request => {
      const { id } = idParams.parse(request.params);
      const input = z.object({ config: ruleSchema, invalidateReviews: z.boolean().default(false) }).parse(request.body);
      return db.$transaction(async tx => {
        await activityLock(tx, id);
        const a = await tx.activity.findUniqueOrThrow({ where: { id }, include: { rules: { orderBy: { version: "desc" }, take: 1 } } });
        if (new Date() >= a.startsAt && !input.invalidateReviews) throw new AppError(409, "RULES_LOCKED", "活动已开始，必须明确确认所有旧审核失效");
        const rule = await tx.ruleVersion.create({ data: { activityId: id, version: a.rules[0].version + 1, config: json(input.config) } });
        await tx.activity.update({ where: { id }, data: { revision: { increment: 1 }, tieDecisions: [] } });
        const submissions = await tx.submission.findMany({ where: { activityId: id } });
        for (const s of submissions) await tx.outboxEvent.create({ data: { key: `grade:${s.id}:rule:${rule.version}`, kind: "grade", targetId: s.id } });
        await tx.auditLog.create({ data: { adminId: who(request), action: "rules-change", targetId: id, details: { version: rule.version } } });
        return rule;
      });
    });
    admin.put("/submissions/:id/review", async request => {
      const { id } = idParams.parse(request.params);
      const input = z.object({ version: z.number().int(), scores: z.record(z.string(), z.number()), eligible: z.boolean(), excluded: z.boolean(), identityConfirmed: z.boolean(), lateApproved: z.boolean().default(false), note: z.string().min(1).max(4000), archiveWaiver: z.string().max(2000).default("") }).parse(request.body);
      return db.$transaction(async tx => {
        const s = await tx.submission.findUniqueOrThrow({ where: { id } });
        await activityLock(tx, s.activityId);
        const current = await tx.ruleVersion.findFirstOrThrow({ where: { activityId: s.activityId }, orderBy: { version: "desc" } });
        if (!input.excluded) scoreTotal(ruleSchema.parse(current.config), input.scores);
        const updated = await tx.submission.updateMany({ where: { id, version: input.version }, data: { version: { increment: 1 }, status: "reviewed", archiveWaiver: input.archiveWaiver || null } });
        if (!updated.count) throw new AppError(409, "VERSION", "该作品已被修改，请刷新");
        const { version: _, archiveWaiver: __, ...review } = input;
        const data = { ...review, scores: json(review.scores), ruleVersion: current.version, adminId: who(request) };
        await tx.humanReview.upsert({ where: { submissionId: id }, update: data, create: { submissionId: id, ...data } });
        await tx.activity.update({ where: { id: s.activityId }, data: { revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { adminId: who(request), action: "review", targetId: id, details: json(input) } });
        return { ok: true, version: input.version + 1 };
      });
    });
    admin.post("/activities/:id/results/preview", async request => db.$transaction(tx => preview(tx, idParams.parse(request.params).id), { isolationLevel: "RepeatableRead" }));
    admin.post("/activities/:id/tie-decisions", async request => {
      const { id } = idParams.parse(request.params);
      const decisions = z.array(z.object({ ids: z.array(z.string()).min(2), reason: z.string().min(1).max(2000) })).parse(request.body);
      return db.$transaction(async tx => {
        await activityLock(tx, id);
        await tx.activity.update({ where: { id }, data: { tieDecisions: json(decisions), revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { adminId: who(request), action: "tie-decisions", targetId: id, details: json(decisions) } });
        return { ok: true };
      });
    });
    admin.post("/activities/:id/results/publish", async request => {
      const { fingerprint, idempotencyKey } = z.object({ fingerprint: z.string(), idempotencyKey: z.string().uuid() }).parse(request.body);
      return publish(idParams.parse(request.params).id, fingerprint, idempotencyKey, who(request));
    });
    admin.get("/activities/:id/results", async request => db.resultSnapshot.findMany({ where: { activityId: idParams.parse(request.params).id }, orderBy: { version: "desc" }, select: { id: true, version: true, createdAt: true } }));
    admin.get("/results/:id/export", async (request, reply) => {
      const { format } = z.object({ format: z.enum(["html", "csv", "xlsx"]) }).parse(request.query);
      const s = await db.resultSnapshot.findUniqueOrThrow({ where: idParams.parse(request.params) });
      return reply.header("Content-Disposition", `attachment; filename="results-v${s.version}.${format}"`).type(format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : format === "html" ? "text/html; charset=utf-8" : "text/csv; charset=utf-8").send(await renderReport(s.data as unknown as ReportData, s.version, format));
    });
    admin.post("/results/:id/email", async request => {
      const { id } = idParams.parse(request.params);
      await db.resultSnapshot.findUniqueOrThrow({ where: { id } });
      return db.outboxEvent.create({ data: { key: `report:${id}:${randomBytes(8).toString("hex")}`, kind: "report", targetId: id } });
    });
    admin.get("/operations", async () => ({
      services: await db.serviceState.findMany(), configuration: { mailEnabled: config.MAIL_ENABLED, aiEnabled: config.AI_ENABLED, model: config.OPENAI_MODEL },
      jobs: await db.outboxEvent.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
      mails: await db.outboundMail.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
      inbound: await db.inboundMail.findMany({ where: { status: "pending" }, take: 100 }),
      audit: await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      usage: await db.aIReview.findMany({ select: { submissionId: true, model: true, usage: true, createdAt: true }, take: 100, orderBy: { createdAt: "desc" } }),
    }));
    admin.post("/jobs/:id/retry", async request => {
      const { id } = idParams.parse(request.params);
      const job = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
      if (!["failed", "blocked"].includes(job.status)) throw new AppError(409, "JOB", "仅可重试失败或等待配置的任务");
      await db.outboxEvent.update({ where: { id }, data: { status: "pending", error: null } });
      return { ok: true };
    });
    admin.post("/ai/resume", async request => {
      await db.serviceState.upsert({ where: { key: "ai-paused" }, create: { key: "ai-paused", value: { paused: false } }, update: { value: { paused: false } } });
      await db.auditLog.create({ data: { adminId: who(request), action: "ai-resume", targetId: "ai", details: {} } });
      return { ok: true };
    });
    admin.post("/mails/:id/resolve", async request => {
      const { id } = idParams.parse(request.params);
      const { action, reason } = z.object({ action: z.enum(["retry", "sent"]), reason: z.string().min(1).max(2000) }).parse(request.body);
      const mail = await db.outboundMail.findUniqueOrThrow({ where: { id } });
      if (!["failed", "uncertain", "retry"].includes(mail.status)) throw new AppError(409, "MAIL_STATE", "当前邮件状态无需人工处理");
      await db.outboundMail.update({ where: { id }, data: { status: action === "sent" ? "sent" : "pending", nextAt: new Date(), error: null, attempts: 0 } });
      if (action === "sent" && mail.kind === "archive" && !await db.outboundMail.count({ where: { targetId: mail.targetId, kind: "archive", status: { not: "sent" } } })) await db.submission.update({ where: { id: mail.targetId }, data: { archiveStatus: "sent" } });
      await db.auditLog.create({ data: { adminId: who(request), action: `mail-${action}`, targetId: id, details: { reason } } });
      return { ok: true };
    });
    admin.get("/inbound/:id", async request => {
      const row = await db.inboundMail.findUniqueOrThrow({ where: idParams.parse(request.params) });
      if (!row.rawKey) return { ...row, rawAvailable: false };
      const mail = await simpleParser(await storage.read(row.rawKey), { skipHtmlToText: true, skipTextToHtml: true });
      let suggested: unknown;
      try { suggested = parseSubmissionMail(mail.subject ?? "", mail.text ?? "", mail.from?.value[0]?.address ?? ""); } catch { suggested = { email: mail.from?.value[0]?.address ?? "", text: mail.text ?? "" }; }
      return { ...row, subject: mail.subject, suggested, filenames: mail.attachments.map(a => a.filename) };
    });
    admin.post("/inbound/:id/resolve", async request => {
      const row = await db.inboundMail.findUniqueOrThrow({ where: idParams.parse(request.params) });
      const input = z.object({ action: z.enum(["reject", "accept"]), reason: z.string().min(1).max(2000), submission: z.unknown().optional() }).parse(request.body);
      if (row.status !== "pending") throw new AppError(409, "INBOUND", "该邮件已处理");
      if (input.action === "reject") {
        await db.inboundMail.update({ where: { id: row.id }, data: { status: "rejected", error: input.reason } });
      } else {
        if (!row.rawKey) throw new AppError(422, "INBOUND", "原邮件过大，请人工处理并明确排除");
        const mail = await simpleParser(await storage.read(row.rawKey), { skipHtmlToText: true, skipTextToHtml: true });
        const files: StoredFile[] = [];
        let retained = false;
        try {
          for (const a of mail.attachments) {
            if (files.length >= limits.count) throw new AppError(413, "FILES", "附件过多");
            files.push(await storage.put(a.content, a.filename ?? "", a.contentType));
          }
          const result = await acceptSubmission(input.submission, files, `resolved-mail:${row.id}`, { source: "mail", receivedAt: row.receivedAt });
          retained = !result.reused;
          await db.inboundMail.update({ where: { id: row.id }, data: { status: "accepted", submissionId: result.submission.id, error: null } });
        } finally { if (!retained) await Promise.all(files.map(f => storage.remove(f.key))); }
      }
      await db.auditLog.create({ data: { adminId: who(request), action: `inbound-${input.action}`, targetId: row.id, details: { reason: input.reason } } });
      return { ok: true };
    });
  }, { prefix: "/api/v1/admin" });
  return app;
}
