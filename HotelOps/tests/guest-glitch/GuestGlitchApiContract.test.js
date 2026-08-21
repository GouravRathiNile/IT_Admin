require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const authenticateToken = require("../../middleware/authMiddleware");
const router = require("../../routes/GuestGlitchRoutes/GuestGlitchRoutes");
const service = require("../../services/GuestGlitchService/GuestGlitchService");
const repository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const { listDTO, reportListDTO } = require("../../dto/GuestGlitchDTO");
const validator = require("../../validators/GuestGlitchValidator");

const mockResponse = () => ({
  statusCode: null,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

test("Guest Glitch routes use the final REST methods and ID locations", () => {
  const definitions = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: layer.route.methods }));
  const has = (path, method) => definitions.some((route) => route.path === path && route.methods[method]);
  assert.ok(has("/create", "post"));
  assert.ok(has("/list", "get"));
  assert.ok(has("/get/:id", "get"));
  assert.ok(has("/update", "put"));
  assert.ok(has("/delete", "delete"));
  assert.ok(has("/status-update", "patch"));
  assert.ok(has("/options/list", "get"));
  assert.ok(has("/options/upsert", "post"));
  assert.ok(has("/report", "get"));
  assert.ok(has("/report/export/csv", "get"));
  assert.ok(has("/report/export/excel", "get"));
  assert.ok(has("/report/:id", "get"));
  assert.ok(has("/master-report", "get"));
  assert.ok(has("/master-report/:id/pdf", "get"));
  assert.ok(has("/gm/:id", "get"));
  assert.ok(has("/gm-action", "patch"));
  assert.ok(has("/attachment/:id", "get"));
  assert.ok(has("/:id", "get"));
  assert.ok(has("/report/:id/pdf", "get"));
  assert.ok(has("/workflow/config", "post"));
  assert.ok(has("/workflow/config", "get"));
  assert.ok(has("/workflow/config", "delete"));
  const globalMiddleware = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle);
  assert.deepEqual(globalMiddleware, [authenticateToken]);
});

test("list query parses comma-separated department IDs", () => {
  const data = listDTO({ page: "2", pageSize: "20", departmentIds: "1,2,3", sortBy: "EntryDate", sortDirection: "DESC" });
  assert.deepEqual(validator.validateList(data), []);
  assert.deepEqual(data.departmentIds, [1, 2, 3]);
});

test("list query rejects duplicate and malformed department IDs", () => {
  const duplicate = listDTO({ departmentIds: "1,1" });
  assert.ok(validator.validateList(duplicate).some((item) => item.field === "departmentIds"));
  const malformed = listDTO({ departmentIds: "1,abc" });
  assert.ok(validator.validateList(malformed).some((item) => item.field === "departmentIds"));
});

test("ID validation distinguishes missing and invalid IDs", () => {
  assert.equal(validator.validateID({})[0].message, "Guest Glitch ID is required");
  assert.equal(validator.validateID("abc")[0].message, "Guest Glitch ID must be a valid number");
  assert.deepEqual(validator.validateID("1001"), []);
});

test("authentication middleware returns required and expired-token messages", () => {
  const missingResponse = mockResponse();
  authenticateToken({ headers: {} }, missingResponse, () => assert.fail("next must not run"));
  assert.equal(missingResponse.statusCode, 401);
  assert.equal(missingResponse.payload.message, "Authentication token is required");

  const expiredToken = jwt.sign({ UserID: 1 }, process.env.JWT_SECRET, { expiresIn: -1 });
  const expiredResponse = mockResponse();
  authenticateToken({ headers: { authorization: `Bearer ${expiredToken}` } }, expiredResponse, () => assert.fail("next must not run"));
  assert.equal(expiredResponse.statusCode, 401);
  assert.equal(expiredResponse.payload.message, "Invalid or expired authentication token");
});

test("Guest Glitch resolves exactly one active organization mapping", async () => {
  const original = repository.resolveOrganizations;
  try {
    repository.resolveOrganizations = async () => [];
    assert.equal((await service.resolveOrganization(1)).error.message, "No active organization is assigned to the authenticated user.");

    repository.resolveOrganizations = async () => [{ organizationid: "10" }];
    assert.equal((await service.resolveOrganization(1)).OrganizationID, 10);

    repository.resolveOrganizations = async () => [{ organizationid: "10" }, { organizationid: "11" }];
    assert.equal(
      (await service.resolveOrganization(1)).error.message,
      "Multiple organizations are assigned to this user. An organization must be selected before accessing Guest Glitch."
    );
  } finally {
    repository.resolveOrganizations = original;
  }
});

test("workflow configuration validates ordered stages, actors and field allowlists", () => {
  const valid = { Stages: [
    { StageKey: "HOD_REVIEW", StageName: "HOD Review", StageOrder: 1, IsFinalStage: false,
      Actors: [{ ActorType: "USER_TYPE", ActorValue: "HOD", CanView: true, CanEdit: true,
        CanProceed: true, EditableFields: ["DepartmentHODComments"], RequiredActionFields: ["DepartmentHODComments"] }] },
    { StageKey: "FINAL", StageName: "Final", StageOrder: 2, IsFinalStage: true,
      Actors: [{ ActorType: "USER_TYPE", ActorValue: "CEO", CanView: true, EditableFields: [], RequiredActionFields: [] }] },
  ] };
  assert.deepEqual(validator.validateWorkflowConfig(valid), []);
  const invalid = structuredClone(valid);
  invalid.Stages[1].StageOrder = 1;
  invalid.Stages[1].Actors[0].EditableFields = ["OrganizationID"];
  assert.ok(validator.validateWorkflowConfig(invalid).some((item) => item.field.includes("StageOrder")));
  assert.ok(validator.validateWorkflowConfig(invalid).some((item) => item.field.includes("EditableFields")));
});

test("generic update accepts explicit workflow progression and rejects unknown actions", () => {
  const accepted = validator.validateUpdate({ ID: 1, WorkflowAction: "PROCEED" });
  assert.deepEqual(accepted.errors, []);
  const rejected = validator.validateUpdate({ ID: 1, WorkflowAction: "SKIP" });
  assert.ok(rejected.errors.some((item) => item.field === "WorkflowAction"));
});

test("Guest Glitch service overwrites an untrusted organization value", async () => {
  const originals = {
    resolveOrganizations: repository.resolveOrganizations,
    getClient: repository.getClient,
    list: repository.list,
  };
  let scopedOrganizationID;
  try {
    repository.resolveOrganizations = async () => [{ organizationid: "10" }];
    repository.getClient = async () => ({ release() {} });
    repository.list = async (_data, organizationID) => {
      scopedOrganizationID = organizationID;
      return { rows: [], total: 0 };
    };
    const response = await service.list({
      UserID: 1, OrganizationID: 999, page: 1, pageSize: 10,
      sortBy: "EntryDate", sortDirection: "DESC", departmentIds: [],
    });
    assert.equal(response.success, true);
    assert.equal(scopedOrganizationID, 10);
  } finally {
    Object.assign(repository, originals);
  }
});

test("report query accepts dedicated filters and safe sorting", () => {
  const data = reportListDTO({ departmentIds: "1,2", roomNumber: "101", guestName: "Guest", complaintSource: "Call", sortBy: "Hotel", sortDirection: "ASC" });
  assert.deepEqual(validator.validateReportList(data), []);
  assert.deepEqual(data.departmentIds, [1, 2]);
  assert.ok(validator.validateReportList(reportListDTO({ sortBy: "gg.id; DROP TABLE users" })).some((item) => item.field === "sortBy"));
});
