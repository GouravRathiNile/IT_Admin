require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../../routes/IncidentReportRoutes/IncidentReportRoutes");
const validator = require("../../validators/IncidentReportValidator");
const { createDTO, listDTO, compactDTO, detailDTO } = require("../../dto/IncidentReportDTO");
const service = require("../../services/IncidentReportService/IncidentReportService");
const repository = require("../../repositories/IncidentReportRepository/IncidentReportRepository");
const { generatePdf } = require("../../utils/pdfHelper");

const valid = {
  OrganizationID: 10,
  ReportDate: "2026-08-20", IncidentDate: "2026-08-20", Time: "12:30 PM",
  Location: "Main breaker", AccidentCause: "Heavy rainfall", Anycasualty: "No",
  Description: "Cable fault",
};

test("Incident Report routes expose the approved methods and report precedes ID route", () => {
  const definitions = router.stack.filter((layer) => layer.route).map((layer) => ({ path: layer.route.path, methods: layer.route.methods }));
  const has = (path, method) => definitions.some((item) => item.path === path && item.methods[method]);
  for (const [path, method] of [["/Create", "post"], ["/List", "get"], ["/Report", "get"], ["/Report/export/csv", "get"], ["/Report/export/excel", "get"], ["/Report/:id", "get"], ["/Update", "put"], ["/Delete", "delete"], ["/:id", "get"]]) assert.ok(has(path, method));
  assert.ok(definitions.findIndex((item) => item.path === "/Report") < definitions.findIndex((item) => item.path === "/:id"));
});

test("create requires and accepts a valid explicit organization", () => {
  assert.deepEqual(validator.validateCreate(valid), []);
  assert.ok(validator.validateCreate({}) .some((item) => item.field === "ReportDate"));
  assert.equal(validator.validateCreate({ ...valid, OrganizationID: undefined }).find((item) => item.field === "OrganizationID").message, "OrganizationID is required.");
  assert.equal(validator.validateCreate({ ...valid, OrganizationID: "abc" }).find((item) => item.field === "OrganizationID").message, "Invalid OrganizationID.");
  assert.equal(createDTO(valid).OrganizationID, 10);
});

test("time, date, update ID, pagination and sorting validation are safe", () => {
  assert.equal(validator.isTime("12:30 PM"), true);
  assert.equal(validator.isTime("23:30"), true);
  assert.equal(validator.isDate("2026-02-30"), false);
  assert.equal(validator.validateUpdate({ Location: "Lobby" })[0].message, "Incident Report ID is required");
  const query = listDTO({ year: "2026", month: "8", page: "1", pageSize: "10", sortBy: "ReportDate" });
  assert.deepEqual(validator.validateList(query), []);
  assert.ok(validator.validateList(listDTO({ sortBy: "reportdate; DROP TABLE users" })).some((item) => item.field === "sortBy"));
});

test("generated IDs fit the database column and expected timestamp format", () => {
  const ids = new Set(Array.from({ length: 100 }, () => service.generateID()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^\d{20}$/);
});

test("organization resolution handles no, single and multiple mappings", async () => {
  const original = repository.resolveOrganizations;
  const originalRequested = repository.resolveRequestedOrganization;
  try {
    repository.resolveOrganizations = async () => [];
    assert.equal((await service.resolveOrganization(1)).error.message, "No active organization is assigned to the authenticated user.");
    repository.resolveOrganizations = async () => [{ organizationid: "10", organizationname: "Hotel" }];
    assert.equal((await service.resolveOrganization(1)).OrganizationID, 10);
    repository.resolveOrganizations = async () => [{ organizationid: "10" }, { organizationid: "11" }];
    assert.match((await service.resolveOrganization(1)).error.message, /Multiple organizations/);
    repository.resolveRequestedOrganization = async (_userID, organizationID) => organizationID === 11
      ? { organizationid: "11", organizationname: "Selected Hotel" }
      : null;
    assert.equal((await service.resolveOrganization(1, 11)).OrganizationID, 11);
    assert.equal((await service.resolveOrganization(1, 99)).error.statusCode, 403);
  } finally {
    repository.resolveOrganizations = original;
    repository.resolveRequestedOrganization = originalRequested;
  }
});

test("list organization query is optional, validated and preserved with existing filters", () => {
  const query = { ...listDTO({ page: "2", pageSize: "10", search: "rainfall", fromDate: "2026-08-01", toDate: "2026-08-31", year: "2026", month: "8" }), organizationId: "30" };
  assert.equal(query.organizationId, "30");
  assert.deepEqual(validator.validateList(query), []);
  assert.ok(validator.validateList({ ...listDTO({}), organizationId: "invalid" }).some((item) => item.field === "organizationId"));
  assert.equal(listDTO({}).organizationId, undefined);
});

test("create stores the explicitly requested accessible organization", async () => {
  const originalRequested = repository.resolveRequestedOrganization;
  const originalGetClient = repository.getClient;
  const originalInsert = repository.insert;
  let insertedOrganization;
  try {
    repository.resolveRequestedOrganization = async (_userID, organizationID) => ({ organizationid: organizationID, organizationname: "Hotel" });
    repository.getClient = async () => ({ release() {} });
    repository.insert = async (_client, id, organizationID, payload) => {
      insertedOrganization = organizationID;
      assert.equal(payload.OrganizationID, undefined);
      return { id };
    };
    const response = await service.create({ UserID: 7, Payload: createDTO({ ...valid, OrganizationID: 30 }) });
    assert.equal(response.success, true);
    assert.equal(insertedOrganization, 30);
  } finally {
    repository.resolveRequestedOrganization = originalRequested;
    repository.getClient = originalGetClient;
    repository.insert = originalInsert;
  }
});

test("response DTOs keep list compact and detail complete", () => {
  const row = { id: "1", organizationid: "10", organizationshortname: "Ramada Encore", reportdate: "2026-08-20", description: "Detail", isdeleted: false };
  assert.equal(compactDTO(row).Description, undefined);
  assert.equal(compactDTO(row).Organization, "Ramada Encore");
  assert.equal(compactDTO(row).OrganizationID, undefined);
  assert.equal(detailDTO(row).Description, "Detail");
  assert.equal(detailDTO(row).IsDeleted, undefined);
});

test("record organization is derived from the incident and access checked", async () => {
  const originalFindOrganization = repository.findOrganizationByID;
  const originalRequested = repository.resolveRequestedOrganization;
  try {
    repository.findOrganizationByID = async (_client, id) => id === "known" ? { organizationid: "30" } : null;
    repository.resolveRequestedOrganization = async (_userID, organizationID) => organizationID === 30
      ? { organizationid: "30", organizationname: "Hotel", shortname: "Ramada Encore" }
      : null;
    const allowed = await service.resolveRecordOrganization({}, 7, "known");
    assert.equal(allowed.OrganizationID, 30);
    assert.equal(allowed.OrganizationShortName, "Ramada Encore");
    assert.equal((await service.resolveRecordOrganization({}, 7, "missing")).error.statusCode, 404);
    repository.resolveRequestedOrganization = async () => null;
    assert.equal((await service.resolveRecordOrganization({}, 7, "known")).error.statusCode, 403);
  } finally {
    repository.findOrganizationByID = originalFindOrganization;
    repository.resolveRequestedOrganization = originalRequested;
  }
});

test("pdfmake generates a PDF buffer", async () => {
  const pdf = await generatePdf({ title: "INCIDENT REPORT", reportName: "Incident Report", metadata: [{ label: "Incident Report ID", value: "1" }] });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});
