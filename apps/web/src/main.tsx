import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { ArrowUpRight, Code2 } from "lucide-react";
import { ActivityPage } from "./pages/ActivityPage";
import { AdminPage } from "./pages/admin/AdminPage";
import "./styles.css";
const activityLinks = [["/activities/agent-workshop-2026-01", "Agent 工坊", "tone-workshop"], ["/activities/cross-major-ai-2026", "跨专业体验赛", "tone-competition"]];
function Nav() {
  const { pathname } = useLocation(), current = pathname === "/" ? activityLinks[0][0] : pathname;
  return <nav aria-label="主导航">{activityLinks.map(([to, label, tone]) => <Link key={to} className={`nav-link ${tone}`} to={to} aria-current={current === to ? "page" : undefined}>{label}</Link>)}<Link className="admin-link" to="/admin">管理入口 <ArrowUpRight size={14} /></Link></nav>;
}
function App() {
  return <BrowserRouter>
    <header className="site-header"><div className="header-inner"><Link className="brand" to="/"><span className="brand-icon"><Code2 size={22} /></span><span>智码实践<small>安徽工业大学 · 软件编程协会</small></span></Link><Nav /></div></header>
    <Routes><Route path="/" element={<ActivityPage />} /><Route path="/activities/:slug" element={<ActivityPage />} /><Route path="/admin" element={<AdminPage />} /><Route path="*" element={<main className="shell"><h1>页面不存在</h1><Link to="/">返回活动首页</Link></main>} /></Routes>
    <footer className="site-footer"><div className="footer-inner"><div className="footer-brand"><span className="brand-icon"><Code2 size={17} /></span><span>AHU SOFTWARE PROGRAMMING ASSOCIATION</span></div><div><p>主办：安徽工业大学社团联合会 · 承办：软件编程协会</p><p>实践有记录，成长有回响。系统授分记录不等于学校官方学分入账。</p></div></div></footer>
  </BrowserRouter>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
