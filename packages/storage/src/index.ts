import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { allowedExtensions, limits, AppError } from "../../contracts/src/index.js";
export type StoredFile = { name: string; key: string; mime: string; size: number; hash: string };
const mimeByExt: Record<string, string[]> = {
  ".pdf": ["application/pdf"], ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".png": ["image/png"], ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"], ".webp": ["image/webp"],
  ".txt": ["text/plain"], ".md": ["text/markdown", "text/plain"], ".html": ["text/html", "text/plain"],
  ".css": ["text/css", "text/plain"], ".js": ["application/javascript", "text/javascript", "text/plain"],
};
export class Storage {
  constructor(public root: string) {}
  path(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new AppError(400, "STORAGE_KEY", "无效文件标识");
    return join(this.root, key);
  }
  async put(buffer: Buffer, filename: string, declaredMime = "application/octet-stream"): Promise<StoredFile> {
    const name = basename(filename.replaceAll("\\", "/")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180);
    const ext = extname(name).toLowerCase();
    if (!allowedExtensions.includes(ext)) throw new AppError(415, "FILE_TYPE", `不支持 ${ext || "无扩展名"} 文件`);
    if (buffer.length > limits.file) throw new AppError(413, "FILE_SIZE", "单个附件不能超过10 MiB");
    const detected = await fileTypeFromBuffer(buffer);
    const text = [".txt", ".md", ".html", ".css", ".js"].includes(ext);
    if (text) {
      if (detected || buffer.includes(0)) throw new AppError(415, "FILE_SIGNATURE", "文本文件含二进制数据");
      try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new AppError(415, "ENCODING", "文本需使用 UTF-8 编码"); }
    } else if (!detected || !mimeByExt[ext].includes(detected.mime)) throw new AppError(415, "FILE_SIGNATURE", "文件内容与扩展名不符");
    if (declaredMime !== "application/octet-stream" && !mimeByExt[ext].includes(declaredMime.split(";")[0])) throw new AppError(415, "FILE_MIME", "附件 MIME 类型与扩展名不符");
    return this.putRaw(buffer, name, detected?.mime ?? mimeByExt[ext][0]);
  }
  async putRaw(buffer: Buffer, name: string, mime: string): Promise<StoredFile> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    await writeFile(this.path(key), buffer, { flag: "wx", mode: 0o600 });
    return { name, key, mime, size: buffer.length, hash: createHash("sha256").update(buffer).digest("hex") };
  }
  read(key: string) { return readFile(this.path(key)); }
  async remove(key: string) { await unlink(this.path(key)).catch(() => undefined); }
  async cleanup(isReferenced: (key: string) => Promise<boolean>) {
    await mkdir(this.root, { recursive: true });
    for (const key of await readdir(this.root)) {
      if (!/^[0-9a-f-]{36}$/.test(key)) continue;
      const info = await stat(this.path(key));
      if (Date.now() - info.mtimeMs > 86400000 && !await isReferenced(key)) await this.remove(key);
    }
  }
}
