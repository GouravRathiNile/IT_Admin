require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../../routes/ReportRoutes/ReportRoutes");
const QUEUE = require("../../config/queue");
const handler = require("../../consumer/ReportBuilderConsumer/ReportBuilderHandler");
const registry = require("../../services/ReportBuilderService/ReportRegistry");
const { isRealDate } = require("../../services/ReportBuilderService/ReportQueryBuilder");
const service = require("../../services/ReportBuilderService/ReportBuilderService");
const guestGlitchProvider = require("../../services/ReportBuilderService/providers/GuestGlitchReportProvider");
const guestGlitchService = require("../../services/GuestGlitchService/GuestGlitchService");
const guestRepository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const { pool } = require("../../db");

const report = registry.getReport("GuestGlitch", "guest-glitch");

test("Report routes expose generic types, config, options and run", () => {
  const definitions = router.stack.filter((layer) => layer.route).map((layer) => ({
    path: layer.route.path, methods: layer.route.methods,
  }));
  const has = (path, method) => definitions.some((item) => item.path === path && item.methods[method]);
  assert.ok(has("/:module/types", "get"));
  assert.ok(has("/:module/:reportType/config", "get"));
  assert.ok(has("/:module/:reportType/options/:field", "get"));
  assert.ok(has("/:module/:reportType/run", "post"));
  assert.ok(has("/:module/:reportType/export", "post"));
  assert.equal(definitions.length, 5);
  assert.equal(QUEUE.REPORT_BUILDER.REQUEST, "report_builder_request_queue");
});

test("Guest Glitch config exposes exactly six simple filters and no internals", () => {
  const config = registry.publicConfig(report);
  assert.equal(config.title, "Guest Glitch Report");
  assert.deepEqual(config.filters.map((item) => item.key), [
    "organizationId", "fromDate", "toDate", "departmentId", "status", "complaint",
  ]);
  for (const filter of config.filters) {
    assert.deepEqual(Object.keys(filter), ["key", "label", "type", "required", "filterable"]);
    assert.equal(filter.filterable, true);
    assert.equal(Object.hasOwn(filter, "operator"), false);
    assert.equal(Object.hasOwn(filter, "expression"), false);
  }
  assert.deepEqual(config.columns.map((column) => column.key), [
    "id", "organization", "entryDate", "roomNumber", "guestName", "departments",
    "complaint", "processLapse", "serviceRecovery", "detailedInvestigation",
    "internalActionTaken", "checkInDate", "checkOutDate", "companyName", "rate",
    "updatedBy", "receivedBy", "resolvedBy", "gmComment", "status",
  ]);
  assert.ok(config.columns.every((column) => column.selectable === true));
  assert.equal(config.columns.find((column) => column.key === "entryDate").sortable, true);
  assert.equal(config.columns.find((column) => column.key === "complaint").sortable, false);
  assert.equal(registry.getReport("guestglitch", "GUEST-GLITCH"), report);
  assert.equal(registry.getReport("GuestGlitch", "unknown"), null);
});

test("Guest Glitch module registers compact and master report types separately", () => {
  const moduleDefinition = registry.getModule("GuestGlitch");
  assert.deepEqual(registry.listReportTypes(moduleDefinition), [
    { key: "guest-glitch", label: "Guest Glitch Report" },
    { key: "guest-glitch-master", label: "Guest Glitch Master Report" },
  ]);
  const master = registry.getReport("GuestGlitch", "guest-glitch-master");
  const masterConfig = registry.publicConfig(master);
  assert.equal(masterConfig.title, "Guest Glitch Master Report");
  assert.deepEqual(masterConfig.filters.slice(0, 6).map((item) => item.key), [
    "organizationId", "fromDate", "toDate", "departmentId", "receivedById", "informedToId",
  ]);
  assert.ok(masterConfig.filters.some((item) => item.key === "status" && item.type === "select"));
  assert.ok(masterConfig.filters.some((item) => item.key === "complaint" && item.type === "text"));
  assert.equal(master.runnable, true);
  assert.equal(master.execution, "guestGlitchMaster");
  assert.notEqual(master, report);
});

