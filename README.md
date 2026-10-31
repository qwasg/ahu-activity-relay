# 智码实践 · 活动邮箱转接系统

安徽工业大学软件编程协会两项活动（智码 Agent 工坊、跨专业 AI 实操体验赛）的作品收集与辅助评阅系统。

- 后端：Fastify + PostgreSQL + Prisma，后台任务使用 pg-boss
- 前端：React + Vite + Tailwind CSS
- 运行环境：Node.js 24

## 功能

- 两个活动介绍页、匿名文字/文件上传、邮箱投稿和原件归档。
- TXT、MD、PDF、DOCX、PNG、JPG、WebP、HTML、CSS、JS 材料解析；源码只读取，不运行。
- 基于 OpenAI 的结构化辅助评分、证据引用、内容缓存和用量记录，模型由 `OPENAI_MODEL` 配置。
- 管理员登录、名单导入、逐份审核、迟交处理、同分裁定、版本化发布。
- 工作人员占最高档、合格学生按排名分配学分；HTML、XLSX、CSV 下载及邮件发送。
- 私有文件存储、邮件去重、防循环、任务重试和操作审计。

本系统生成授分建议与确认名单，不直接写入学校学分系统。学生没有严格身份核验，管理员必须核对名单与材料。活动页插图由 OpenAI 图像模型生成。

## 目录结构

```text
apps/
  api/        Fastify API：投稿、管理端接口、报表
  worker/     后台任务：邮件收发、材料解析、AI 辅助评分
  web/        React 前端：活动页与管理端
packages/
  contracts/  前后端共享的数据校验（zod）
  db/         Prisma 模型、迁移与种子数据
  domain/     计分、排名与学分分配规则
  storage/    私有文件存储
```

## 本地运行

需要 Node.js 24 和一个 PostgreSQL 数据库，开发时请使用独立的空库。

1. 复制 `.env.example` 为 `.env`，至少填写 `DATABASE_URL` 和 `ADMIN_PASSWORD`（不少于 14 个字符）。开发时保持 `MAIL_ENABLED=false`、`AI_ENABLED=false`。
2. 安装依赖并初始化数据库（迁移命令请确保当前终端能读到 `DATABASE_URL`）：

   ```powershell
   npm ci
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

3. 分别在三个终端启动：

   ```powershell
   npm run dev      # API，默认端口 3001
   npm run worker   # 后台任务
   npm run web      # 前端开发服务器，http://localhost:5173
   ```

前端开发服务器会把 `/api` 代理到 `http://127.0.0.1:3001`。管理员入口为 `/admin`，用户名默认为 `admin`，密码为初始化时的 `ADMIN_PASSWORD`；系统没有默认密码，`db:seed` 不会覆盖已有的管理员或活动数据。

未启用邮箱和 AI 时，相关后台任务显示为 `blocked`，管理员仍可手动审核。

## 构建与部署

```powershell
npm run build
```

该命令会生成 Prisma Client、执行类型检查，并把前端打包到 `apps/web/dist`。

- 生产环境在 `.env` 中设置 `NODE_ENV=production`；此时邮箱必须启用 TLS。
- API 与 worker 通过 `tsx` 直接运行 TypeScript（`npm run dev`、`npm run worker`），需要安装完整依赖，包括 devDependencies。
- 首次部署或升级时先执行 `npm run db:migrate`，再执行 `npm run db:seed`。
- `apps/web/dist` 是静态站点：用 Nginx 等托管时，把 `/api/` 反向代理到 API，并把未知路径回退到 `index.html`；上传接口需要允许至少 16 MiB 的请求体。
- 前端与 API 不同域时，构建前设置 `VITE_API_URL` 为 API 的 HTTPS 地址，并把前端来源加入 `ALLOWED_ORIGINS`。
- `/health/live` 检查 API 进程，`/health/ready` 检查数据库与 worker 心跳。

## 配置

全部配置见 `.env.example`，常用项如下：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `ADMIN_USERNAME`、`ADMIN_PASSWORD` | 首次初始化的管理员账户，密码至少 14 个字符 |
| `MAIL_ENABLED`、`MAIL_USER`、`MAIL_PASSWORD` | 邮件收发；QQ 邮箱的 `MAIL_PASSWORD` 填 SMTP/IMAP 授权码，不是登录密码 |
| `MAIL_SIGNATURE_SECRET` | 识别系统自发邮件的签名密钥，启用邮箱时至少 32 个字符 |
| `AI_ENABLED`、`OPENAI_API_KEY`、`OPENAI_MODEL` | OpenAI 辅助评分；启用时必须配置 Key |
| `ALLOWED_ORIGINS` | 允许的前端来源，多个用逗号分隔，不支持 `*` |
| `STORAGE_DIR` | 私有材料存储目录 |
| `VITE_API_URL` | 前端构建时使用的 API 地址，同域部署时留空 |

## 安全提示

- 凭据只放在服务器私有的 `.env` 中，不要提交到仓库，也不要注入前端构建。
- 前端只接收公开的 API 地址；管理员令牌只保存在页面内存中，刷新后需重新登录。

## 许可证

[MIT](LICENSE)
