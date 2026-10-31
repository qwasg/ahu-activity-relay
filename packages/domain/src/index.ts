import { createHash } from "node:crypto";
import { AppError, ruleSchema, type Identity, type Rule } from "../../contracts/src/index.js";

export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function scoreTotal(rule: Rule, scores: Record<string, number>): number {
  if (Object.keys(scores).length !== rule.dimensions.length) throw new AppError(422, "SCORES", "评分维度不匹配");
  let total = 0;
  for (const d of rule.dimensions) {
    const n = scores[d.id];
    if (!Number.isFinite(n) || n < 0 || n > d.max || Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) throw new AppError(422, "SCORES", `${d.label}分数无效，最多两位小数`);
    total += Math.round(n * 100);
  }
  return total / 100;
}
export type Candidate = Identity & {
  staff: boolean; eligible: boolean; confirmed: boolean; excluded?: boolean;
  submissionId?: string; receivedAt?: string; scores?: Record<string, number>;
  aiTotal?: number; note?: string;
};
export type ResultRow = Candidate & { total: number | null; rank: number | null; credits: number; reason: string };
export type TieDecision = { ids: string[]; reason: string };
export function allocate(inputRule: Rule, candidates: Candidate[], decisions: TieDecision[] = []) {
  const rule = ruleSchema.parse(inputRule);
  const blockers: string[] = [];
  const seen = new Set<string>();
  const rows: ResultRow[] = [];
  for (const c of candidates) {
    if (seen.has(c.studentId)) blockers.push(`学号 ${c.studentId} 存在多份有效记录`);
    seen.add(c.studentId);
    const total = c.scores && !c.staff ? scoreTotal(rule, c.scores) : null;
    if (!c.confirmed && !c.excluded) blockers.push(`学号 ${c.studentId} 尚未确认`);
    rows.push({ ...c, total, rank: null, credits: 0, reason: c.excluded ? "已排除" : !c.eligible ? "参与资格无效" : !c.staff && total === null ? "未提交有效作品" : total !== null && total < rule.passScore ? "未达到合格线" : "名额不足" });
  }
  const staff = rows.filter(r => r.staff && r.eligible && r.confirmed && !r.excluded);
  if (staff.length > rule.tiers[0].capacity) blockers.push("工作人员人数超过最高档名额");
  staff.forEach(r => { r.credits = rule.tiers[0].credits; r.reason = "已确认工作人员，占最高档"; });
  const students = rows.filter(r => !r.staff && r.eligible && r.confirmed && !r.excluded && r.total !== null && r.total >= rule.passScore);
  const compare = (a: ResultRow, b: ResultRow) => {
    const total = Math.round(b.total! * 100) - Math.round(a.total! * 100);
    if (total) return total;
    for (const d of rule.dimensions) {
      const diff = Math.round(b.scores![d.id] * 100) - Math.round(a.scores![d.id] * 100);
      if (diff) return diff;
    }
    return 0;
  };
  students.sort((a, b) => compare(a, b) || (a.submissionId ?? a.studentId).localeCompare(b.submissionId ?? b.studentId));
  const slots = rule.tiers.flatMap((t, i) => Array(Math.max(0, t.capacity - (i === 0 ? staff.length : 0))).fill(t.credits) as number[]);
  const ties: { ids: string[]; credits: number[] }[] = [];
  for (let start = 0; start < students.length;) {
    let end = start + 1;
    while (end < students.length && compare(students[start], students[end]) === 0) end++;
    const group = students.slice(start, end);
    const credits = group.map((_, i) => slots[start + i] ?? 0);
    const ids = group.map(r => r.studentId);
    const boundary = new Set(credits).size > 1;
    const decision = decisions.find(d => d.ids.length === ids.length && new Set(d.ids).size === ids.length && ids.every(id => d.ids.includes(id)) && d.reason.trim());
    if (boundary && !decision) { blockers.push(`学分边界同分待裁定：${ids.join("、")}`); ties.push({ ids, credits }); }
    if (boundary && decision) group.sort((a, b) => decision.ids.indexOf(a.studentId) - decision.ids.indexOf(b.studentId));
    group.forEach((r, i) => {
      r.rank = start + 1;
      r.credits = credits[i];
      r.reason = r.credits ? "合格作品按排名授分" : "合格但名额不足";
      if (boundary && decision) r.reason += `；同分裁定：${decision.reason}`;
    });
    students.splice(start, group.length, ...group);
    start = end;
  }
  return {
    rows: [...staff, ...students, ...rows.filter(r => !staff.includes(r) && !students.includes(r))],
    blockers, ties,
    usage: rule.tiers.map(t => ({ ...t, used: rows.filter(r => r.credits === t.credits).length })),
  };
}