test("translation converts simple filters to trusted internal conditions", () => {
  const access = { organizationIDs: [10, 20] };
  const translated = service.translateRequest(report, {
    filters: {
      organizationId: 20, fromDate: "2026-08-01", toDate: "2026-08-25",
      departmentId: 1029, status: "Open", complaint: "cooling",
    },
    sort: { field: "entryDate", direction: "DESC" }, page: 2, pageSize: 25,
  }, access);
  assert.deepEqual(translated.filters, [
    { field: "organizationId", operator: "equals", value: 20 },
    { field: "entryDate", operator: "greaterThanOrEqual", value: "2026-08-01" },
    { field: "entryDate", operator: "lessThanOrEqual", value: "2026-08-25" },
    { field: "departmentId", operator: "in", value: [1029] },
    { field: "status", operator: "equals", value: "Open" },
    { field: "complaint", operator: "contains", value: "cooling" },
  ]);
  assert.deepEqual(translated.sort, { field: "entryDate", direction: "DESC" });
});

test("provider translates the compact report into the existing Guest Glitch query contract", () => {
  const definition = service.translateRequest(report, {
    filters: { organizationId: 20, complaint: "100% cooling_" },
    page: 2, pageSize: 25,
  }, { organizationIDs: [10, 20] });
  const query = guestGlitchProvider.queryFromDefinition(definition, [10, 20]);
  assert.deepEqual(query.OrganizationIDs, [20]);
  assert.equal(query.complaintEscaped, "100\\% cooling\\_");
  assert.equal(query.page, 2);
  assert.equal(query.pageSize, 25);
  assert.equal(query.sortBy, "EntryDate");
});

test("Guest Glitch provider keeps concurrent request state independent", () => {
  const open = guestGlitchProvider.queryFromDefinition({
    page: 1, pageSize: 10, sort: null,
    filters: [{ field: "status", operator: "equals", value: "Open" }],
  }, [30]);
  const closed = guestGlitchProvider.queryFromDefinition({
    page: 2, pageSize: 25, sort: { field: "entryDate", direction: "ASC" },
    filters: [{ field: "status", operator: "equals", value: "Closed" }],
  }, [40]);
  assert.deepEqual(open.OrganizationIDs, [30]);
  assert.equal(open.statusExact, "Open");
  assert.equal(open.page, 1);
  assert.deepEqual(closed.OrganizationIDs, [40]);
  assert.equal(closed.statusExact, "Closed");
  assert.equal(closed.page, 2);
  assert.notEqual(open, closed);
});

test("simple request validation rejects unsupported and unsafe input", () => {
  const access = { organizationIDs: [10] };
  assert.throws(() => service.translateRequest(report, { filters: [] }, access), /Filters must be an object/);
  assert.throws(() => service.translateRequest(report, { filters: { operator: "equals" } }, access), /Invalid report filter/);
  assert.throws(() => service.translateRequest(report, { filters: { status: { $ne: "Open" } } }, access), /valid value/);
  assert.throws(() => service.translateRequest(report, { filters: { fromDate: "2026-02-30" } }, access), /valid date/);
  assert.throws(() => service.translateRequest(report, { filters: { fromDate: "2026-09-01", toDate: "2026-08-01" } }, access), /must not be after/);
  assert.throws(() => service.translateRequest(report, { filters: { organizationId: 99 } }, access), /not authorized/);
  assert.throws(() => service.translateRequest(report, { sort: { field: "entryDate; DROP TABLE x", direction: "DESC" } }, access), /Invalid report sort/);
  assert.throws(() => service.translateRequest(report, { sort: { field: "entryDate", direction: "DESC; DROP" } }, access), /ASC or DESC/);
  assert.throws(() => service.translateRequest(report, { pageSize: 101 }, access), /between 1 and 100/);
  assert.equal(isRealDate("2028-02-29"), true);
});

test("fixed report columns match the compact Guest Glitch report", () => {
  assert.deepEqual(report.columns.map((item) => item.key), [
    "id", "organization", "entryDate", "roomNumber", "guestName", "departments",
    "complaint", "processLapse", "serviceRecovery", "detailedInvestigation",
    "internalActionTaken", "checkInDate", "checkOutDate", "companyName", "rate",
    "updatedBy", "receivedBy", "resolvedBy", "gmComment", "status",
  ]);
  assert.deepEqual(report.columns.map((item) => item.publicKey), [
    "ID", "Organization", "EntryDate", "RoomNumber", "GuestName", "Departments",
    "Complaint", "ProcessLapse", "ServiceRecovery", "DetailedInvestigation",
    "InternalActionTaken", "CheckInDate", "CheckOutDate", "CompanyName", "Rate",
    "UpdatedBy", "ReceivedBy", "ResolvedBy", "GMComment", "Status",
  ]);
});

