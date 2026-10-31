import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, RefreshCw, LogOut, ArrowRight, Download } from "lucide-react";
import { api, post, setToken, download, date, type Activity } from "../../api";
import type { AIOutput, Rule } from "../../../../../packages/contracts/src/index.js";
import type { ResultRow } from "../../../../../packages/domain/src/index.js";
type Review = { scores: Record<string, number>; note: string; excluded: boolean; eligible: boolean; identityConfirmed: boolean; lateApproved: boolean };
type Submission = { id: string; studentId: string; name: string; email: string; text: string; link: string; receivedAt: string; late: boolean; status: string; version: number; archiveStatus: string; archiveWaiver: string | null; review: Review | null;
  attachments: { id: string; name: string; size: number }[]; aiReview: { result: AIOutput; usage: unknown } | null; candidates: { id: string; name: string; email: string }[]; roster: { name: string; eligible: boolean; staff: boolean } | null };
type Draft = { fingerprint: string; blockers: string[]; rows: ResultRow[]; usage: { credits: number; used: number; capacity: number }[]; ties: { ids: string[]; credits: number[] }[] };
type Snapshot = { id: string; version: number; createdAt: string };
type Job = { id: string; kind: string; status: string; error: string | null; targetId: string };
type Mail = { id: string; kind: string; status: string; error: string | null; recipient: string };
type Inbound = { id: string; error: string | null; subject?: string; suggested?: unknown; filenames?: string[] };
type Operations = { configuration: { mailEnabled: boolean; aiEnabled: boolean; model: string }; services: { key: string; value: unknown; updatedAt: string }[]; jobs: Job[]; mails: Mail[]; inbound: Inbound[]; audit: unknown[]; usage: unknown[] };

