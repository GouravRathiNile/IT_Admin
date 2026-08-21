const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { generateCSV, generateExcel } = require("../../utils/exportHelper");
const { listResponseDTO, completeReportDTO } = require("../../dto/GuestGlitchDTO");
const { compactDTO, detailDTO } = require("../../dto/IncidentReportDTO");
const { pool } = require("../../db");
const guestRepository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const incidentRepository = require("../../repositories/IncidentReportRepository/IncidentReportRepository");

const columns = [
  { key: "Name", header: "Name", width: 20 },
  { key: "Value", header: "Value", width: 12 },
];

test("shared CSV helper escapes values and writes blanks", () => {
  const csv = generateCSV([{ Name: 'A, "quoted"\nvalue', Value: null }], columns).toString("utf8");
  assert.ok(csv.startsWith("\uFEFFName,Value"));
  assert.match(csv, /"A, ""quoted""\nvalue",/);
  assert.equal(csv.includes("null"), false);
  assert.equal(csv.includes("undefined"), false);
});

test("shared Excel helper creates styled and readable workbook", async () => {
  const output = await generateExcel([{ Name: "Guest", Value: 125.5 }], columns, "Report");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  const sheet = workbook.getWorksheet("Report");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.autoFilter, "A1:B1");
  assert.equal(sheet.getRow(1).font.bold, true);
  assert.equal(sheet.getCell("B2").value, 125.5);
  assert.equal(sheet.getCell("A2").alignment.wrapText, true);
});

test("Guest Glitch response DTOs use centralized display dates", () => {
  const row = { entrydate: "2026-08-20", checkindate: "2026-08-19", checkoutdate: "2026-08-21", createddate: "2026-08-20T12:30:00Z", modifydate: "2026-08-20T13:45:00Z" };
  assert.equal(listResponseDTO(row).EntryDate, "20 Aug 2026");
  const detail = completeReportDTO(row);
  assert.equal(detail.CheckInDate, "19 Aug 2026");
  assert.match(detail.CreatedDate, /^20 Aug 2026 \d{2}:\d{2}$/);
  assert.match(detail.ModifyDate, /^20 Aug 2026 \d{2}:\d{2}$/);
});

test("Incident Report response DTOs format dates while retaining audit time", () => {
  const row = { id: "1", organizationid: 10, reportdate: "2026-08-20", incidentdate: "2026-08-19", createddate: "2026-08-20T12:30:00Z", modifydate: "2026-08-20T13:45:00Z" };
  assert.equal(compactDTO(row).ReportDate, "20 Aug 2026");
  const detail = detailDTO(row);
  assert.equal(detail.IncidentDate, "19 Aug 2026");
  assert.match(detail.CreatedDate, /^20 Aug 2026 \d{2}:\d{2}$/);
  assert.match(detail.ModifyDate, /^20 Aug 2026 \d{2}:\d{2}$/);
});

test("export repository mode reuses filters without LIMIT or OFFSET", async () => {
  const original = pool.query;
  const sql = [];
  try {
    pool.query = async (query) => { sql.push(query); return { rows: [] }; };
    await guestRepository.reportList({ page: 3, pageSize: 1, sortBy: "EntryDate", sortDirection: "DESC", departmentIds: [] }, 10, false);
    await incidentRepository.list({ page: 3, pageSize: 1, sortBy: "ReportDate", sortDirection: "DESC" }, 10, true, false);
    assert.equal(sql.length, 2);
    for (const query of sql) {
      assert.equal(/\bLIMIT\b/i.test(query), false);
      assert.equal(/\bOFFSET\b/i.test(query), false);
      assert.match(query, /organizationid = \$1/i);
      assert.match(query, /isdeleted = FALSE/i);
    }
  } finally { pool.query = original; }
});
