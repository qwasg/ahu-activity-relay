import { randomBytes } from "node:crypto";
import { db, activityLock } from "../../../../../packages/db/src/index.js";
import { submissionSchema, AppError, limits } from "../../../../../packages/contracts/src/index.js";
import { fingerprint } from "../../../../../packages/domain/src/index.js";
import type { StoredFile } from "../../../../../packages/storage/src/index.js";

export async function acceptSubmission(raw: unknown, files: StoredFile[], key: string, options: {
  source?: "web" | "mail"; receivedAt?: Date; dailyLimit?: number;
} = {}) {
  const input = submissionSchema.parse(raw);
  if (!input.text.trim() && files.length === 0) throw new AppError(422, "EMPTY", "请填写作品说明或上传文件");
  if (files.length > limits.count || files.reduce((s, f) => s + f.size, 0) > limits.total) throw new AppError(413, "FILES_SIZE", "附件最多5个，合计15 MiB");
  const contentHash = fingerprint({ input, files: files.map(({ hash, name }) => ({ hash, name })) });
  const target = await db.activity.findUnique({ where: { slug: input.activitySlug }, select: { id: true } });
  if (!target) throw new AppError(404, "ACTIVITY", "活动不存在");
  const receivedAt = options.receivedAt ?? new Date();
  return db.$transaction(async tx => {
    // 与审核、发布使用相同活动锁，避免重复锁和并发写入绕过发布校验。
    await activityLock(tx, target.id);
    const old = await tx.submission.findUnique({ where: { idempotencyKey: key } });
    if (old) {
      if (old.contentHash !== contentHash) throw new AppError(409, "IDEMPOTENCY", "同一请求编号已用于不同内容");
      return { submission: old, reused: true };
    }
    const activity = await tx.activity.findUnique({ where: { id: target.id } });
    if (!activity) throw new AppError(404, "ACTIVITY", "活动不存在");
    if (receivedAt < activity.startsAt) throw new AppError(422, "NOT_OPEN", "活动尚未开始，暂不接收提交");
    if (options.source !== "mail") {
      const count = await tx.submission.count({ where: { activityId: activity.id, studentId: input.studentId, receivedAt: { gte: new Date(Date.now() - 86400000) } } });
      if (count >= (options.dailyLimit ?? 10)) throw new AppError(429, "DAILY_LIMIT", "提交次数过多，请联系管理员");
    }
    const { activitySlug: _, ...data } = input;
    const submission = await tx.submission.create({ data: {
      ...data, activityId: activity.id, source: options.source ?? "web", receivedAt,
      late: receivedAt > activity.endsAt, contentHash, idempotencyKey: key,
      receiptToken: randomBytes(32).toString("hex"),
      archiveStatus: options.source === "mail" ? "sent" : "pending",
      attachments: { create: files },
    } });
    await tx.outboxEvent.create({ data: { key: `grade:${submission.id}`, kind: "grade", targetId: submission.id } });
    if (options.source !== "mail") await tx.outboxEvent.create({ data: { key: `archive:${submission.id}`, kind: "archive", targetId: submission.id } });
    await tx.activity.update({ where: { id: activity.id }, data: { revision: { increment: 1 } } });
    return { submission, reused: false };
  }, { timeout: 60000, maxWait: 60000 });
}
