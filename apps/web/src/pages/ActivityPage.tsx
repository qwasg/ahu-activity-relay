import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Layers3, Mail, Users } from "lucide-react";
import { api, date, type Activity } from "../api";
import { SubmissionPage } from "./SubmissionPage";
import workshopHero from "../assets/activities/workshop-hero-1536.webp";
import workshopHeroSmall from "../assets/activities/workshop-hero-768.webp";
import workshopPractice from "../assets/activities/workshop-practice-1024.webp";
import workshopPracticeSmall from "../assets/activities/workshop-practice-640.webp";
import competitionHero from "../assets/activities/competition-hero-1536.webp";
import competitionHeroSmall from "../assets/activities/competition-hero-768.webp";
import competitionPractice from "../assets/activities/competition-practice-1024.webp";
import competitionPracticeSmall from "../assets/activities/competition-practice-640.webp";
const content = {
  workshop: {
    issue: "WORKSHOP / 01", headline: <>从理解 AI，<br />到<span>亲手创造。</span></>,
    hero: [workshopHero, workshopHeroSmall, "AI 智能体在悬浮的工作台上，把界面卡片组装成一个个人网站"],
    practice: [workshopPractice, workshopPracticeSmall, "书桌上的笔记本电脑前，AI 助手把资料卡、作品集和联系方式放进个人主页"],
    tags: ["ReAct", "MCP", "Skill"],
    flow: [["START WITH AN IDEA", "一个想法"], ["BUILD WITH AI", "提示词 × Agent"], ["MAKE IT YOURS", "你的个人展示网站"]],
    steps: ["入群获取录播课程与任务说明", "借助 Agent 完成个人网站实践", "提交作品和过程记录，等待复核"],
    other: { slug: "cross-major-ai-2026", issue: "CHALLENGE / 02", title: "跨专业 AI 实操体验赛", image: competitionHeroSmall },
  },
  competition: {
    issue: "CHALLENGE / 02", headline: <>让你的专业，<br /><span>遇见 AI 的可能。</span></>,
    hero: [competitionHero, competitionHeroSmall, "冶金、建筑、化学、经济、设计与电子等专业元素，被光带汇聚到同一个 AI 光点"],
    practice: [competitionPractice, competitionPracticeSmall, "工作台上的三角尺、植物传感器、书本、试管与平板，被光线连接到一个 AI 光球"],
    tags: ["无需复杂编程", "真实专业问题"],
    flow: [["START WITH A QUESTION", "一个专业问题"], ["BUILD WITH AI", "专业知识 × AI 工具"], ["MAKE IT YOURS", "你的跨专业作品"]],
    steps: ["选择一个本专业的真实场景", "运用 AI 工具完成实操与验证", "提交专业作品和 AI 使用过程"],
    other: { slug: "agent-workshop-2026-01", issue: "WORKSHOP / 01", title: "智码 Agent 工坊", image: workshopHeroSmall },
  },
};
export function ActivityPage() {
  const { slug = "agent-workshop-2026-01" } = useParams();
  const [activity, setActivity] = useState<Activity | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let current = true; setActivity(null); setError("");
    api<Activity>(`/activities/${slug}`).then(a => { if (current) setActivity(a); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [slug]);
  useEffect(() => {
    if (!activity) return;
    const root = document.documentElement;
    root.dataset.theme = activity.slug === "agent-workshop-2026-01" ? "workshop" : "competition";
    document.title = `${activity.title} · 智码实践`;
    return () => { delete root.dataset.theme; document.title = "智码实践 · 软件编程协会"; };
  }, [activity]);
  if (error) return <main className="page-state"><div className="error" role="alert">{error}</div><p className="muted">请确认后端已运行并初始化活动数据。</p></main>;
  if (!activity) return <main className="page-loading" aria-busy="true"><div className="skeleton hero-skeleton" /><div className="facts-skeleton"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div><p className="muted">正在加载活动资料…</p></main>;
  const workshop = activity.slug === "agent-workshop-2026-01", rule = activity.rules[0].config, c = content[workshop ? "workshop" : "competition"];
  const now = Date.now(), open = now >= Date.parse(activity.startsAt) && now <= Date.parse(activity.endsAt);
  const [hero, heroSmall, heroAlt] = c.hero, [practice, practiceSmall, practiceAlt] = c.practice;
  return <main className={workshop ? "activity workshop" : "activity competition"}>
    <section className="hero-stage">
      <div className="hero">
        <div className="hero-art"><img src={hero} srcSet={`${heroSmall} 768w, ${hero} 1536w`} sizes="(max-width: 760px) 100vw, 900px" width={1536} height={1024} alt={heroAlt} fetchPriority="high" /></div>
        <div className="hero-copy"><div className="eyebrow"><span className="status-dot" /> 2026 秋季实践计划 <span className="badge">{open ? "正在进行" : now < Date.parse(activity.startsAt) ? "即将开始" : "活动已结束"}</span></div>
          <p className="issue">{c.issue}</p>
          <h1>{c.headline}</h1>
          <h2>{activity.title}</h2><p className="hero-description">{activity.description}</p>
          <div className="hero-actions"><a className="button primary" href="#submission">提交实践作品 <ArrowUpRight size={18} /></a><a className="text-link" href="#task">了解任务 <ArrowDown size={16} /></a></div>
          <p className="hero-note">面向安徽工业大学全体学生 · 线上参与 · 创新创业学分</p>
        </div>
        <ol className="hero-flow" aria-label={workshop ? "从想法到个人网站的实践过程" : "从专业问题到AI作品的实践过程"}>
          {c.flow.map(([en, zh], i) => <li key={en} className={i === 1 ? "active" : undefined}><span>{String(i + 1).padStart(2, "0")}</span><div><small>{en}</small><strong>{zh}</strong></div>{i < c.flow.length - 1 && <ArrowRight className="flow-arrow" size={18} aria-hidden="true" />}</li>)}
        </ol>
      </div>
    </section>
    <section className="facts" aria-label="活动信息">
      <div className="fact"><span className="fact-icon"><CalendarDays size={21} /></span><div><small>报名时间</small><strong>{date(activity.registrationStart)} 起</strong><p>至 {date(activity.registrationEnd)}</p></div></div>
      <div className="fact"><span className="fact-icon"><Layers3 size={21} /></span><div><small>实践与提交</small><strong>{date(activity.startsAt)} 起</strong><p>至 {date(activity.endsAt)} · 北京时间</p></div></div>
      <div className="fact"><span className="fact-icon"><Users size={21} /></span><div><small>活动交流群</small><strong>线上学习 · 群内答疑</strong><p className="group-chips">{activity.groups.map(g => <span key={g}>{g}</span>)}</p></div></div>
    </section>
    <section id="task" className="practice">
      <figure className="practice-art"><img src={practice} srcSet={`${practiceSmall} 640w, ${practice} 1024w`} sizes="(max-width: 900px) 100vw, 520px" width={1024} height={1024} alt={practiceAlt} loading="lazy" decoding="async" />
        <figcaption>{c.tags.map(t => <span key={t}>{t}</span>)}</figcaption></figure>
      <div><div className="section-label">01 / THE PRACTICE</div><h2 className="section-title">学以致用，<br />交出你的答案。</h2><p className="lead">{rule.task}</p>
        <ol className="steps">{c.steps.map((s, i) => <li key={s}><span>{String(i + 1).padStart(2, "0")}</span><p>{s}</p></li>)}</ol>
      </div>
    </section>
    <section className="scoring" aria-labelledby="rubric-title">
      <div className="scoring-head"><div><div className="section-label">02 / THE RUBRIC</div><h2 className="section-title" id="rubric-title">作品如何评价</h2></div><p><span className="badge">100 分制</span>AI 辅助分析，管理员逐份确认最终成绩。</p></div>
      <div className="scoring-grid">
        <div className="rubric panel"><div className="rubric-bar" aria-hidden="true">{rule.dimensions.map((d, i) => <span key={d.id} className={`seg-${i % 5}`} style={{ flexGrow: d.max }} />)}</div>
          <ul className="rubric-list">{rule.dimensions.map((d, i) => <li key={d.id}><span><i className={`seg-${i % 5}`} aria-hidden="true" />{d.label}</span><strong>{d.max}<small> 分</small></strong></li>)}</ul>
        </div>
        <div className="credits"><div className="pass"><small>合格线</small><strong>{rule.passScore}<span> 分</span></strong><p>达到合格线，并须核对有效参与资格。</p></div>
          <ul className="tiers">{rule.tiers.map(t => <li key={t.credits}><strong>{t.credits}</strong><span>学分</span><em>{t.capacity} 人</em></li>)}</ul>
          <small>工作人员占最高档名额；各档不累计，同分边界人工裁定。</small>
        </div>
      </div>
    </section>
    <section id="submission" className="submission-section"><div className="submission-grid"><div className="submission-intro"><div className="section-label">03 / YOUR SUBMISSION</div><h2 className="section-title">让实践，<br />留下记录。</h2><p className="muted">直接填写信息并上传，无需注册。请如实填写学号和姓名，管理员会在成绩发布前核对。</p>
      <div className="email-card"><div className="email-head"><span className="fact-icon"><Mail size={20} /></span><div><h3>也可以通过邮箱投稿</h3><a href={`mailto:${activity.mailbox}`}>{activity.mailbox}</a></div></div><p>邮件标题</p><code>[{activity.slug}] 学号 姓名</code><p>邮件正文请包含</p><pre>院系：你的院系{"\n"}专业：你的专业{"\n"}班级：你的班级{"\n"}同意邮箱归档和AI分析：是{"\n"}作品说明：实践过程与成果</pre><small>附件要求与网页一致。未经同意的邮件不会自动送至 AI 分析。</small></div>
      <Link className="other-activity" to={`/activities/${c.other.slug}`}><img src={c.other.image} alt="" width={768} height={512} loading="lazy" decoding="async" /><span><small>看看另一场活动 <span>{c.other.issue}</span></small><strong>{c.other.title}</strong></span><ArrowUpRight size={20} /></Link>
    </div><SubmissionPage key={activity.id} activity={activity} /></div></section>
  </main>;
}