test("provider creates a normalized result and rejects unknown columns", () => {
  const selected = guestGlitchProvider.validateColumns(report.columns, ["id", "guestName", "status"]);
  const normalized = guestGlitchProvider.normalizedResult({
    data: [{ ID: 7, GuestName: "Guest", Status: "Open", Complaint: "Hidden" }],
    pagination: { page: 1, pageSize: 10, totalRecords: 1, totalPages: 1 },
  }, selected);
  assert.deepEqual(normalized.columns, [
    { key: "id", label: "ID" }, { key: "guestName", label: "Guest Name" },
    { key: "status", label: "Status" },
  ]);
  assert.deepEqual(normalized.rows, [{ id: 7, guestName: "Guest", status: "Open" }]);
  assert.throws(
    () => guestGlitchProvider.validateColumns(report.columns, ["id", "raw_database_column"]),
    /Invalid report column/,
  );
});

test("handler keeps POST report actions while GET controllers call the service directly", async () => {
  const originals = { run: service.run, exportReport: service.exportReport };
  try {
    service.run = async () => ({ marker: "run" });
    service.exportReport = async () => ({ marker: "export" });
    assert.equal((await handler({ action: "GET_REPORT_TYPES", data: {} })).statusCode, 400);
    assert.equal((await handler({ action: "GET_REPORT_CONFIG", data: {} })).statusCode, 400);
    assert.equal((await handler({ action: "GET_REPORT_OPTIONS", data: {} })).statusCode, 400);
    assert.equal((await handler({ action: "RUN_REGISTERED_REPORT", data: {} })).marker, "run");
    assert.equal((await handler({ action: "EXPORT_REGISTERED_REPORT", data: {} })).marker, "export");
    assert.equal((await handler({ action: "GET_REPORT_SOURCES", data: {} })).statusCode, 400);
    const controller = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../controllers/ReportController/ReportController.js"), "utf8");
    assert.match(controller, /ReportBuilderService\.getTypes/);
    assert.match(controller, /ReportBuilderService\.getConfig/);
    assert.match(controller, /ReportBuilderService\.getOptions/);
  } finally { Object.assign(service, originals); }
});

test("Guest Glitch generic export reuses provider data for CSV, Excel and PDF", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  const originalReport = guestGlitchService.reportForProvider;
  const calls = [];
  try {
    guestRepository.resolveOrganizations = async () => [{ organizationid: "30", organizationname: "Hotel" }];
    guestGlitchService.reportForProvider = async (query, options) => {
      calls.push({ query, options });
      return {
        success: true,
        data: [
          { ID: 1, OrganizationName: "Hotel", EntryDate: "27 Aug 2026", GuestName: "A, Guest", Status: "Open" },
          { ID: 2, OrganizationName: "Hotel", EntryDate: "27 Aug 2026", GuestName: "Second", Status: "Open" },
        ],
        pagination: { page: 1, pageSize: 2, totalRecords: 2, totalPages: 1 },
      };
    };
    const base = {
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch",
      body: { filters: { organizationId: 30, status: "Open" }, columns: ["id", "guestName", "status"] },
    };
    const csv = await service.exportReport({ ...base, body: { ...base.body, format: "csv" } });
    assert.equal(csv.success, true);
    assert.equal(csv.contentType, "text/csv; charset=utf-8");
    const csvText = Buffer.from(csv.fileBase64, "base64").toString("utf8");
    assert.match(csvText, /^\uFEFFID,Guest Name,Status/);
    assert.match(csvText, /"A, Guest"/);
    const excel = await service.exportReport({ ...base, body: { ...base.body, format: "excel", columns: undefined } });
    assert.equal(excel.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(Buffer.from(excel.fileBase64, "base64").subarray(0, 2).toString(), "PK");
    const pdf = await service.exportReport({
      ...base, body: { ...base.body, format: "pdf", filters: { status: "Open" } },
    });
    assert.equal(pdf.contentType, "application/pdf");
    assert.equal(Buffer.from(pdf.fileBase64, "base64").subarray(0, 4).toString(), "%PDF");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].query.OrganizationIDs, [30]);
    assert.equal(calls[0].query.statusExact, "Open");
    assert.deepEqual(calls[0].options, { paginate: false, maxRows: 25000 });
    assert.deepEqual(calls[2].options, { paginate: false, maxRows: 2500 });
  } finally {
    guestRepository.resolveOrganizations = originalResolve;
    guestGlitchService.reportForProvider = originalReport;
  }
});

