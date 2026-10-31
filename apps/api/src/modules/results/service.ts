import { db, json, activityLock, type Transaction } from "../../../../../packages/db/src/index.js";
import { allocate, fingerprint, type Candidate, type TieDecision } from "../../../../../packages/domain/src/index.js";
import { AppError, ruleSchema } from "../../../../../packages/contracts/src/index.js";

export async function preview(tx: Transaction, activityId: string) {
  const a = await tx.activity.findUnique({ where: { id: activityId }, include: {
    rules: { orderBy: { version: "desc" }, take: 1 },
    roster: { orderBy: { studentId: "asc" } },
    submissions: { include: { review: true, aiReview: true }, orderBy: { id: "asc" } },
  } });
  if (!a) throw new AppError(404, "ACTIVITY", "活动不存在");
  const current = a.rules[0];
  const rule = ruleSchema.parse(current.config);
  const blockers: string[] = [];
  if (new Date() < a.endsAt) blockers.push("尚未到活动提交截止时间");
  const candidates: Candidate[] = [];
  const ids = new Set([...a.roster.map(r => r.studentId), ...a.submissions.map(s => s.studentId)]);
  for (const id of [...ids].sort()) {
    const roster = a.roster.find(r => r.studentId === id);
    const submissions = a.submissions.filter(s => s.studentId === id);
    for (const s of submissions) {
      if (!s.review || s.review.ruleVersion !== current.version) blockers.push(`提交 ${s.id} 尚未按当前规则审核`);
      if (s.review && !s.review.excluded) {
        if (!s.review.identityConfirmed) blockers.push(`提交 ${s.id} 身份未确认`);
        if (s.late && !s.review.lateApproved) blockers.push(`提交 ${s.id} 为迟交，需排除或特批`);
        if (s.archiveStatus !== "sent" && !s.archiveWaiver) blockers.push(`提交 ${s.id} 邮件未归档`);
        if (!roster) blockers.push(`学号 ${id} 未在参与名单中`);
        if (roster && roster.name !== s.name) blockers.push(`学号 ${id} 姓名与名单不符，需排除或修正名单`);
      }
    }
    const active = submissions.filter(s => s.review && !s.review.excluded);
    if (active.length > 1) blockers.push(`学号 ${id} 有多份选中作品，请逐份排除旧版本`);
    const s = active[0];
    const identity = roster ?? s ?? submissions[0];
    if (!identity) continue;
    const review = s?.review;
    let aiTotal: number | undefined;
    if (s?.aiReview) {
      const output = s.aiReview.result as { dimensionScores?: { score: number }[] };
      aiTotal = output.dimensionScores?.reduce((sum, d) => sum + d.score, 0);
    }
    candidates.push({
      studentId: id, name: identity.name, department: identity.department, major: identity.major, className: identity.className,
      eligible: Boolean(roster?.eligible && (roster.staff || review?.eligible)),
      staff: Boolean(roster?.staff), confirmed: roster?.staff ? roster.confirmed : Boolean(review) || submissions.length === 0 || submissions.every(x => x.review?.excluded),
      excluded: !roster?.staff && !s, scores: review ? review.scores as Record<string, number> : undefined,
      submissionId: s?.id, receivedAt: s?.receivedAt.toISOString(), aiTotal, note: review?.note,
    });
  }
  const allocation = allocate(rule, candidates, a.tieDecisions as TieDecision[]);
  const waitingMail = await tx.inboundMail.count({ where: { status: "pending", error: { contains: a.slug } } });
  if (waitingMail) blockers.push(`${waitingMail} 封相关邮件仍待处理`);
  const data = { title: a.title, slug: a.slug, activityId, rule, ruleVersion: current.version, revision: a.revision,
    ...allocation, blockers: [...blockers, ...allocation.blockers] };
  return { ...data, fingerprint: fingerprint(data) };
}
export async function publish(activityId: string, expected: string, key: string, adminId: string) {
  return db.$transaction(async tx => {
    await activityLock(tx, activityId);
    const old = await tx.resultSnapshot.findUnique({ where: { idempotencyKey: key } });
    if (old) {
      if (old.activityId !== activityId || old.fingerprint !== expected) throw new AppError(409, "IDEMPOTENCY", "发布请求编号冲突");
      return old;
    }
    const draft = await preview(tx, activityId);
    if (draft.fingerprint !== expected) throw new AppError(409, "STALE_DRAFT", "数据已变化，请重新生成草案");
    if (draft.blockers.length) throw new AppError(422, "PUBLISH_BLOCKED", "请先解决发布阻断项", draft.blockers);
    const last = await tx.resultSnapshot.findFirst({ where: { activityId }, orderBy: { version: "desc" } });
    const snapshot = await tx.resultSnapshot.create({ data: { activityId, fingerprint: expected, idempotencyKey: key, version: (last?.version ?? 0) + 1, data: json(draft) } });
    await tx.outboxEvent.create({ data: { key: `report:${snapshot.id}`, kind: "report", targetId: snapshot.id } });
    await tx.auditLog.create({ data: { adminId, action: "publish", targetId: snapshot.id, details: { previous: last?.id ?? null } } });
    return snapshot;
  }, { timeout: 20000 });
}
