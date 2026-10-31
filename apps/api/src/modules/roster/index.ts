import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { rosterSchema, AppError } from "../../../../../packages/contracts/src/index.js";
const headers: Record<string, string> = { "学号": "studentId", "姓名": "name", "院系": "department", "专业": "major", "班级": "className", "参与资格": "eligible", "工作人员": "staff" };
export async function parseRoster(buffer: Buffer, filename: string) {
  let rows: Record<string, unknown>[];
  if (/\.csv$/i.test(filename)) rows = parse(buffer, { bom: true, columns: true, skip_empty_lines: true, max_record_size: 10000 });
  else if (/\.xlsx$/i.test(filename)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 10001) throw new AppError(422, "ROSTER", "名单为空或超过10000行");
    const keys = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    rows = [];
    sheet.eachRow((row, i) => {
      if (i === 1) return;
      const r: Record<string, unknown> = {};
      keys.forEach((k, index) => {
        const cell = row.getCell(index + 1);
        if (cell.type === ExcelJS.ValueType.Formula) throw new AppError(422, "ROSTER_FORMULA", "名单不能含公式");
        r[k] = cell.text;
      });
      rows.push(r);
    });
  } else throw new AppError(415, "ROSTER_FORMAT", "名单仅支持 CSV 或 XLSX");
  if (!rows.length || rows.length > 10000) throw new AppError(422, "ROSTER", "名单需为1到10000行");
  const errors: { row: number; message: string }[] = [];
  const entries: ReturnType<typeof rosterSchema.parse>[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const normalized: Record<string, unknown> = {};
    Object.entries(row).forEach(([k, v]) => { normalized[headers[k] ?? k] = v; });
    for (const key of ["eligible", "staff"]) {
      const value = String(normalized[key] ?? "").trim().toLowerCase();
      normalized[key] = ["true", "是", "1"].includes(value) ? true : ["false", "否", "0"].includes(value) ? false : value;
    }
    const result = rosterSchema.safeParse(normalized);
    if (!result.success) errors.push({ row: i + 2, message: result.error.issues.map(x => `${x.path.join(".")}: ${x.message}`).join("；") });
    else if (seen.has(result.data.studentId)) errors.push({ row: i + 2, message: "学号重复" });
    else { seen.add(result.data.studentId); entries.push(result.data); }
  });
  return { entries, errors };
}