test("Guest Glitch generic export rejects unsafe requests and unavailable report types", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  try {
    guestRepository.resolveOrganizations = async () => [{ organizationid: "30", organizationname: "Hotel" }];
    const request = (body, reportType = "guest-glitch") => service.exportReport({
      UserID: 1, module: "GuestGlitch", reportType, body,
    });
    assert.equal((await request({ format: "word", filters: {} })).statusCode, 400);
    assert.match((await request({ format: "csv", filters: {}, columns: ["rawSql"] })).message, /Invalid report column/);
    assert.match((await request({ format: "csv", filters: { rawSql: "DROP" } })).message, /Invalid report filter/);
    assert.match((await request(null)).message, /body must be an object/);
    assert.match((await request({ format: "csv" }, "guest-glitch-master")).message, /not available/);
    const forbidden = await request({ format: "csv", filters: { organizationId: 40 } });
    assert.equal(forbidden.statusCode, 403);
  } finally { guestRepository.resolveOrganizations = originalResolve; }
});

test("Guest Glitch provider export limit stops before fetching rows", async () => {
  const originalClient = guestRepository.getClient;
  const originalCount = guestRepository.countReport;
  const originalList = guestRepository.reportList;
  let fetched = false;
  try {
    guestRepository.getClient = async () => ({ release() {} });
    guestRepository.countReport = async () => 25001;
    guestRepository.reportList = async () => { fetched = true; return { rows: [], total: 0 }; };
    const response = await guestGlitchService.reportForProvider(
      { OrganizationIDs: [30], page: 1, pageSize: 10 },
      { paginate: false, maxRows: 25000 },
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.message, /too many records/);
    assert.equal(fetched, false);
  } finally {
    guestRepository.getClient = originalClient;
    guestRepository.countReport = originalCount;
    guestRepository.reportList = originalList;
  }
});

test("configuration and options enforce active organization mappings", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  const originalQuery = pool.query;
  try {
    guestRepository.resolveOrganizations = async () => [
      { organizationid: "10", organizationname: "Hotel A" },
      { organizationid: "20", organizationname: "Hotel B" },
    ];
    const types = await service.getTypes({ UserID: 1, module: "GuestGlitch" });
    assert.deepEqual(types.data.map((item) => item.key), ["guest-glitch", "guest-glitch-master"]);
    const config = await service.getConfig({ UserID: 1, module: "GuestGlitch", reportType: "guest-glitch" });
    assert.equal(config.success, true);
    const organizations = await service.getOptions({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch", field: "organization",
    });
    assert.deepEqual(organizations.data.map((item) => item.value), [10, 20]);
    const forbidden = await service.getOptions({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch",
      field: "department", organizationId: 30,
    });
    assert.equal(forbidden.statusCode, 403);
    pool.query = async (sql, values) => sql.includes("department_master")
      ? { rows: [{ value: "1", label: "Front Office", organizationid: String(values[0][0]) }] }
      : { rows: [{ value: "Open", label: "Open", organizationid: String(values[0][0]) }] };
    const department = await service.getOptions({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch",
      field: "department", organizationId: 10,
    });
    assert.deepEqual(department.data, [{ value: 1, label: "Front Office" }]);
    const status = await service.getOptions({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch", field: "status", organizationId: 20,
    });
    assert.deepEqual(status.data, [{ value: "Open", label: "Open", organizationId: 20 }]);
    const masterOrganization = await service.getOptions({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master", field: "organization",
    });
    assert.deepEqual(masterOrganization.data.map((item) => item.value), [10, 20]);
    const masterDepartment = await service.getOptions({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master",
      field: "department", organizationId: 10,
    });
    assert.deepEqual(masterDepartment.data, [{ value: 1, label: "Front Office" }]);
    const masterStatus = await service.getOptions({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master", field: "status", organizationId: 20,
    });
    assert.deepEqual(masterStatus.data, [{ value: "Open", label: "Open", organizationId: 20 }]);
  } finally { guestRepository.resolveOrganizations = originalResolve; pool.query = originalQuery; }
});

