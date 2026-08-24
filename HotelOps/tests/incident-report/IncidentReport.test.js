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

test("create validates core fields and rejects protected values", () => {
  assert.deepEqual(validator.validateCreate(valid), []);
  assert.ok(validator.validateCreate({}) .some((item) => item.field === "ReportDate"));
  assert.ok(validator.validateCreate({ ...valid, OrganizationID: 10 }).some((item) => item.field === "OrganizationID"));
  assert.equal(createDTO({ ...valid, OrganizationID: 10 }).OrganizationID, undefined);
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
  try {
    repository.resolveOrganizations = async () => [];
    assert.equal((await service.resolveOrganization(1)).error.message, "No active organization is assigned to the authenticated user.");
    repository.resolveOrganizations = async () => [{ organizationid: "10", organizationname: "Hotel" }];
    assert.equal((await service.resolveOrganization(1)).OrganizationID, 10);
    repository.resolveOrganizations = async () => [{ organizationid: "10" }, { organizationid: "11" }];
    assert.match((await service.resolveOrganization(1)).error.message, /Multiple organizations/);
  } finally { repository.resolveOrganizations = original; }
});

test("response DTOs keep list compact and detail complete", () => {
  const row = { id: "1", organizationid: "10", reportdate: "2026-08-20", description: "Detail", isdeleted: false };
  assert.equal(compactDTO(row).Description, undefined);
  assert.equal(detailDTO(row).Description, "Detail");
  assert.equal(detailDTO(row).IsDeleted, undefined);
});

test("pdfmake generates a PDF buffer", async () => {
  const pdf = await generatePdf({ title: "INCIDENT REPORT", reportName: "Incident Report", metadata: [{ label: "Incident Report ID", value: "1" }] });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});
