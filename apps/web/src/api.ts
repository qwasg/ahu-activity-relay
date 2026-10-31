import type { Rule } from "../../../packages/contracts/src/index.js";
export type Activity = { id: string; slug: string; title: string; description: string; startsAt: string; endsAt: string; registrationStart: string; registrationEnd: string; groups: string[]; rules: { config: Rule; version: number }[]; mailbox?: string };
export const base = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_URL ?? "";
let token = "";
export const setToken = (value: string) => { token = value; };
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}/api/v1${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `请求失败 ${response.status}` }));
    throw new Error(error.message + (error.details ? `：${JSON.stringify(error.details)}` : ""));
  }
  return response.json() as Promise<T>;
}
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function download(path: string, name: string) {
  const response = await fetch(`${base}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("下载失败，请检查登录状态");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const date = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
export function upload(form: FormData, key: string, onProgress: (n: number) => void): Promise<{ id: string; receiptToken: string; late: boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/v1/submissions`);
    xhr.setRequestHeader("Idempotency-Key", key);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.timeout = 120000;
    xhr.onerror = () => reject(new Error("网络中断，可用相同提交编号重试"));
    xhr.ontimeout = () => reject(new Error("请求超时，请重试；系统会按提交编号去重"));
    xhr.onload = () => {
      try { const result = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(new Error(result.message ?? "提交失败")); else resolve(result); }
      catch { reject(new Error("服务器返回异常，请稍后重试")); }
    };
    xhr.send(form);
  });
}