test("master report run reuses existing Guest Glitch master report with filters and pagination", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  const originalMasterReport = guestGlitchService.masterReport;
  const calls = [];
  try {
    guestRepository.resolveOrganizations = async () => [{ organizationid: "10", organizationname: "Hotel" }];
    guestGlitchService.masterReport = async (data) => {
      calls.push(data);
      return {
        success: true, message: "Guest Glitch master report fetched successfully",
        data: [{ ID: 1, OrganizationID: 10, Complaint: "Cooling" }],
        pagination: { page: Number(data.page), pageSize: Number(data.pageSize), totalRecords: 1, totalPages: 1 },
      };
    };
    const noFilters = await service.run({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master", body: {},
    });
    assert.equal(noFilters.success, true);
    assert.deepEqual(noFilters.pagination, { page: 1, pageSize: 10, totalRecords: 1, totalPages: 1 });
    const filtered = await service.run({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master",
      body: {
        filters: {
          organizationId: 10, fromDate: "2026-08-01", toDate: "2026-08-25",
          departmentId: 5, status: "Open", complaint: "cooling",
        },
        sort: { field: "entryDate", direction: "ASC" }, page: 2, pageSize: 25,
      },
    });
    assert.equal(filtered.success, true);
    assert.equal(calls[1].organizationId, 10);
    assert.deepEqual(calls[1].departmentIds, [5]);
    assert.equal(calls[1].status, "Open");
    assert.equal(calls[1].complaint, "cooling");
    assert.equal(calls[1].sortBy, "EntryDate");
    assert.equal(calls[1].sortDirection, "ASC");
    assert.equal(calls[1].page, 2);
    assert.equal(calls[1].pageSize, 25);
    const invalid = await service.run({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master",
      body: { filters: { rawSql: "DROP TABLE x" } },
    });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.message, /Invalid report filter/);
    const forbidden = await service.run({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master",
      body: { filters: { organizationId: 99 } },
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(calls.length, 2);
  } finally {
    guestRepository.resolveOrganizations = originalResolve;
    guestGlitchService.masterReport = originalMasterReport;
  }
});

test("run returns fixed formatted data, pagination and empty results", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  const originalReport = guestGlitchService.reportForProvider;
  const calls = [];
  try {
    guestRepository.resolveOrganizations = async () => [{ organizationid: "10", organizationname: "Hotel" }];
    guestGlitchService.reportForProvider = async (query) => {
      calls.push(query);
      return {
        success: true, message: "Guest Glitch report fetched successfully",
        data: [{ ID: 9, OrganizationName: "Hotel", EntryDate: "20 Aug 2026", Rate: "82.5", Departments: [], ReceivedByUsers: [] }],
        pagination: { page: 2, pageSize: 10, totalRecords: 11, totalPages: 2 },
      };
    };
    const response = await service.run({
      UserID: 1, module: "GuestGlitch", reportType: "guest-glitch", body: { page: 2, pageSize: 10 },
    });
    assert.equal(response.success, true);
    assert.equal(response.data[0].ID, 9);
    assert.equal(response.data[0].EntryDate, "20 Aug 2026");
    assert.equal(response.data[0].Rate, 82.5);
    assert.deepEqual(response.pagination, { page: 2, pageSize: 10, totalRecords: 11, totalPages: 2 });
    guestGlitchService.reportForProvider = async () => ({
      success: true, message: "Guest Glitch report fetched successfully", data: [],
      pagination: { page: 1, pageSize: 10, totalRecords: 0, totalPages: 0 },
    });
    const empty = await service.run({ UserID: 1, module: "GuestGlitch", reportType: "guest-glitch", body: {} });
    assert.deepEqual(empty.data, []);
    assert.equal(empty.pagination.totalPages, 0);
    assert.deepEqual(calls[0].OrganizationIDs, [10]);
  } finally { guestRepository.resolveOrganizations = originalResolve; guestGlitchService.reportForProvider = originalReport; }
});

test("invalid report types and database failures return safe errors", async () => {
  const originalResolve = guestRepository.resolveOrganizations;
  try {
    const unknownModule = await service.getTypes({ UserID: 1, module: "HLP" });
    assert.equal(unknownModule.message, "Report module not found.");
    const unknownType = await service.getConfig({ UserID: 1, module: "GuestGlitch", reportType: "unknown" });
    assert.equal(unknownType.message, "Report type not found.");
    guestRepository.resolveOrganizations = async () => [{ organizationid: "10", organizationname: "Hotel" }];
    const masterConfig = await service.getConfig({ UserID: 1, module: "GuestGlitch", reportType: "guest-glitch-master" });
    assert.equal(masterConfig.data.title, "Guest Glitch Master Report");
    guestRepository.resolveOrganizations = async () => { throw new Error("raw SQL database detail"); };
    const failure = await service.getConfig({ UserID: 1, module: "GuestGlitch", reportType: "guest-glitch" });
    assert.equal(failure.statusCode, 503);
    assert.doesNotMatch(failure.message, /raw SQL/);
  } finally { guestRepository.resolveOrganizations = originalResolve; }
});
