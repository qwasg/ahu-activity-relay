import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { db } from "../../../packages/db/src/index.js";
const config = loadConfig();
const app = await buildApp(config);
await app.listen({ port: config.PORT, host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
});
