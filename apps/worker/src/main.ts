import PgBoss from "pg-boss";
import { db, json } from "../../../packages/db/src/index.js";
import { Storage } from "../../../packages/storage/src/index.js";
import { loadConfig } from "../../api/src/config.js";
import { enqueueMail, deliverNext } from "./mail/outbound.js";
import { pollMailbox } from "./mail/inbound.js";
import { gradeSubmission } from "./grading/index.js";

const config = loadConfig(), storage = new Storage(config.STORAGE_DIR);
const boss = new PgBoss({ connectionString: config.DATABASE_URL, retryLimit: 0 });
boss.on("error", error => console.error("队列错误", (error as { code?: string }).code ?? "QUEUE_ERROR"));
await boss.start();
for (const queue of ["relay-grade", "relay-mail"]) await boss.createQueue(queue);
async function processEvent(id: string) {
  const acquired = await db.outboxEvent.updateMany({ where: { id, status: "queued" }, data: { status: "running", attempts: { increment: 1 } } });
  if (!acquired.count) return;
  const event = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
  try {
    if (event.kind === "grade") await gradeSubmission(event.targetId, config, storage);
    else {
      if (!config.MAIL_ENABLED) throw Object.assign(new Error("邮箱未启用或缺少新授权码"), { blocked: true });
      await enqueueMail(event, config, storage);
    }
    await db.outboxEvent.update({ where: { id }, data: { status: "completed", error: null } });
  } catch (error) {
    const e = error as { blocked?: boolean; status?: number; code?: string; message?: string };
    await db.outboxEvent.update({ where: { id }, data: { status: e.blocked ? "blocked" : "failed", error: e.blocked ? e.message : `处理失败 ${e.status ?? e.code ?? "PROCESSING_ERROR"}；可人工重试或直接审核` } });
    if (event.kind === "grade" && !e.blocked) await db.submission.updateMany({ where: { id: event.targetId, status: { not: "reviewed" } }, data: { status: "failed" } });
  }
}
for (let i = 0; i < 2; i++) await boss.work<{ id: string }>("relay-grade", { batchSize: 1 }, async jobs => { for (const job of jobs) await processEvent(job.data.id); });
await boss.work<{ id: string }>("relay-mail", { batchSize: 1 }, async jobs => { for (const job of jobs) await processEvent(job.data.id); });
let ticking = false, polling = false, delivering = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    // A long lease exceeds the bounded six-chunk grading request budget.
    await db.outboxEvent.updateMany({ where: { status: { in: ["queued", "running"] }, updatedAt: { lt: new Date(Date.now() - 60 * 60000) } }, data: { status: "failed", error: "任务进程中断，可能已发生模型计费，请检查后重试" } });
    await db.outboundMail.updateMany({ where: { status: "sending", updatedAt: { lt: new Date(Date.now() - 5 * 60000) } }, data: { status: "uncertain", error: "发送进程中断，请检查邮箱后确认或重发" } });
    const events = await db.outboxEvent.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 50 });
    for (const event of events) {
      const changed = await db.outboxEvent.updateMany({ where: { id: event.id, status: "pending" }, data: { status: "queued" } });
      if (!changed.count) continue;
      try { await boss.send(event.kind === "grade" ? "relay-grade" : "relay-mail", { id: event.id }, { singletonKey: event.id, expireInMinutes: 55, retryLimit: 0 }); }
      catch { await db.outboxEvent.update({ where: { id: event.id }, data: { status: "pending" } }); }
    }
    await db.serviceState.upsert({ where: { key: "worker" }, create: { key: "worker", value: json({ ok: true, model: config.OPENAI_MODEL }) }, update: { value: json({ ok: true, model: config.OPENAI_MODEL }) } });
  } finally { ticking = false; }
}
const safe = (fn: () => Promise<void>) => void fn().catch(() => console.error("后台周期任务失败，请查看服务状态"));
const timers = [
  setInterval(() => safe(tick), 3000),
  setInterval(() => {
    if (polling) return;
    polling = true; safe(async () => { try { await pollMailbox(config, storage); } finally { polling = false; } });
  }, 60000),
  setInterval(() => {
    if (delivering) return;
    delivering = true; safe(async () => { try { await deliverNext(config, storage); } finally { delivering = false; } });
  }, Math.ceil(60000 / config.MAIL_PER_MINUTE)),
  setInterval(() => safe(async () => {
    await storage.cleanup(async key => !!await db.attachment.findUnique({ where: { key } }) || !!await db.inboundMail.findFirst({ where: { rawKey: key } }));
    await db.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }), 86400000),
];
await tick();
safe(() => pollMailbox(config, storage));
console.log("后台任务已启动；邮箱和 AI 只按服务端开关启用。");
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, async () => {
  timers.forEach(clearInterval);
  await boss.stop({ graceful: true, timeout: 30000 });
  await db.$disconnect();
  process.exit(0);
});
