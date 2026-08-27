require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../../services/ReportBuilderService/ReportRegistry");
const service = require("../../services/ReportBuilderService/ReportBuilderService");
const guestRepository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const incidentService = require("../../services/IncidentReportService/IncidentReportService");
const hlpService = require("../../services/HLPReportService/HLPReportService");

test("Incident and HLP report types and configs are registered", () => {
  assert.deepEqual(registry.listReportTypes(registry.getModule("IncidentReport")), [
    { key: "incident", label: "Incident Report" },
  ]);
  assert.deepEqual(registry.listReportTypes(registry.getModule("HLPReport")), [
    { key: "monthly", label: "HLP Monthly Report" },
    { key: "last-year-same-day", label: "HLP Last Year Same Day Report" },
  ]);
  assert.deepEqual(registry.publicConfig(registry.getReport("IncidentReport", "incident")).filters.map((item) => item.key),
    ["search", "year", "month", "fromDate", "toDate"]);
  assert.deepEqual(registry.publicConfig(registry.getReport("HLPReport", "monthly")).filters.map((item) => item.key),
    ["organizationId", "year", "month"]);
  assert.deepEqual(registry.publicConfig(registry.getReport("HLPReport", "last-year-same-day")).filters.map((item) => item.key),
    ["organizationId", "entryDate"]);
});

test("Incident adapter delegates validated query and preserves service pagination", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  const originalReport = incidentService.report;
  let received;
  try {
    guestRepository.resolveOrganizations = async () => [{ organizationid: "10", organizationname: "Hotel" }];
    incidentService.report = async (data) => {
      received = data;
      return { success: true, message: "ok", data: [{ ID: "IR1" }], pagination: { page: 2, pageSize: 5, totalRecords: 6, totalPages: 2 } };
    };
    const response = await service.run({
      UserID: 7, module: "IncidentReport", reportType: "incident",
      body: { filters: { year: 2026, month: 8, search: "lobby" }, sort: { field: "incidentDate", direction: "ASC" }, page: 2, pageSize: 5 },
    });
    assert.equal(response.success, true);
    assert.equal(received.UserID, 7);
    assert.deepEqual(received.Query, { page: 2, pageSize: 5, search: "lobby", year: 2026, month: 8, fromDate: null, toDate: null, sortBy: "IncidentDate", sortDirection: "ASC" });
    assert.equal(response.pagination.totalRecords, 6);
  } finally { guestRepository.resolveOrganizations = originalResolve; incidentService.report = originalReport; }
});

test("HLP adapters enforce organization access, reuse calculations and paginate rows", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  const originalMonthly = hlpService.getMonthlyReport;
  const originalLastYear = hlpService.getLastYearReport;
  const calls = [];
  try {
    guestRepository.resolveOrganizations = async () => [
      { organizationid: "10", organizationname: "Hotel A" },
      { organizationid: "20", organizationname: "Hotel B" },
    ];
    hlpService.getMonthlyReport = async (data) => {
      calls.push(data);
      return { success: true, message: "monthly", data: [{ ID: 1, Title: "A" }, { ID: 2, Title: "B" }] };
    };
    hlpService.getLastYearReport = async (data) => {
      calls.push(data);
      return { success: true, message: "last year", data: { ID: 55, EntryDate: "21 Aug 2026", Details: [{ MasterID: "1", Title: "Rooms", YOD: "10", LYOD: "9" }] } };
    };
    const monthly = await service.run({ UserID: 7, module: "HLPReport", reportType: "monthly", body: { filters: { year: 2026, month: 8 }, page: 2, pageSize: 1 } });
    assert.deepEqual(calls[0], { OrganizationIDs: [10, 20], Year: 2026, Month: 8 });
    assert.deepEqual(monthly.data, [{ ID: 2, Title: "B" }]);
    assert.deepEqual(monthly.pagination, { page: 2, pageSize: 1, totalRecords: 2, totalPages: 2 });
    const lastYear = await service.run({ UserID: 7, module: "HLPReport", reportType: "last-year-same-day", body: { filters: { organizationId: 20, entryDate: "2026-08-21" } } });
    assert.equal(calls[1].OrganizationID, 20);
    assert.deepEqual(lastYear.data[0], { ReportID: 55, EntryDate: "21 Aug 2026", MasterID: 1, Title: "Rooms", YOD: "10", LYOD: "9" });
    const forbidden = await service.run({ UserID: 7, module: "HLPReport", reportType: "monthly", body: { filters: { organizationId: 99, year: 2026, month: 8 } } });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(calls.length, 2);
  } finally {
    guestRepository.resolveOrganizations = originalResolve;
    hlpService.getMonthlyReport = originalMonthly;
    hlpService.getLastYearReport = originalLastYear;
  }
});

test("HLP required filters and Incident unsupported options return safe validation errors", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  try {
    guestRepository.resolveOrganizations = async () => [{ organizationid: "10", organizationname: "Hotel" }];
    const missing = await service.run({ UserID: 1, module: "HLPReport", reportType: "monthly", body: { filters: { year: 2026 } } });
    assert.equal(missing.statusCode, 400);
    assert.match(missing.message, /Month is required/);
    const options = await service.getOptions({ UserID: 1, module: "IncidentReport", reportType: "incident", field: "status" });
    assert.equal(options.statusCode, 400);
    assert.equal(options.message, "Options are not available for this report field.");
  } finally { guestRepository.resolveOrganizations = originalResolve; }
});
