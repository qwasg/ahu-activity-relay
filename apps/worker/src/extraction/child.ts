import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import mammoth from "mammoth";
import sharp from "sharp";
import yauzl from "yauzl";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

export type Extraction = { text: string; images: string[]; warnings: string[]; coverage: string };
async function unzipSafe(buffer: Buffer): Promise<{ images: Buffer[]; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      let count = 0, bytes = 0;
      const images: Buffer[] = [], warnings: string[] = [];
      const fail = (e: Error) => { zip.close(); reject(e); };
      zip.on("error", fail);
      zip.on("entry", entry => {
        bytes += entry.uncompressedSize;
        if (++count > 1000 || bytes > 50 * 1024 ** 2 || entry.fileName.includes("..") || entry.fileName.startsWith("/")) { fail(new Error("DOCX 解压限额或路径检查失败")); return; }
        if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) { fail(err ?? new Error("ZIP_STREAM")); return; }
          const chunks: Buffer[] = []; let actual = 0;
          stream.on("data", (chunk: Buffer) => {
            actual += chunk.length;
            if (actual > entry.uncompressedSize || actual > 50 * 1024 ** 2) { stream.destroy(); fail(new Error("DOCX 解压数据超限")); return; }
            chunks.push(chunk);
          });
          stream.on("error", fail);
          stream.on("end", () => {
            const data = Buffer.concat(chunks);
            if (/\.(xml|rels)$/.test(entry.fileName) && /<!DOCTYPE|<!ENTITY/i.test(data.toString("utf8"))) { fail(new Error("禁止 XML 外部实体")); return; }
            if (entry.fileName.startsWith("word/media/")) {
              if (images.length < 8 && /\.(png|jpg|jpeg|webp)$/i.test(entry.fileName)) images.push(data);
              else warnings.push("部分内嵌图片未处理");
            }
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve({ images, warnings }));
      zip.readEntry();
    });
  });
}
const image = async (buffer: Buffer) => "data:image/jpeg;base64," + (await sharp(buffer, { limitInputPixels: 25000000 }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString("base64");
export async function extract(path: string, name: string): Promise<Extraction> {
  const buffer = await readFile(path), ext = extname(name).toLowerCase();
  const output: Extraction = { text: "", images: [], warnings: [], coverage: "完整" };
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) output.images.push(await image(buffer));
  else if (ext === ".docx") {
    const zip = await unzipSafe(buffer);
    const result = await mammoth.extractRawText({ buffer });
    output.text = result.value;
    output.warnings.push(...zip.warnings, ...result.messages.map(m => m.message));
    for (const img of zip.images) output.images.push(await image(img));
  } else if (ext === ".pdf") {
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, stopAtErrors: true });
    const doc = await loading.promise;
    try {
      const pages = Math.min(doc.numPages, 80);
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(item => "str" in item ? item.str : "").join(" ");
        output.text += `\n[第${i}页]\n${text}\n`;
        const ops = await page.getOperatorList();
        // 文字不足或包含图片时，渲染页面作为视觉证据。
        const visual = text.trim().length < 100 || ops.fnArray.some(op => [82, 83, 84, 85, 86, 87, 88, 89, 90].includes(op));
        if (visual && output.images.length < 8) {
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvasContext: canvas.getContext("2d") as never, canvas: canvas as never, viewport }).promise;
          output.images.push(await image(canvas.toBuffer("image/png")));
        } else if (visual) output.warnings.push(`第${i}页图片未处理：超过8张图像限额`);
        page.cleanup();
      }
      if (doc.numPages > pages) output.warnings.push(`仅处理前${pages}/${doc.numPages}页`);
    } finally { await loading.destroy(); }
  } else output.text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  if (output.text.length > 200000) { output.text = output.text.slice(0, 200000); output.warnings.push("文字超过解析上限，后续内容未读取"); }
  if (output.warnings.length) output.coverage = "部分材料需人工核查";
  return output;
}
if (process.send) {
  process.on("message", async (message: { path: string; name: string }) => {
    try { process.send!({ result: await extract(message.path, message.name) }); }
    catch (error) { process.send!({ error: error instanceof Error ? error.message : "解析失败" }); }
    finally { process.disconnect(); }
  });
}
