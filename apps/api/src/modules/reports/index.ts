import ExcelJS from "exceljs";
import type { Rule } from "../../../../../packages/contracts/src/index.js";
import type { ResultRow } from "../../../../../packages/domain/src/index.js";

export type ReportData = { title: string; slug: string; rule: Rule; ruleVersion: number; rows: ResultRow[]; usage: { credits: number; capacity: number; used: number }[] };
export const escapeHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export async function renderReport(data: ReportData, version: number, format: "html" | "csv" | "xlsx") {
  const columns = ["活动", "发布版本", "学号", "姓名", "院系", "专业", "班级", "人员类别", "提交编号", "提交时间", "AI建议分", "人工最终分",
    ...data.rule.dimensions.map(d => d.label), "名次", "学分", "审核状态", "授分依据", "备注"];
  const values = (r: ResultRow) => [data.title, version, r.studentId, r.name, r.department, r.major, r.className, r.staff ? "工作人员" : "学生",
    r.submissionId ?? "", r.receivedAt ?? "", r.aiTotal ?? "", r.total ?? "", ...data.rule.dimensions.map(d => r.scores?.[d.id] ?? ""),
    r.rank ?? "", r.credits, r.confirmed ? "已确认" : "未确认", r.reason, r.note ?? ""];
  if (format === "csv") return Buffer.from("\ufeff" + [columns, ...data.rows.map(values)].map(row => row.map(csvCell).join(",")).join("\r\n"));
  if (format === "html") return Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(data.title)} 结果</title><style>body{font:15px/1.7 sans-serif;color:#152a38;margin:32px}h1{font-size:28px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd8dd;padding:8px;text-align:left}th{background:#eaf3f0}.notice{padding:16px;background:#fff5db}</style></head><body><h1>${escapeHtml(data.title)}</h1><p>正式结果 · 版本 ${version} · 规则版本 ${data.ruleVersion}</p><p class="notice">仅供活动管理使用。此表为经管理员确认的系统授分名单，不代表学校已完成官方学分入账。</p><p>${data.usage.map(t => `${t.credits}分档：${t.used}/${t.capacity}人`).join("；")}</p><p>记录 ${data.rows.length} 人，获得学分 ${data.rows.filter(r => r.credits > 0).length} 人；合格学生 ${data.rows.filter(r => !r.staff && r.total !== null && r.total >= data.rule.passScore).length} 人。</p><table><thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${data.rows.map(r => `<tr>${values(r).map(v => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table><h2>评分标准</h2><p>${escapeHtml(data.rule.task)}</p><p>${data.rule.dimensions.map(d => `${escapeHtml(d.label)} ${d.max}分`).join("；")}；合格线 ${data.rule.passScore}分。</p></body></html>`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "安徽工业大学软件编程协会";
  const summary = workbook.addWorksheet("活动汇总");
  summary.addRows([["活动", data.title], ["发布版本", version], ["人数", data.rows.length], ["说明", "系统记录不等于学校官方入账"], ["档位", "人数", "名额"]]);
  data.usage.forEach(t => summary.addRow([t.credits, t.used, t.capacity]));
  const sheets: [string, ResultRow[]][] = [
    ["学生成绩", data.rows.filter(r => !r.staff)], ["工作人员", data.rows.filter(r => r.staff)],
    ["学分名单", data.rows.filter(r => r.credits > 0)], ["异常和未获学分", data.rows.filter(r => r.credits === 0)],
  ];
  for (const [name, rows] of sheets) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(columns);
    rows.forEach(r => sheet.addRow(values(r)));
    sheet.getColumn(3).numFmt = "@";
    sheet.columns.forEach(c => { c.width = 20; });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174A49" } };
  }
  const rules = workbook.addWorksheet("量表及版本");
  rules.addRows([["规则版本", data.ruleVersion], ["任务", data.rule.task], ["合格线", data.rule.passScore], ...data.rule.dimensions.map(d => [d.label, d.max])]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
