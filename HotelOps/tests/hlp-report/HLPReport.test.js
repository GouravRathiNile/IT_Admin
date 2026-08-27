const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../../services/HLPReportService/HLPReportService");
const { generatePdf, loadLogo } = require("../../utils/pdfHelper");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("HLP routes expose the approved authenticated API contract", () => {
  const source = read("routes/HLPReportRoutes/HLPReportRoutes.js");
  assert.match(source, /router\.use\(authenticateToken\)/);
  assert.match(source, /router\.get\("\/master-list"/);
  assert.match(source, /router\.post\("\/master-list"/);
  assert.match(source, /router\.put\("\/master-list\/reorder", controller\.reorderMasterFields\)/);
  assert.match(source, /router\.put\("\/master-list"/);
  assert.match(source, /router\.delete\("\/master-list"/);
  assert.match(source, /router\.post\("\/create"/);
  assert.match(source, /router\.put\("\/update"/);
  assert.match(source, /router\.get\("\/monthly-report"/);
  assert.match(source, /router\.get\("\/last-year-report"/);
  assert.match(source, /router\.get\("\/:id\/pdf", controller\.reportPdf\)/);
});

test("HLP queue and server registrations are present", () => {
  assert.match(read("config/queue.js"), /HLP_REPORT[\s\S]*hlp_report_request_queue[\s\S]*hlp_report_response_queue/);
  const index = read("index.js");
  assert.match(index, /app\.use\("\/api\/HLPReport", HLPReportRoutes\)/);
  assert.match(index, /QUEUE\.HLP_REPORT\.REQUEST/);
  assert.match(index, /HLPReportHandler/);
});

test("date validation rejects impossible dates", () => {
  assert.equal(service.isRealDate("2026-08-21"), true);
  assert.equal(service.isRealDate("2026-02-29"), false);
  assert.equal(service.isRealDate("2024-02-29"), true);
  assert.equal(service.isRealDate("21-08-2026"), false);
});

test("numeric total eligibility accepts numeric text and rejects mixed text", () => {
  assert.equal(service.numericValue("120"), true);
  assert.equal(service.numericValue("-2.5"), true);
  assert.equal(service.numericValue("120 rooms"), false);
});

test("handler declares existing and master configuration actions", () => {
  const source = read("consumer/HLPReportConsumer/HLPReportHandler.js");
  for (const action of ["GET_HLP_MASTER_LIST", "CREATE_HLP_MASTER_FIELD", "UPDATE_HLP_MASTER_FIELD", "REORDER_HLP_MASTER_FIELDS", "DELETE_HLP_MASTER_FIELD", "CREATE_HLP_REPORT", "UPDATE_HLP_REPORT", "GET_HLP_MONTHLY_REPORT", "GET_HLP_LAST_YEAR_REPORT"]) {
    assert.match(source, new RegExp(`case "${action}"`));
  }
});

test("report update changes the existing parent and preserves inactive historical details", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /SELECT id, organizationid FROM hlpreport_entry_master WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /id = ANY\(\$1::bigint\[\]\) AND isactive = TRUE/);
  assert.match(source, /UPDATE hlpreport_entry_details[\s\S]*WHERE masterid = \$4 AND title = \$5/);
  assert.doesNotMatch(source, /DELETE FROM hlpreport_entry_details/);
  assert.match(source, /UPDATE hlpreport_entry_master[\s\S]*modifydatetime = CURRENT_TIMESTAMP/);
});

test("exact-date report exposes the existing report ID and configured MasterID", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /ml\.id AS "MasterID"/);
  assert.match(source, /data: \{ ID: Number\(entry\.rows\[0\]\.id\), EntryDate/);
});

test("master list and create integrity use only active configured fields", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /WHERE isactive = TRUE/);
  assert.match(source, /id = ANY\(\$1::bigint\[\]\) AND isactive = TRUE/);
  assert.match(source, /isactive = FALSE, orderby = NULL, modifyby/);
});

test("report controller accepts optional lowercase organization filters", () => {
  const source = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(source, /organizationId \?\? req\.query\?\.OrganizationID/);
  assert.match(source, /entryDate \?\? req\.query\?\.EntryDate/);
});

test("HLP PDF uses the existing queue flow and returns inline binary headers", () => {
  const handler = read("consumer/HLPReportConsumer/HLPReportHandler.js");
  const controller = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(handler, /case "GENERATE_HLP_REPORT_PDF"/);
  assert.match(controller, /Buffer\.from\(response\.pdfBase64, "base64"\)/);
  assert.match(controller, /Content-Type", "application\/pdf"/);
  assert.match(controller, /inline; filename=\"\$\{response\.filename\}\"/);
});

test("monthly and last-year PDF routes precede the generic ID PDF route", () => {
  const source = read("routes/HLPReportRoutes/HLPReportRoutes.js");
  const monthly = source.indexOf('router.get("/monthly-report/pdf"');
  const lastYear = source.indexOf('router.get("/last-year-report/pdf"');
  const generic = source.indexOf('router.get("/:id/pdf"');
  assert.ok(monthly >= 0 && lastYear >= 0 && generic > monthly && generic > lastYear);
});

test("report PDF actions reuse existing report service calculations", () => {
  const handler = read("consumer/HLPReportConsumer/HLPReportHandler.js");
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(handler, /case "GENERATE_HLP_MONTHLY_REPORT_PDF"/);
  assert.match(handler, /case "GENERATE_HLP_LAST_YEAR_REPORT_PDF"/);
  assert.match(source, /const report = await getMonthlyReport\(data\)/);
  assert.match(source, /const report = await getLastYearReport\(data\)/);
  assert.match(source, /HLP-Monthly-Report-\$\{period\}\.pdf/);
  assert.match(source, /HLP-Last-Year-Report-\$\{period\}\.pdf/);
});

test("monthly PDF generator supports 28, 29, 30, and 31 day months", async () => {
  for (const [year, month, expectedDays] of [[2026, 2, 28], [2024, 2, 29], [2026, 4, 30], [2026, 8, 31]]) {
    const row = { Title: "Occupancy (%)", Total: 82.5 };
    for (let day = 1; day <= expectedDays; day += 1) row[String(day)] = day === 1 ? "82.5" : null;
    const pdf = await generatePdf({
      title: "HLP MONTHLY REPORT", reportName: "HLP Monthly Report", orientation: "landscape",
      columns: [{ key: "Title", header: "Title", width: 68, align: "left" }, ...Array.from({ length: expectedDays }, (_, index) => ({ key: String(index + 1), header: String(index + 1), width: 20, align: "center" })), { key: "Total", header: "Total", width: 34, align: "center" }], rows: [row],
    });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.match(pdf.toString("latin1"), /\/Count\s+1\b/);
  }
});

test("monthly PDF uses the compact single-page landscape table layout", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  const helper = read("utils/pdfHelper.js");
  assert.match(source, /orientation: "landscape"/);
  assert.match(source, /width: dayWidth/);
  assert.match(source, /paddingLeft: \(\) => 1, paddingRight: \(\) => 1/);
  assert.match(source, /noWrap: false/);
  assert.match(helper, /Generated: \$\{timestamp\}/);
  assert.match(helper, /Page \$\{page\} of \$\{count\}/);
});

test("master list ordering is backend controlled and active state is not publicly selected", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /MAX\(orderby\), 0\) \+ 1 AS orderby/);
  assert.match(source, /Only Title can be supplied when creating an HLP master field/);
  assert.match(source, /Only ID and Title can be supplied when updating an HLP master field/);
  assert.match(source, /ORDER BY orderby NULLS LAST, id/);
  assert.match(source, /SELECT id AS "ID", title AS "Title", orderby AS "OrderBy"/);
  assert.match(source, /result\.rows\.map\(\(row\) => \(\{ \.\.\.row, YOD: "", LYOD: "" \}\)\)/);
});

test("master list adds blank YOD and LYOD placeholders without changing existing fields", async () => {
  const pool = require("../../db").pool;
  const originalConnect = pool.connect;
  try {
    pool.connect = async () => ({
      query: async () => ({ rows: [{ ID: "1", Title: "Rooms Occupied", OrderBy: 1 }] }),
      release() {},
    });
    const response = await service.getMasterList({ UserID: 1 });
    assert.deepEqual(response.data, [{ ID: "1", Title: "Rooms Occupied", OrderBy: 1, YOD: "", LYOD: "" }]);
  } finally { pool.connect = originalConnect; }
});

test("reorder validation rejects malformed, duplicate and discontinuous orders", async () => {
  assert.match((await service.reorderMasterFields({ UserID: 1, items: [] })).message, /non-empty array/);
  assert.match((await service.reorderMasterFields({ UserID: 1, items: [{ ID: 1, OrderBy: 1 }, { ID: 1, OrderBy: 2 }] })).message, /Duplicate HLP master field ID/);
  assert.match((await service.reorderMasterFields({ UserID: 1, items: [{ ID: 1, OrderBy: 1 }, { ID: 2, OrderBy: 1 }] })).message, /Duplicate OrderBy/);
  assert.match((await service.reorderMasterFields({ UserID: 1, items: [{ ID: 1, OrderBy: 1 }, { ID: 2, OrderBy: 3 }] })).message, /continuous sequence/);
});

test("reorder and delete use transactions and safe two-phase resequencing", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /const reorderMasterFields[\s\S]*BEGIN[\s\S]*FOR UPDATE[\s\S]*orderby = -id[\s\S]*unnest[\s\S]*COMMIT/);
  assert.match(source, /const deleteMasterField[\s\S]*BEGIN[\s\S]*isactive = FALSE, orderby = NULL[\s\S]*orderby = -orderby[\s\S]*ROW_NUMBER[\s\S]*COMMIT/);
});

