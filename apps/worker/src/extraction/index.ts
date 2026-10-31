import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Extraction } from "./child.js";
export type { Extraction };
export function extractIsolated(path: string, name: string): Promise<Extraction> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./child.ts", import.meta.url)), [], {
      execArgv: ["--max-old-space-size=384", "--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, NODE_ENV: process.env.NODE_ENV },
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error("文件解析超过30秒，转人工核查")); }, 30000);
    let answered = false;
    child.once("message", (message: { result?: Extraction; error?: string }) => {
      answered = true; clearTimeout(timer);
      if (message.result) resolve(message.result); else reject(new Error(message.error));
      child.kill();
    });
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("exit", () => { clearTimeout(timer); if (!answered) reject(new Error("文件解析进程异常退出")); });
    child.send({ path, name });
  });
}
