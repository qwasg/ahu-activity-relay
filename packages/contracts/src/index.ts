import { z } from "zod";

export const dimensionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(100),
  max: z.number().int().positive().max(100),
});
export const ruleSchema = z.object({
  task: z.string().min(10).max(10000),
  dimensions: z.array(dimensionSchema).min(1).max(10),
  passScore: z.number().min(0).max(100),
  tiers: z.array(z.object({ credits: z.number().int().positive(), capacity: z.number().int().nonnegative().max(10000) })).min(1).max(5),
}).superRefine((r, ctx) => {
  if (r.dimensions.reduce((s, d) => s + d.max, 0) !== 100) ctx.addIssue({ code: "custom", message: "评分权重之和必须为100" });
  if (new Set(r.dimensions.map(d => d.id)).size !== r.dimensions.length) ctx.addIssue({ code: "custom", message: "评分维度不能重复" });
  if (r.tiers.some((t, i) => i > 0 && t.credits >= r.tiers[i - 1].credits)) ctx.addIssue({ code: "custom", message: "学分档位必须递减" });
});
export type Rule = z.infer<typeof ruleSchema>;
export const identitySchema = z.object({
  studentId: z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/),
  name: z.string().trim().min(1).max(60),
  department: z.string().trim().min(1).max(100),
  major: z.string().trim().min(1).max(100),
  className: z.string().trim().min(1).max(100),
});
export const submissionSchema = identitySchema.extend({
  activitySlug: z.string().min(1).max(80),
  email: z.email().max(254),
  text: z.string().max(20000).default(""),
  link: z.union([z.literal(""), z.url().refine(s => /^https?:\/\//i.test(s), "只支持 HTTP/HTTPS 链接")]).default(""),
  consent: z.literal(true),
});
export const rosterSchema = identitySchema.extend({ eligible: z.boolean(), staff: z.boolean() });
export const aiOutputSchema = z.object({
  summary: z.string().max(4000),
  dimensionScores: z.array(z.object({ id: z.string(), score: z.number(), reason: z.string(), evidenceRefs: z.array(z.string()) })),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  coverage: z.string(),
  needsManualReview: z.boolean(),
});
export type AIOutput = z.infer<typeof aiOutputSchema>;
export type Identity = z.infer<typeof identitySchema>;
export const allowedExtensions = [".txt", ".md", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".html", ".css", ".js"];
export const limits = { file: 10 * 1024 ** 2, total: 15 * 1024 ** 2, count: 5 };
export class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) { super(message); }
}
