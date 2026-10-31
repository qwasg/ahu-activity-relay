import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";
const bool = z.enum(["true", "false"]).transform(s => s === "true");
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(3001),
    DATABASE_URL: z.string().min(1),
    STORAGE_DIR: z.string().default("./data/private"),
    ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
    TRUST_PROXY_CIDRS: z.string().default(""),
    MAIL_USER: z.email().default("25890346@qq.com"),
    REPORT_EMAIL: z.email().default("25890346@qq.com"),
    MAIL_PASSWORD: z.string().default(""),
    MAIL_SIGNATURE_SECRET: z.string().default(""),
    SMTP_HOST: z.string().default("smtp.qq.com"), SMTP_PORT: z.coerce.number().default(465),
    SMTP_SECURE: bool.default(true),
    IMAP_HOST: z.string().default("imap.qq.com"), IMAP_PORT: z.coerce.number().default(993),
    IMAP_USER: z.string().default(""),
    IMAP_SECURE: bool.default(true), IMAP_FOLDER: z.string().default("INBOX"),
    IMAP_SINCE: z.string().default(""),
    MAIL_ENABLED: bool.default(false),
    AI_ENABLED: bool.default(false),
    OPENAI_API_KEY: z.string().default(""), OPENAI_MODEL: z.string().default("gpt-6.1-sol"),
    UPLOAD_IP_LIMIT: z.coerce.number().int().positive().default(20),
    SUBMISSION_DAILY_LIMIT: z.coerce.number().int().positive().default(10),
    MAIL_PER_MINUTE: z.coerce.number().int().positive().max(60).default(10),
  }).parse(env);
  if (c.MAIL_ENABLED && (c.MAIL_SIGNATURE_SECRET.length < 32 || (c.NODE_ENV !== "test" && !c.MAIL_PASSWORD))) throw new Error("启用邮箱需要新授权码及至少32字符的签名密钥");
  if (c.AI_ENABLED && !c.OPENAI_API_KEY) throw new Error("启用 AI 需要服务端 OPENAI_API_KEY");
  if (c.NODE_ENV === "production" && (!c.SMTP_SECURE || !c.IMAP_SECURE)) throw new Error("生产环境邮箱必须启用 TLS");
  if (c.ALLOWED_ORIGINS.split(",").includes("*")) throw new Error("不可允许任意跨域来源");
  return { ...c, STORAGE_DIR: resolve(c.STORAGE_DIR) };
}
export type Config = ReturnType<typeof loadConfig>;