export function AdminPage() {
  const [logged, setLogged] = useState(false), [activities, setActivities] = useState<Activity[]>([]), [activityId, setActivityId] = useState("");
  const [tab, setTab] = useState("review"), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Submission[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Submission | null>(null), [draft, setDraft] = useState<Draft | null>(null), [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [operations, setOperations] = useState<Operations | null>(null), [roster, setRoster] = useState<unknown[]>([]);
  const activity = activities.find(a => a.id === activityId);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function refresh() {
    if (!activityId) return;
    if (tab === "review") {
      const result = await api<{ items: Submission[]; total: number }>(`/admin/activities/${activityId}/submissions?page=${page}${filter ? `&status=${filter}` : ""}`);
      setItems(result.items); setTotal(result.total);
    }
    if (tab === "roster") setRoster(await api<unknown[]>(`/admin/activities/${activityId}/roster`));
    if (tab === "results") setSnapshots(await api<Snapshot[]>(`/admin/activities/${activityId}/results`));
    if (tab === "operations") setOperations(await api<Operations>("/admin/operations"));
  }
  useEffect(() => { if (logged) void run(refresh); }, [activityId, tab, page, filter, logged]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(async () => {
      const result = await post<{ token: string }>("/admin/login", Object.fromEntries(form));
      setToken(result.token); setLogged(true);
      const list = await api<Activity[]>("/activities"); setActivities(list); setActivityId(list[0]?.id ?? "");
    });
  }
  if (!logged) return <main className="shell admin-login"><div className="login-intro"><div className="section-label">ADMIN WORKSPACE</div><h1>让每一份实践，<br />得到认真回应。</h1><p className="muted">作品归档、AI 辅助评阅与学分名单，<br />在同一处管理。</p></div><form className="panel" onSubmit={login}><ShieldCheck size={30} /><h2>管理员登录</h2><p className="muted">仅活动组织者可访问学生材料与成绩。</p><label>用户名<input name="username" required autoComplete="username" /></label><label>密码<input name="password" type="password" required autoComplete="current-password" /></label>{error && <p className="error" role="alert">{error}</p>}<button disabled={busy} className="button primary w-full">进入管理工作台 <ArrowRight size={16} /></button><small>会话仅保存在内存中，刷新页面需重新登录。</small></form></main>;
  return <main className="shell admin-shell">
    <div className="admin-heading"><div><div className="section-label">ADMIN WORKSPACE</div><h1>活动管理工作台</h1></div><div className="flex gap-3"><button className="button secondary" onClick={() => void run(refresh)} disabled={busy}><RefreshCw size={15} />刷新</button><button className="button secondary" onClick={() => void run(async () => { await post("/admin/logout"); setToken(""); setLogged(false); })}><LogOut size={15} />退出</button></div></div>
    <label className="activity-select">当前活动<select value={activityId} onChange={e => { setActivityId(e.target.value); setSelected(null); setDraft(null); setPage(1); }}>{activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
    <div className="admin-tabs">{[["review", "作品评阅"], ["roster", "参与名单"], ["rules", "评分规则"], ["results", "排名与发布"], ["operations", "邮件与运行"]].map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setSelected(null); }}>{label}</button>)}</div>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}{busy && <p className="muted" role="status">正在处理…</p>}
    {tab === "review" && <div className="admin-review-grid"><section className="panel">
      <div className="flex items-center justify-between"><h3>待评阅作品 <small>{total}</small></h3><select aria-label="筛选状态" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="">全部状态</option><option value="queued">待处理</option><option value="awaiting_review">待审核</option><option value="reviewed">已审核</option><option value="failed">处理失败</option></select></div>
      {!items.length && <div className="empty">暂无对应作品。活动开放后，网站和邮箱投稿会出现在这里。</div>}
      {items.map(s => <button className={`submission-item ${selected?.id === s.id ? "selected" : ""}`} key={s.id} onClick={() => void run(async () => setSelected(await api<Submission>(`/admin/submissions/${s.id}`)))}><span><strong>{s.name}</strong><small>{s.studentId} · {date(s.receivedAt)}</small></span><span className="badge">{s.review ? s.review.excluded ? "已排除" : "已确认" : s.late ? "迟交待核对" : "待审核"}</span></button>)}
      <div className="pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 50))}</span><button disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>下一页</button></div>
    </section>{selected && activity ? <ReviewPanel key={`${selected.id}-${selected.version}`} submission={selected} rule={activity.rules[0].config} busy={busy} run={run} onSaved={async () => { setSelected(await api<Submission>(`/admin/submissions/${selected.id}`)); await refresh(); setMessage("已保存逐份审核记录。"); }} /> : <div className="panel empty"><ShieldCheck size={35} /><h3>选择一份作品开始评阅</h3><p>核对材料、身份及参与资格后，确认分项成绩。AI 分数仅作建议。</p></div>}</div>}
    {tab === "roster" && activity && <RosterPanel activity={activity} entries={roster} busy={busy} run={run} onSaved={refresh} />}
    {tab === "rules" && activity && <RulesPanel key={activity.id} activity={activity} run={run} onSaved={async () => { setActivities(await api<Activity[]>("/activities")); setMessage("已建立新的规则版本。旧审核需重新确认。"); }} />}
    {tab === "results" && <section className="panel"><h2>确认排名，再发布学分</h2><p className="muted">仅使用逐份确认的成绩。工作人员占最高档；发布后生成不可变版本，并将 HTML 与表格发送至管理邮箱。</p><button className="button primary" disabled={busy} onClick={() => void run(async () => setDraft(await post<Draft>(`/admin/activities/${activityId}/results/preview`)))}>生成排名与学分草案</button>
      {draft && <><div className="stats-row">{draft.usage.map(u => <div key={u.credits}><small>{u.credits} 分档</small><strong>{u.used}<span> / {u.capacity}</span></strong></div>)}</div>
        {!!draft.blockers.length && <div className="notice"><strong>发布前需要处理</strong><ul>{draft.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
        {!!draft.ties.length && <TiePanel ties={draft.ties} run={run} save={async decisions => { await post(`/admin/activities/${activityId}/tie-decisions`, decisions); setDraft(await post<Draft>(`/admin/activities/${activityId}/results/preview`)); }} />}
        <div className="table-scroll"><table><thead><tr><th>学号</th><th>姓名</th><th>类别</th><th>最终分</th><th>名次</th><th>学分</th><th>依据</th></tr></thead><tbody>{draft.rows.map((r, i) => <tr key={`${r.studentId}-${i}`}><td>{r.studentId}</td><td>{r.name}</td><td>{r.staff ? "工作人员" : "学生"}</td><td>{r.total ?? "—"}</td><td>{r.rank ?? "—"}</td><td>{r.credits}</td><td>{r.reason}</td></tr>)}</tbody></table></div>
        <button className="button primary" disabled={busy || !!draft.blockers.length} onClick={() => { if (window.confirm("确认发布此版本？正式名单将通过邮件发送，后续修改需生成新版本。")) void run(async () => { await post(`/admin/activities/${activityId}/results/publish`, { fingerprint: draft.fingerprint, idempotencyKey: crypto.randomUUID() }); await refresh(); setDraft(null); setMessage("正式结果已发布，报告邮件已加入队列。"); }); }}>确认发布正式结果</button></>}
      <h3 className="mt-8">历史发布版本</h3>{!snapshots.length && <p className="muted">尚未发布正式版本。</p>}{snapshots.map((s, i) => <div className="snapshot" key={s.id}><span><strong>版本 {s.version}</strong> · {date(s.createdAt)} {i > 0 && "（已被新版本替代）"}</span><div className="flex flex-wrap gap-2">{["xlsx", "csv", "html"].map(format => <button className="button secondary small" key={format} onClick={() => void run(() => download(`/admin/results/${s.id}/export?format=${format}`, `results-v${s.version}.${format}`))}><Download size={13} />{format.toUpperCase()}</button>)}<button className="button secondary small" onClick={() => void run(async () => { await post(`/admin/results/${s.id}/email`); setMessage("报告已加入重发队列，不会重复授分。"); })}>重发邮件</button></div></div>)}</section>}
    {tab === "operations" && operations && <OperationsPanel data={operations} run={run} refresh={refresh} />}
  </main>;
}

function ReviewPanel({ submission: s, rule, busy, run, onSaved }: { submission: Submission; rule: Rule; busy: boolean; run: (fn: () => Promise<void>) => Promise<void>; onSaved: () => Promise<void> }) {
  const [scores, setScores] = useState<Record<string, number>>(s.review?.scores ?? Object.fromEntries(rule.dimensions.map(d => [d.id, s.aiReview?.result.dimensionScores.find(x => x.id === d.id)?.score ?? 0])));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await run(async () => {
      await api(`/admin/submissions/${s.id}/review`, { method: "PUT", body: JSON.stringify({ version: s.version, scores, eligible: f.get("eligible") === "on", excluded: f.get("excluded") === "on", identityConfirmed: f.get("identityConfirmed") === "on", lateApproved: f.get("lateApproved") === "on", note: f.get("note"), archiveWaiver: f.get("archiveWaiver") }) });
      await onSaved();
    });
  }
  return <section className="panel review-detail"><div className="section-label">SUBMISSION / {s.id}</div><h2>{s.name} 的实践作品</h2><p className="muted">{s.studentId} · {s.email}</p>
    <p className={s.roster ? "notice" : "error"}>{s.roster ? `名单：${s.roster.name}，${s.roster.staff ? "工作人员" : "学生"}，参与资格${s.roster.eligible ? "有效" : "无效"}` : "不在参与名单中，请先导入或修正名单。"}</p>
    {s.candidates.length > 1 && <p className="notice">该学号有 {s.candidates.length} 份投稿。逐份排除旧版本或冒名材料，仅保留一份有效作品。</p>}
    <h3>原始材料</h3><pre className="material-text">{s.text || "无文字说明"}</pre>{s.link && <p className="muted break-all">作品链接（未自动访问）：{s.link}</p>}
    {s.attachments.map(f => <button className="file-download" key={f.id} onClick={() => void run(() => download(`/admin/attachments/${f.id}/download`, f.name))}><Download size={14} />{f.name} · {(f.size / 1024).toFixed(0)} KB</button>)}
    <p className="muted">邮箱归档：{s.archiveStatus}{s.late ? " · 本次提交为迟交" : ""}</p>
    <div className="ai-review"><h3>AI 辅助评阅</h3>{s.aiReview ? <><p>{s.aiReview.result.summary}</p><p className="muted">材料覆盖：{s.aiReview.result.coverage}</p>{s.aiReview.result.dimensionScores.map(d => <div key={d.id}><strong>{rule.dimensions.find(x => x.id === d.id)?.label}：{d.score} 分</strong><p>{d.reason}</p><small>证据：{d.evidenceRefs.join("，") || "未提供"}</small></div>)}{!!s.aiReview.result.missingEvidence.length && <p className="notice">需核查：{s.aiReview.result.missingEvidence.join("；")}</p>}<p>改进建议：{s.aiReview.result.improvements.join("；")}</p></> : <p className="muted">AI 尚无可用结果。可等待处理，或基于原件直接人工评分。</p>}</div>
    <form onSubmit={save}><h3>人工最终审核</h3><div className="form-grid">{rule.dimensions.map(d => <label key={d.id}>{d.label} / {d.max}<input type="number" min={0} max={d.max} step="0.01" required value={scores[d.id] ?? 0} onChange={e => setScores({ ...scores, [d.id]: Number(e.target.value) })} /></label>)}</div>
      <p>最终总分：<strong>{Object.values(scores).reduce((sum, n) => sum + n, 0).toFixed(2)}</strong></p>
      {[["identityConfirmed", "已核对学生身份", s.review?.identityConfirmed], ["eligible", "已确认有效参与资格", s.review?.eligible], ["lateApproved", "特批迟交（理由写入下方备注）", s.review?.lateApproved], ["excluded", "排除此份投稿，不参与排名", s.review?.excluded]].map(([key, label, checked]) => <label className="checkbox" key={String(key)}><input type="checkbox" name={String(key)} defaultChecked={Boolean(checked)} /><span>{label}</span></label>)}
      <label>审核依据与改分理由 *<textarea name="note" required rows={3} defaultValue={s.review?.note ?? ""} placeholder="记录核对结果、改分依据、迟交特批等。" /></label><label>原件邮件归档豁免理由（仅必要时）<input name="archiveWaiver" defaultValue={s.archiveWaiver ?? ""} /></label>
      <button className="button primary" disabled={busy}>保存此份审核</button>
    </form>
  </section>;
}

