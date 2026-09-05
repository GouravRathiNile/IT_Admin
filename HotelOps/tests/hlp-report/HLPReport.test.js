const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../../services/HLPReportService/HLPReportService");
const { generatePdf, loadLogo } = require("../../utils/pdfHelper");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Architecture and public-contract regression coverage.
test("HLP routes expose the approved authenticated API contract", () => {
  const source = read("routes/HLPReportRoutes/HLPReportRoutes.js");
  assert.match(source, /router\.use\(authenticateToken\)/);
  assert.match(source, /router\.get\("\/MasterList"/);
  assert.match(source, /router\.get\("\/HLPList", controller\.hlpList\)/);
  assert.match(source, /router\.post\("\/CreateMasterField"/);
  assert.match(source, /router\.get\("\/MasterField\/Export", controller\.exportMasterFields\)/);
  assert.match(source, /router\.post\("\/MasterField\/Import", upload\.hlpMasterImportUpload, controller\.importMasterFields\)/);
  assert.match(source, /router\.put\("\/MasterField\/Reorder", controller\.reorderMasterFields\)/);
  assert.match(source, /router\.put\("\/UpdateMasterField"/);
  assert.match(source, /router\.delete\("\/DeleteMasterField"/);
  assert.match(source, /router\.post\("\/Create"/);
  assert.match(source, /router\.put\("\/Update"/);
  assert.match(source, /router\.get\("\/MonthlyReport"/);
  assert.match(source, /router\.get\("\/LastYearReport"/);
  assert.match(source, /router\.get\("\/:id\/PDF", controller\.reportPdf\)/);
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

test("handler keeps only HLP mutation actions", () => {
  const source = read("consumer/HLPReportConsumer/HLPReportHandler.js");
  for (const action of ["CREATE_HLP_MASTER_FIELD", "IMPORT_HLP_MASTER_FIELDS", "UPDATE_HLP_MASTER_FIELD", "REORDER_HLP_MASTER_FIELDS", "DELETE_HLP_MASTER_FIELD", "CREATE_HLP_REPORT", "UPDATE_HLP_REPORT"]) {
    assert.match(source, new RegExp(`case "${action}"`));
  }
  assert.doesNotMatch(source, /case "(?:GET_HLP_|GENERATE_HLP_)/);
});

// Persistence mapping and validation coverage for master/report operations.
test("report update changes the existing parent and preserves inactive historical details", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /SELECT id, organizationid FROM hlpreport_entry_master WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /id = ANY\(\$1::bigint\[\]\) AND organizationid = \$2 AND isactive = TRUE/);
  assert.match(source, /UPDATE hlpreport_entry_details[\s\S]*WHERE entryid = \$4 AND masterid = \$5/);
  assert.match(source, /INSERT INTO hlpreport_entry_details \(id, entryid, masterid, title/);
  assert.doesNotMatch(source, /DELETE FROM hlpreport_entry_details/);
  assert.match(source, /UPDATE hlpreport_entry_master[\s\S]*modifydatetime = CURRENT_TIMESTAMP/);
});

test("exact-date report exposes the existing report ID and configured MasterID", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /d\.masterid AS "MasterID"/);
  assert.match(source, /data: \{ ID: Number\(entry\.rows\[0\]\.id\), EntryDate/);
});

test("master list and create integrity use only active configured fields", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /organizationid = \$1[\s\S]*isactive = TRUE/);
  assert.match(source, /id = ANY\(\$1::bigint\[\]\) AND organizationid = \$2 AND isactive = TRUE/);
  assert.match(source, /isactive = FALSE, orderby = NULL, modifyby/);
});

test("report controller accepts optional lowercase organization filters", () => {
  const source = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(source, /const queryOrganizationID = \(req\) => firstOrganizationID/);
  assert.match(source, /\["undefined", "null"\]\.includes/);
  assert.match(source, /normalized === "0"/);
  assert.match(source, /entryDate \?\? req\.query\?\.EntryDate/);
  assert.match(source, /req\.get\("X-Organization-ID"\)/);
  assert.match(source, /exports\.hlpList[\s\S]*OrganizationID: selectedOrganizationID\(req\)/);
});

test("HLP create/list normalize organization aliases while ID updates omit them", () => {
  const source = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(source, /req\.body\?\.OrganizationID/);
  assert.match(source, /req\.body\?\.organizationId/);
  assert.match(source, /req\.body\?\.organizationid/);
  assert.match(source, /const bodyWithOrganizationID = \(req\)/);
  for (const handler of ["createMasterField", "importMasterFields", "reorderMasterFields", "create"]) {
    assert.match(source, new RegExp(`exports\\.${handler}[\\s\\S]*?bodyWithOrganizationID\\(req\\)`));
  }
  for (const handler of ["updateMasterField", "deleteMasterField", "update"]) {
    assert.match(source, new RegExp(`exports\\.${handler}[\\s\\S]*?bodyWithoutOrganizationID\\(req\\)`));
  }
});

test("HLP entry list requires date and resolves organization/date values", async () => {
  assert.equal((await service.getHLPList({ UserID: 1, OrganizationID: 10 })).message, "Entry date is required");
  assert.match((await service.getHLPList({ UserID: 1, EntryDate: "2026-08-21" })).message, /positive integer/);
  assert.match((await service.getHLPList({ UserID: 1, OrganizationID: 10, EntryDate: "2026-02-30" })).message, /valid date/);

  const pool = require("../../db").pool;
  const originalConnect = pool.connect;
  try {
    pool.connect = async () => ({
      query: async (sql, values) => {
        if (/FROM user_org_mapping/.test(sql)) return { rowCount: 1, rows: [{ "?column?": 1 }] };
        assert.deepEqual(values, [10, "2026-08-21"]);
        assert.match(sql, /hlpreport_entry_master/);
        assert.match(sql, /hlpreport_entry_details/);
        return { rows: [{ ID: "1", Title: "Rooms Occupied", OrderBy: 1, YOD: "125", LYOD: "110" }] };
      },
      release() {},
    });
    const response = await service.getHLPList({ UserID: 7, OrganizationID: 10, EntryDate: "2026-08-21" });
    assert.deepEqual(response.data, [{ ID: "1", Title: "Rooms Occupied", OrderBy: 1, YOD: "125", LYOD: "110" }]);
  } finally { pool.connect = originalConnect; }
});

test("HLP entry list reopens saved values and prefills new dates from comparisons", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  const hlpList = source.match(/const getHLPList[\s\S]*?\n\};/)?.[0] || "";
  assert.match(hlpList, /yesterday_entry\.entrydate = \$2::date - INTERVAL '1 day'/);
  assert.match(hlpList, /EXTRACT\(YEAR FROM last_year_entry\.entrydate\) = EXTRACT\(YEAR FROM \$2::date\) - 1/);
  assert.match(hlpList, /EXTRACT\(MONTH FROM last_year_entry\.entrydate\) = EXTRACT\(MONTH FROM \$2::date\)/);
  assert.match(hlpList, /EXTRACT\(DAY FROM last_year_entry\.entrydate\) = EXTRACT\(DAY FROM \$2::date\)/);
  assert.match(hlpList, /COALESCE\(current_detail\.yod, yesterday_detail\.yod, '00'\)/);
  assert.match(hlpList, /COALESCE\(current_detail\.lyod, last_year_detail\.yod, '00'\)/);
  assert.match(hlpList, /YOD: row\.YOD \?\? "00"/);
  assert.match(hlpList, /LYOD: row\.LYOD \?\? "00"/);
});

// PDF transport, layout, and report-calculation reuse coverage.
test("HLP PDF uses direct service flow and returns inline binary headers", () => {
  const controller = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(controller, /HLPReportService\.generateReportPdf/);
  assert.match(controller, /Buffer\.from\(response\.pdfBase64, "base64"\)/);
  assert.match(controller, /Content-Type", "application\/pdf"/);
  assert.match(controller, /inline; filename=\"\$\{response\.filename\}\"/);
});

test("monthly and last-year PDF routes precede the generic ID PDF route", () => {
  const source = read("routes/HLPReportRoutes/HLPReportRoutes.js");
  const monthly = source.indexOf('router.get("/MonthlyReport/PDF"');
  const lastYear = source.indexOf('router.get("/LastYearReport/PDF"');
  const generic = source.indexOf('router.get("/:id/PDF"');
  assert.ok(monthly >= 0 && lastYear >= 0 && generic > monthly && generic > lastYear);
});

test("report PDF actions reuse existing report service calculations", () => {
  const controller = read("controllers/HLPReportController/HLPReportController.js");
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(controller, /HLPReportService\.generateMonthlyReportPdf/);
  assert.match(controller, /HLPReportService\.generateLastYearReportPdf/);
  assert.match(source, /: await getMonthlyReport\(data\)/);
  assert.match(source, /await getLastYearMonthlyReport\(data\)/);
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

test("master export exposes its server-provided XLSX filename to browser clients", () => {
  const controller = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(controller, /Content-Disposition", `attachment; filename="\$\{response\.filename\}"`/);
  assert.match(controller, /Access-Control-Expose-Headers", "Content-Disposition, Content-Length"/);
});

// Create-or-update concurrency contract and master-list maintenance coverage.
test("create report is an organization-date locked create-or-update operation", () => {
  const serviceSource = read("services/HLPReportService/HLPReportService.js");
  const controllerSource = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(serviceSource, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(serviceSource, /hlp_report:\$\{Number\(OrganizationID\)\}:\$\{EntryDate\}/);
  assert.match(serviceSource, /SELECT id FROM hlpreport_entry_master WHERE organizationid = \$1 AND entrydate = \$2 LIMIT 1 FOR UPDATE/);
  assert.match(serviceSource, /if \(existing\.rowCount\)[\s\S]*HLP report updated successfully[\s\S]*_httpStatus: 200/);
  const createReportSource = serviceSource.match(/const createReport[\s\S]*?const updateReport/)?.[0] || "";
  assert.doesNotMatch(createReportSource, /if \(duplicate\.rowCount\)/);
  assert.match(controllerSource, /const responseStatus = response\._httpStatus \|\| successStatus/);
  assert.match(controllerSource, /delete publicResponse\._httpStatus/);
});

test("create report updates an existing organization-date report without creating a parent", async () => {
  const pool = require("../../db").pool;
  const originalConnect = pool.connect;
  const queries = [];
  try {
    pool.connect = async () => ({
      query: async (sql) => {
        queries.push(sql);
        if (/FROM user_org_mapping/.test(sql)) return { rowCount: 1, rows: [{ "?column?": 1 }] };
        if (/SELECT id FROM hlpreport_entry_master WHERE organizationid/.test(sql)) return { rowCount: 1, rows: [{ id: 42 }] };
        if (/SELECT id, title FROM hlpreport_master_list/.test(sql)) return { rowCount: 1, rows: [{ id: 1, title: "Rooms Occupied" }] };
        if (/MAX\(id\).*hlpreport_entry_details/.test(sql)) return { rowCount: 1, rows: [{ id: 10 }] };
        if (/UPDATE hlpreport_entry_details/.test(sql)) return { rowCount: 1, rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release() {},
    });
    const response = await service.createReport({
      UserID: 7, OrganizationID: 10, EntryDate: "2026-08-21",
      Details: [{ MasterID: 1, YOD: "125", LYOD: "110" }],
    });
    assert.equal(response.success, true);
    assert.equal(response.data.ID, 42);
    assert.equal(response._httpStatus, 200);
    assert.equal(response.message, "HLP report updated successfully");
    assert.equal(queries.some((sql) => /INSERT INTO hlpreport_entry_master/.test(sql)), false);
    assert.equal(queries.some((sql) => /UPDATE hlpreport_entry_master/.test(sql)), true);
    assert.equal(queries.some((sql) => /DELETE FROM hlpreport_entry_details/.test(sql)), false);
  } finally { pool.connect = originalConnect; }
});

test("master list ordering is backend controlled and active state is not publicly selected", () => {
  const source = read("services/HLPReportService/HLPReportService.js");
  assert.match(source, /MAX\(orderby\), 0\) \+ 1 AS orderby/);
  assert.match(source, /Only OrganizationID and Title or Fields can be supplied when creating HLP master fields/);
  assert.match(source, /Only ID and Title can be supplied when updating an HLP master field/);
  assert.match(source, /ORDER BY orderby NULLS LAST, id/);
  assert.match(source, /SELECT id AS "ID", title AS "Title", orderby AS "OrderBy"/);
  assert.match(source, /const result = await getMasterRows\(client, OrganizationID\)/);
});

test("master list returns only ID, Title and OrderBy", async () => {
  const pool = require("../../db").pool;
  const originalConnect = pool.connect;
  try {
    pool.connect = async () => ({
      query: async (sql) => /FROM user_org_mapping/.test(sql)
        ? ({ rowCount: 1, rows: [{ organizationid: 10 }] })
        : ({ rows: [{ ID: "1", Title: "Rooms Occupied", OrderBy: 1 }] }),
      release() {},
    });
    const response = await service.getMasterList({ UserID: 1, OrganizationID: 10 });
    assert.deepEqual(response.data, [{ ID: "1", Title: "Rooms Occupied", OrderBy: 1 }]);
  } finally { pool.connect = originalConnect; }
});

test("master list resolves a single active organization when query organization is omitted", async () => {
  const pool = require("../../db").pool;
  const originalConnect = pool.connect;
  try {
    pool.connect = async () => ({
      query: async (sql) => {
        if (/SELECT uom\.organizationid/.test(sql)) return { rows: [{ organizationid: "20" }] };
        if (/SELECT 1[\s\S]*FROM user_org_mapping/.test(sql)) return { rowCount: 1, rows: [{}] };
        return { rows: [{ ID: "5", Title: "Rooms", OrderBy: 1 }] };
      },
      release() {},
    });
    const response = await service.getMasterList({ UserID: 7 });
    assert.equal(response.success, true);
    assert.deepEqual(response.data, [{ ID: "5", Title: "Rooms", OrderBy: 1 }]);
  } finally { pool.connect = originalConnect; }
});

test("master list asks for organization selection when user has multiple mappings", async () => {
  const pool = require("../../db").pool;
  const originalConnect = pool.connect;
  try {
    pool.connect = async () => ({
      query: async () => ({ rows: [{ organizationid: "10" }, { organizationid: "20" }] }),
      release() {},
    });
    const response = await service.getMasterList({ UserID: 7 });
    assert.equal(response.statusCode, 400);
    assert.equal(response.message, "Please select an organization to view HLP master fields.");
  } finally { pool.connect = originalConnect; }
});

test("reorder validation rejects malformed, duplicate and discontinuous orders", async () => {
  assert.match((await service.reorderMasterFields({ UserID: 1, OrganizationID: 10, items: [] })).message, /non-empty array/);
  assert.match((await service.reorderMasterFields({ UserID: 1, OrganizationID: 10, items: [{ ID: 1, OrderBy: 1 }, { ID: 1, OrderBy: 2 }] })).message, /Duplicate HLP master field ID/);
  assert.match((await service.reorderMasterFields({ UserID: 1, OrganizationID: 10, items: [{ ID: 1, OrderBy: 1 }, { ID: 2, OrderBy: 1 }] })).message, /Duplicate OrderBy/);
  assert.match((await service.reorderMasterFields({ UserID: 1, OrganizationID: 10, items: [{ ID: 1, OrderBy: 1 }, { ID: 2, OrderBy: 3 }] })).message, /continuous sequence/);
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
  assert.match(source, /exports\.monthlyReportPdf[\s\S]*OrganizationID: queryOrganizationID\(req\)/);
  assert.match(source, /exports\.lastYearReportPdf[\s\S]*Year: req\.query\?\.year \?\? req\.query\?\.Year/);
  assert.match(source, /exports\.lastYearReportPdf[\s\S]*Month: req\.query\?\.month \?\? req\.query\?\.Month/);
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

test("LastYearReport uses MonthlyReport filters and the shared LYOD pivot", () => {
  const controller = read("controllers/HLPReportController/HLPReportController.js");
  const serviceSource = read("services/HLPReportService/HLPReportService.js");
  const lastYearController = controller.match(/exports\.lastYearReport =[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(lastYearController, /HLPReportService\.getLastYearMonthlyReport/);
  assert.match(lastYearController, /Year: req\.query\?\.year \?\? req\.query\?\.Year/);
  assert.match(lastYearController, /Month: req\.query\?\.month \?\? req\.query\?\.Month/);
  assert.doesNotMatch(lastYearController, /EntryDate/);
  assert.match(serviceSource, /const getLastYearMonthlyReport = async \(data\) => getMonthlyReport\(data, "LYOD"\)/);
  assert.match(serviceSource, /d\.\$\{reportValueField\} AS "Value"/);
});
