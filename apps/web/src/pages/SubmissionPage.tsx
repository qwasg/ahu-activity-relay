import { useEffect, useRef, useState, type FormEvent } from "react";
import { Upload, ArrowUpRight, CheckCircle2, FileText } from "lucide-react";
import { upload, type Activity } from "../api";
const fields = [{ key: "studentId", label: "学号", placeholder: "请保留完整学号" }, { key: "name", label: "姓名", placeholder: "与活动报名一致", autoComplete: "name" }, { key: "department", label: "院系", placeholder: "所在学院" }, { key: "major", label: "专业", placeholder: "所学专业" }, { key: "className", label: "班级", placeholder: "例如：软件 261" }, { key: "email", label: "联系邮箱", placeholder: "用于管理员联系", type: "email", autoComplete: "email" }];
export function SubmissionPage({ activity }: { activity: Activity }) {
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; receiptToken: string; late: boolean } | null>(null);
  const request = useRef<{ key: string; form: FormData } | null>(null), receiptPanel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (receipt) receiptPanel.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [receipt]);
  const before = Date.now() < Date.parse(activity.startsAt), late = Date.now() > Date.parse(activity.endsAt);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (files.length > 5 || files.some(f => f.size > 10 * 1024 ** 2) || files.reduce((sum, f) => sum + f.size, 0) > 15 * 1024 ** 2) { setError("最多5个附件，单个10 MiB、合计15 MiB。"); return; }
    const form = new FormData(event.currentTarget);
    if (!String(form.get("text") ?? "").trim() && !files.length) { setError("请填写作品说明或选择文件。"); return; }
    form.set("activitySlug", activity.slug); form.set("consent", "true");
    files.forEach(f => form.append("files", f));
    request.current ??= { key: crypto.randomUUID(), form };
    setBusy(true);
    try { setReceipt(await upload(request.current.form, request.current.key, setProgress)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (receipt) return <div className="panel receipt" role="status" ref={receiptPanel}><span className="receipt-icon"><CheckCircle2 size={34} /></span><h3>作品已接收</h3><p>请保留提交编号与收件凭证。邮件归档和 AI 分析在后台异步进行，最终成绩由管理员复核。</p><label>提交编号<code>{receipt.id}</code></label><label>收件凭证<code>{receipt.receiptToken}</code></label>{receipt.late && <p className="notice">本次为迟交，默认不参加排名，需联系管理员。</p>}<button className="button secondary" onClick={() => { setReceipt(null); request.current = null; setFiles([]); }}>提交新版本</button></div>;
  return <form className="panel submission-form" onSubmit={submit} onChange={() => { if (!busy) request.current = null; }}>
    <div className="form-head"><div><h3>提交实践作品</h3><p className="muted">所有带 * 的信息为必填项。</p></div><span className="badge">无需注册</span></div>
    {before && <p className="notice">活动尚未开始，提交将在活动开始时开放。</p>}
    {late && <p className="notice">提交时间已结束。迟交材料将保留，但须管理员特批后才参加排名。</p>}
    <fieldset disabled={busy || before}>
      <div className="form-grid">{fields.map(f => <label key={f.key}>{f.label} <span className="required">*</span><input name={f.key} placeholder={f.placeholder} type={f.type ?? "text"} autoComplete={f.autoComplete} required maxLength={f.key === "email" ? 254 : 100} /></label>)}</div>
      <label>作品说明<textarea name="text" rows={5} maxLength={20000} placeholder="你做了什么？使用了哪些 AI 工具？请描述关键提示词、实践过程与验证结果。" /></label>
      <label>作品链接（选填）<input name="link" type="url" placeholder="https://…（系统不会自动访问或运行）" /></label>
      <label className="file-drop"><span className="file-icon"><Upload size={22} /></span><strong>选择作品文件</strong><span>文档、图片或网页源码 · 最多 5 个</span><small>TXT / MD / PDF / DOCX / PNG / JPG / WebP / HTML / CSS / JS</small><input aria-label="选择作品文件" type="file" multiple accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.html,.css,.js" onChange={e => setFiles([...e.target.files ?? []])} /></label>
      <p className="file-limit">单个文件最多 10 MiB，合计最多 15 MiB；不支持压缩包和音视频。</p>
      {!!files.length && <ul className="file-list">{files.map((f, i) => <li key={`${f.name}-${i}`}><FileText size={16} />{f.name}<span>{(f.size / 1024).toFixed(0)} KB</span></li>)}</ul>}
      <label className="checkbox"><input type="checkbox" required name="consent" value="true" /><span>我确认信息真实，并同意材料存入管理邮箱、交由 OpenAI 进行辅助分析。请勿提交密码、密钥或无权分享的资料。身份信息将由管理员核对。</span></label>
      {error && <p className="error" role="alert">{error}</p>}
      {busy && <div className="upload-progress" role="status"><span>上传 {progress}%{progress === 100 ? "，正在确认接收…" : ""}</span><i style={{ width: `${progress}%` }} /></div>}
      <button className="button primary w-full" type="submit">{busy ? "正在提交…" : "确认并提交作品"}<ArrowUpRight size={18} /></button>
    </fieldset>
    <p className="form-note">重复提交保留为候选版本，不自动覆盖已确认成绩。</p>
  </form>;
}