test("HLP PDFs share the requested logo, metadata, and footer design", () => {
  const pdfSource = read("utils/pdfHelper.js");
  const serviceSource = read("services/HLPReportService/HLPReportService.js");

  assert.match(pdfSource, /const buildHeader = async \(title, organizationId, logoUrl\)/);
  assert.match(pdfSource, /const fallbackLogo = \(\)/);
  assert.match(pdfSource, /const footer = \(reportName, timestamp\)/);
  assert.match(pdfSource, /widths: \[72, "\*", 72, "\*"\]/);
  assert.match(serviceSource, /FROM organization_master_logo/);
  assert.match(serviceSource, /AS createdbyname/);
});

test("individual HLP PDF exposes only the approved compact metadata", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  const individual = source.match(/const generateReportPdf[\s\S]*?const reportOrganizationMetadata/)?.[0] || "";
  for (const label of ["Report ID", "Organization", "Entry Date", "Created By"]) {
    assert.match(individual, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(individual, /label: "Created On"|label: "Modified/);
});

test("last-year PDF generator returns the exact YOD and LYOD rows as PDF", async () => {
  const pdf = await generatePdf({ title: "HLP LAST YEAR SAME DAY REPORT", reportName: "HLP Last Year Report", columns: [{ key: "Title", header: "Title", align: "left" }, { key: "YOD", header: "Yesterday (YOD)", align: "center" }, { key: "LYOD", header: "Last Year Same Day (LYOD)", align: "center" }], rows: [{ Title: "Revenue", YOD: "125.75", LYOD: "110.25" }] });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});

test("monthly PDF no-data detection ignores configured blank rows and accepts decimal values", () => {
  assert.equal(service.hasMonthlyReportData([{ ID: 1, Title: "Revenue", "1": null, Total: 0 }]), false);
  assert.equal(service.hasMonthlyReportData([{ ID: 1, Title: "Revenue", "1": "82.5", Total: 82.5 }]), true);
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /No HLP monthly report data found\./);
  assert.match(source, /HLP report was not found for the selected date\./);
});

test("PDF controllers preserve optional organization filters", () => {
  const source = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(source, /exports\.monthlyReportPdf[\s\S]*OrganizationID: req\.query\?\.organizationId \?\? req\.query\?\.OrganizationID/);
  assert.match(source, /exports\.lastYearReportPdf[\s\S]*EntryDate: req\.query\?\.entryDate \?\? req\.query\?\.EntryDate/);
});

test("HLP PDF service returns a PDF buffer with required report sections", async () => {
  const pdf = await generatePdf({ title: "HLP REPORT", reportName: "HLP Report", metadata: [{ label: "Report ID", value: 1 }], columns: [{ key: "Title", header: "Title", align: "left" }, { key: "YOD", header: "Yesterday (YOD)", align: "center" }, { key: "LYOD", header: "Last Year Same Day (LYOD)", align: "center" }], rows: [{ Title: "Historical Inactive Field", YOD: "120", LYOD: "110" }] });
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const source = `${read("services/HLPReportService/HLPReportService.js")}\n${read("utils/pdfHelper.js")}`;
  for (const heading of ["HLP REPORT", "Sr. No.", "Yesterday (YOD)", "Last Year Same Day (LYOD)"]) assert.match(source, new RegExp(heading.replace(/[.()]/g, "\\$&")));
});

test("HLP PDF lookup preserves snapshotted titles and applies report organization security", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /SELECT title AS "Title", yod AS "YOD", lyod AS "LYOD"[\s\S]*FROM hlpreport_entry_details/);
  assert.match(source, /validateOrganization\(client, UserID, record\.organizationid\)/);
  assert.match(source, /return fail\("HLP report not found", 404\)/);
  assert.doesNotMatch(source.match(/const generateReportPdf[\s\S]*?const reportOrganizationMetadata/)?.[0] || "", /isactive = TRUE/);
});
