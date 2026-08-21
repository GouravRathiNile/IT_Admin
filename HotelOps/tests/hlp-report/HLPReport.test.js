const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../../services/HLPReportService/HLPReportService");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("HLP routes expose the approved authenticated API contract", () => {
  const source = read("routes/HLPReportRoutes/HLPReportRoutes.js");
  assert.match(source, /router\.use\(authenticateToken\)/);
  assert.match(source, /router\.get\("\/master-list"/);
  assert.match(source, /router\.post\("\/master-list"/);
  assert.match(source, /router\.put\("\/master-list"/);
  assert.match(source, /router\.delete\("\/master-list"/);
  assert.match(source, /router\.post\("\/create"/);
  assert.match(source, /router\.put\("\/update"/);
  assert.match(source, /router\.get\("\/monthly-report"/);
  assert.match(source, /router\.get\("\/last-year-report"/);
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
  for (const action of ["GET_HLP_MASTER_LIST", "CREATE_HLP_MASTER_FIELD", "UPDATE_HLP_MASTER_FIELD", "DELETE_HLP_MASTER_FIELD", "CREATE_HLP_REPORT", "UPDATE_HLP_REPORT", "GET_HLP_MONTHLY_REPORT", "GET_HLP_LAST_YEAR_REPORT"]) {
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
  assert.match(source, /isactive = FALSE, modifyby/);
});

test("report controller accepts optional lowercase organization filters", () => {
  const source = read("controllers/HLPReportController/HLPReportController.js");
  assert.match(source, /organizationId \?\? req\.query\?\.OrganizationID/);
  assert.match(source, /entryDate \?\? req\.query\?\.EntryDate/);
});