function RosterPanel({ activity, entries, busy, run, onSaved }: { activity: Activity; entries: unknown[]; busy: boolean; run: (f: () => Promise<void>) => Promise<void>; onSaved: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<{ entries: unknown[]; errors: unknown[] } | null>(null);
  const send = async (action: string) => { if (!file) throw new Error("请选择名单"); const form = new FormData(); form.append("file", file); return api<{ entries: unknown[]; errors: unknown[] }>(`/admin/activities/${activity.id}/roster/${action}`, { method: "POST", body: form }); };
  return <section className="panel"><h2>参与者与工作人员名单</h2><p className="muted">CSV / XLSX，最多 2 MiB。字段：学号、姓名、院系、专业、班级、参与资格、工作人员。布尔值填写“是/否”，学号使用文本单元格保留前导零。</p><p className="notice">导入按学号更新，不删除未出现的旧记录。要撤销资格，请将该学生“参与资格”改为“否”后重新导入。</p><input aria-label="名单文件" type="file" accept=".csv,.xlsx" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /><div className="flex gap-3 mt-4"><button className="button secondary" disabled={busy || !file} onClick={() => void run(async () => setPreview(await send("preview")))}>预览检查</button><button className="button primary" disabled={busy || !preview || !!preview.errors.length} onClick={() => void run(async () => { await send("import"); await onSaved(); setPreview(null); })}>确认导入</button></div>{preview && <><p>可导入 {preview.entries.length} 人，错误 {preview.errors.length} 项。</p><pre className="material-text">{JSON.stringify(preview.errors.length ? preview.errors : preview.entries.slice(0, 10), null, 2)}</pre></>}<h3 className="mt-8">当前名单：{entries.length} 人</h3><pre className="material-text">{entries.length ? JSON.stringify(entries, null, 2) : "尚未导入名单"}</pre></section>;
}
function RulesPanel({ activity, run, onSaved }: { activity: Activity; run: (f: () => Promise<void>) => Promise<void>; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(JSON.stringify(activity.rules[0].config, null, 2));
  return <form className="panel" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void run(async () => { await api(`/admin/activities/${activity.id}/rules`, { method: "PUT", body: JSON.stringify({ config: JSON.parse(value), invalidateReviews: form.get("invalidate") === "on" }) }); await onSaved(); }); }}><h2>评分与学分规则 · v{activity.rules[0].version}</h2><p className="muted">按 JSON 编辑任务、评分维度、合格线和学分名额。后端校验总分与档位合法性。</p><textarea aria-label="评分规则JSON" className="code-editor" rows={23} value={value} onChange={e => setValue(e.target.value)} /><label className="checkbox"><input type="checkbox" name="invalidate" /><span>我理解活动开始后修改规则会使旧审核失效，必须重新评分确认。</span></label><button className="button primary">保存新规则版本</button></form>;
}
function TiePanel({ ties, run, save }: { ties: Draft["ties"]; run: (f: () => Promise<void>) => Promise<void>; save: (d: { ids: string[]; reason: string }[]) => Promise<void> }) {
  return <form className="panel mt-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => save(ties.map((_, i) => ({ ids: String(f.get(`ids${i}`)).split(/[,，\s]+/).filter(Boolean), reason: String(f.get(`reason${i}`)) })))); }}><h3>同分边界人工裁定</h3>{ties.map((t, i) => <div key={i}><label>学号按优先顺序排列（逗号分隔）<input name={`ids${i}`} defaultValue={t.ids.join(",")} required /></label><label>裁定理由<input name={`reason${i}`} required /></label></div>)}<button className="button secondary">保存裁定并重新计算</button></form>;
}
function OperationsPanel({ data, run, refresh }: { data: Operations; run: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [inbound, setInbound] = useState<Inbound | null>(null), [correction, setCorrection] = useState(""), [reason, setReason] = useState("");
  return <section className="panel"><h2>邮件投递与后台运行</h2><div className="stats-row"><div><small>邮箱</small><strong>{data.configuration.mailEnabled ? "已启用" : "未配置"}</strong></div><div><small>AI</small><strong>{data.configuration.aiEnabled ? "已启用" : "未配置"}</strong></div><div><small>模型</small><strong className="model-name">{data.configuration.model}</strong></div></div><pre className="material-text">{JSON.stringify(data.services, null, 2)}</pre><button className="button secondary" onClick={() => void run(async () => { await post("/admin/ai/resume"); await refresh(); })}>修复配置后恢复 AI</button>
    <h3 className="mt-8">后台任务</h3><div className="table-scroll"><table><thead><tr><th>类型</th><th>状态</th><th>错误</th><th>操作</th></tr></thead><tbody>{data.jobs.map(j => <tr key={j.id}><td>{j.kind}</td><td>{j.status}</td><td>{j.error}</td><td>{["failed", "blocked"].includes(j.status) && <button onClick={() => void run(async () => { await post(`/admin/jobs/${j.id}/retry`); await refresh(); })}>重试</button>}</td></tr>)}</tbody></table></div>
    <h3 className="mt-8">出站邮件</h3><div className="table-scroll"><table><thead><tr><th>类型</th><th>收件邮箱</th><th>状态</th><th>错误</th><th>操作</th></tr></thead><tbody>{data.mails.map(m => <tr key={m.id}><td>{m.kind}</td><td>{m.recipient}</td><td>{m.status}</td><td>{m.error}</td><td>{["failed", "uncertain", "retry"].includes(m.status) && <div className="flex gap-2">{[["retry", "重新发送"], ["sent", "确认已收到"]].map(([action, label]) => <button key={action} onClick={() => { const reason = window.prompt("请填写核查结果或处理理由"); if (reason) void run(async () => { await post(`/admin/mails/${m.id}/resolve`, { action, reason }); await refresh(); }); }}>{label}</button>)}</div>}</td></tr>)}</tbody></table></div>
    <h3 className="mt-8">待处理来信</h3>{data.inbound.map(m => <button className="submission-item" key={m.id} onClick={() => void run(async () => { const detail = await api<Inbound>(`/admin/inbound/${m.id}`); setInbound(detail); setCorrection(JSON.stringify(detail.suggested ?? {}, null, 2)); })}>{m.error}</button>)}
    {inbound && <div className="panel mt-4"><h3>{inbound.subject ?? "待处理邮件"}</h3><p className="muted">修正字段时请保留真实信息；consent 只有取得投稿者同意后才能设为 true。</p><textarea aria-label="来信修正JSON" className="code-editor" rows={12} value={correction} onChange={e => setCorrection(e.target.value)} /><label>处理理由<input value={reason} onChange={e => setReason(e.target.value)} /></label><div className="flex gap-3">{[["accept", "确认修正并接收"], ["reject", "排除此邮件"]].map(([action, label]) => <button className="button secondary" key={action} disabled={!reason.trim()} onClick={() => void run(async () => { await post(`/admin/inbound/${inbound.id}/resolve`, { action, reason, ...(action === "accept" ? { submission: JSON.parse(correction) } : {}) }); setInbound(null); setReason(""); await refresh(); })}>{label}</button>)}</div></div>}
    <details className="mt-8"><summary>模型用量（最近100份）</summary><pre className="material-text">{JSON.stringify(data.usage, null, 2)}</pre></details><details><summary>管理员操作审计</summary><pre className="material-text">{JSON.stringify(data.audit, null, 2)}</pre></details>
  </section>;
}
