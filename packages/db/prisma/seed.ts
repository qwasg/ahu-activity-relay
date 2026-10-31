import "dotenv/config";
import { hash } from "argon2";
import { db, json } from "../src/index.js";
import { ruleSchema } from "../../contracts/src/index.js";

const activities = [
  {
    slug: "agent-workshop-2026-01",
    title: "智码 Agent 工坊",
    description: "从大模型到智能体实践课 · 第一期。通过录播学习与课后实践，理解 ReAct、MCP 与 Skill，利用 Agent 搭建你的个人展示网站。",
    registrationStart: new Date("2026-11-05T10:00:00+08:00"), registrationEnd: new Date("2026-11-07T16:00:00+08:00"),
    startsAt: new Date("2026-11-08T09:00:00+08:00"), endsAt: new Date("2026-11-10T18:00:00+08:00"),
    groups: ["1022711517", "1044219357"],
    rule: {
      task: "借助 Agent 搭建个人展示网站。提交网站截图、关键源码或文字说明，说明使用的 Agent/AI 工具、提示词、实现过程、功能验证与个人收获。不要上传密码和密钥。课程链接由活动 QQ 群发布。",
      dimensions: [{ id: "completion", label: "任务完成度", max: 40 }, { id: "agent", label: "Agent 应用", max: 25 }, { id: "presentation", label: "展示与可用性", max: 20 }, { id: "process", label: "过程说明", max: 15 }],
      passScore: 60, tiers: [{ credits: 2, capacity: 60 }, { credits: 1, capacity: 640 }],
    },
  },
  {
    slug: "cross-major-ai-2026",
    title: "跨专业 AI 实操体验赛",
    description: "让 AI 走进你的专业。无需复杂编程，用 AI 工具解决一个真实的专业问题，展示你的实践、思考与创意。",
    registrationStart: new Date("2026-11-13T10:00:00+08:00"), registrationEnd: new Date("2026-11-15T16:00:00+08:00"),
    startsAt: new Date("2026-11-16T09:00:00+08:00"), endsAt: new Date("2026-11-20T18:00:00+08:00"),
    groups: ["1126172886", "1124947611", "796628157"],
    rule: {
      task: "结合本专业，运用 AI 工具完成实操任务并产出专业相关作品。提交作品、问题背景、使用工具与提示词、过程记录、结果验证和局限说明。不要上传密码和密钥。",
      dimensions: [{ id: "relevance", label: "专业结合", max: 35 }, { id: "utility", label: "实用性", max: 30 }, { id: "ai", label: "AI 应用", max: 20 }, { id: "expression", label: "表达完整", max: 15 }],
      passScore: 60, tiers: [{ credits: 3, capacity: 30 }, { credits: 2, capacity: 100 }, { credits: 1, capacity: 800 }],
    },
  },
];
for (const { rule, ...activity } of activities) {
  await db.activity.upsert({
    where: { slug: activity.slug }, update: {},
    create: { ...activity, rules: { create: { version: 1, config: json(ruleSchema.parse(rule)) } } },
  });
}
const password = process.env.ADMIN_PASSWORD;
if (password) {
  if (password.length < 14) throw new Error("ADMIN_PASSWORD 至少14个字符");
  const username = process.env.ADMIN_USERNAME ?? "admin";
  await db.admin.upsert({ where: { username }, update: {}, create: { username, passwordHash: await hash(password) } });
} else console.warn("未配置 ADMIN_PASSWORD，未创建管理员。");
await db.$disconnect();
console.log("两项活动已初始化；现有活动与管理员未覆盖。");
