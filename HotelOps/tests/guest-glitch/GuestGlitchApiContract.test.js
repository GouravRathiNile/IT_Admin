require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const authenticateToken = require("../../middleware/authMiddleware");
const router = require("../../routes/GuestGlitchRoutes/GuestGlitchRoutes");
const service = require("../../services/GuestGlitchService/GuestGlitchService");
const repository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const { listDTO, listResponseDTO, reportListDTO, completeReportDTO } = require("../../dto/GuestGlitchDTO");
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
  assert.equal(has("/options/list", "get"), false);
  assert.equal(has("/options/upsert", "post"), false);
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
  assert.equal(has("/workflow/config", "post"), false);
  assert.equal(has("/workflow/config", "get"), false);
  assert.equal(has("/workflow/config", "delete"), false);
  const globalMiddleware = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle);
  assert.deepEqual(globalMiddleware, [authenticateToken]);
});

test("list query parses organization and comma-separated department IDs", () => {
  const data = listDTO({ organizationId: "30", page: "2", pageSize: "20", departmentIds: "1,2,3", sortBy: "EntryDate", sortDirection: "DESC" });
  assert.deepEqual(validator.validateList(data), []);
  assert.equal(data.organizationId, 30);
  assert.deepEqual(data.departmentIds, [1, 2, 3]);
});

test("Guest Glitch GET controllers call services directly and mutation queues remain", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const controller = fs.readFileSync(path.resolve(__dirname, "../../controllers/GuestGlitchController/GuestGlitchController.js"), "utf8");
  const handler = fs.readFileSync(path.resolve(__dirname, "../../consumer/GuestGlitchConsumer/GuestGlitchHandler.js"), "utf8");
  for (const method of ["list", "get", "report", "masterReport", "reportDetail", "gmView", "exportReport", "masterReportPdf", "attachment"]) {
    assert.match(controller, new RegExp(`GuestGlitchService\\.${method}`));
  }
  assert.doesNotMatch(handler, /case "(?:LIST_GUEST_GLITCH|GET_GUEST_GLITCH|LIST_GUEST_GLITCH_OPTIONS|REPORT_GUEST_GLITCH|EXPORT_GUEST_GLITCH_REPORT|REPORT_GUEST_GLITCH_DETAIL|MASTER_REPORT_GUEST_GLITCH|MASTER_REPORT_GUEST_GLITCH_PDF|GET_GUEST_GLITCH_GM|GET_GUEST_GLITCH_ATTACHMENT)"/);
  for (const action of ["CREATE_GUEST_GLITCH", "UPDATE_GUEST_GLITCH", "DELETE_GUEST_GLITCH", "UPDATE_GUEST_GLITCH_STATUS", "GUEST_GLITCH_GM_ACTION"]) {
    assert.match(handler, new RegExp(`case "${action}"`));
  }
});

test("list response contains stored fields required by the Guest Glitch Edit form", () => {
  const response = listResponseDTO({ id: 1012, organizationid: 30, organizationname: "Ramada Encore by Wyndham, Udaipur", shortname: "Ramada",
    entrydate: "2026-08-25", time: "14:30", roomnumber: "101", guestname: "Rohit Sharma", complaint: "Air conditioning issue",
    status: "Open", servicerecovery: "Room changed", gueststatus: "In House", companyname: "ABC",
    departmentids: [1029], receivedbyids: [12], informedtoids: [15], resolvedby: "Manager",
    processlapsecategory: "Service", processlapse: "Delay", internalactiontakencategory: "Training",
    internalactiontaken: "Team briefed", detailedinvestigation: "Reviewed", gmcomment: "Closed",
    sra_room: "100", sra_food: "50", sra_other: "25", departmenthodcomments: [{ departmentId: 1029, comment: "Checked" }],
    getmetjson: [{ GuestMetBy: 12 }], rate: "4500", checkindate: "2026-08-24", checkoutdate: "2026-08-26" }, {
    departments: [{ ID: 1029, Name: "Engineering" }],
    receivedByUsers: [{ ID: 12, Name: "User A" }], informedToUsers: [{ ID: 15, Name: "User B" }],
  });
  for (const field of ["GuestStatus", "ReceivedByUsers", "InformedToUsers",
    "ResolvedBy", "ProcessLapseCategory", "ProcessLapse", "InternalActionTakenCategory", "InternalActionTaken",
    "DetailedInvestigation", "ServiceRecovery", "GMComment", "SRA_Room", "SRA_Food", "SRA_Other",
    "DepartmentHODComments", "GetMetJson", "CompanyName", "Rate", "CheckInDate", "CheckOutDate"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(response, field), `Missing edit field: ${field}`);
  }
  assert.equal(response.OrganizationName, "Ramada");
  assert.equal(response.EntryDate, "25 Aug 2026");
  assert.equal(response.DepartmentHODComments[0].departmentName, "Engineering");
  assert.equal(Object.prototype.hasOwnProperty.call(response, "DepartmentIDs"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response, "ReceivedByIDs"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response, "InformedToIDs"), false);
});

test("list repository applies optional organization and complaint-only search before pagination", () => {
  const source = require("node:fs").readFileSync(require.resolve("../../repositories/GuestGlitchRepository/GuestGlitchRepository"), "utf8");
  const listSource = source.match(/\nconst list = async[\s\S]*?const buildReportFilters/)?.[0] || "";
  assert.match(listSource, /if \(data\.organizationId\) add\("gg\.organizationid = \?"/);
  assert.match(listSource, /filters\.push\(`gg\.complaint ILIKE \$\{p\}`\)/);
  assert.match(listSource, /SELECT COUNT\(\*\)::bigint AS total[\s\S]*WHERE \$\{where\}/);
  assert.match(listSource, /om\.shortname/);
  assert.match(listSource, /gg\.receivedbyids/);
  assert.match(listSource, /gg\.departmenthodcomments/);
  assert.match(listSource, /gg\.getmetjson/);
  assert.ok(listSource.indexOf("SELECT COUNT") < listSource.indexOf("LIMIT $"));
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
    assert.deepEqual((await service.resolveOrganization(1, true)).OrganizationIDs, [10, 11]);
  } finally {
    repository.resolveOrganizations = original;
  }
});

test("generic update no longer accepts workflow actions", () => {
  const result = validator.validateUpdate({ ID: 1, WorkflowAction: "PROCEED" });
  assert.ok(result.errors.some((item) => item.field === "WorkflowAction"));
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
    assert.deepEqual(scopedOrganizationID, [10]);
  } finally {
    Object.assign(repository, originals);
  }
});

test("multi-organization list uses only authenticated active mappings", async () => {
  const originals = { resolveOrganizations: repository.resolveOrganizations, getClient: repository.getClient, list: repository.list };
  let scope;
  try {
    repository.resolveOrganizations = async () => [
      { organizationid: "10", usertype: "CEO" }, { organizationid: "11", usertype: "CEO" },
    ];
    repository.getClient = async () => ({ release() {} });
    repository.list = async (_data, organizationIDs) => { scope = organizationIDs; return { rows: [], total: 0 }; };
    const response = await service.list({ UserID: 1, page: 1, pageSize: 10, sortBy: "EntryDate", sortDirection: "DESC" });
    assert.equal(response.success, true);
    assert.deepEqual(scope, [10, 11]);
  } finally { Object.assign(repository, originals); }
});

test("repository visibility is organization scoped without workflow configuration", () => {
  const source = require("node:fs").readFileSync(require.resolve("../../repositories/GuestGlitchRepository/GuestGlitchRepository"), "utf8");
  assert.match(source, /gg\.organizationid\s*=\s*ANY\(\$1::bigint\[\]\)/);
  assert.doesNotMatch(source, /guest_glitch_flow_config|currentworkflowstage/);
});

test("ID-based update derives the record organization for multi-organization users", async () => {
  const originals = {
    resolveOrganizations: repository.resolveOrganizations,
    getClient: repository.getClient,
    findByID: repository.findByID,
  };
  const organizationArguments = [];
  try {
    repository.resolveOrganizations = async () => [{ organizationid: "10" }, { organizationid: "20" }];
    repository.getClient = async () => ({ query: async () => ({ rows: [] }), release() {} });
    repository.findByID = async (_client, _id, organizationID) => {
      organizationArguments.push(organizationID);
      return {
        id: "1012", organizationid: "20", complaint: "Same complaint",
        departmentids: [], receivedbyids: [], informedtoids: [], departmenthodcomments: [],
      };
    };

    const response = await service.update({
      ID: 1012, Complaint: "Same complaint", UserID: 7, Username: "user", IP: "127.0.0.1",
    });
    assert.equal(response.success, true);
    assert.equal(response.message, "No changes were detected.");
    assert.deepEqual(organizationArguments[0], [10, 20]);
    assert.equal(organizationArguments[1], 20);
  } finally {
    Object.assign(repository, originals);
  }
});

test("create uses the selected mapped organization without workflow configuration", async () => {
  const originals = {};
  for (const name of ["resolveOrganizations", "getClient", "validateDepartments", "validateUsers", "insert"]) originals[name] = repository[name];
  let inserted;
  try {
    repository.resolveOrganizations = async () => [{ organizationid: "30" }, { organizationid: "31" }];
    repository.getClient = async () => ({ query: async () => ({}), release() {} });
    repository.validateDepartments = async () => [{ departmentid: 10, departmentname: "Engineering" }];
    repository.validateUsers = async (_client, _organizationID, ids) => ids.map((id) => ({ userid: id, fullname: `User ${id}` }));
    repository.insert = async (_client, data) => { inserted = data; return { id: 1001 }; };
    const response = await service.create({ UserID: 7, Username: "admin", IP: "127.0.0.1", OrganizationID: 30,
      GuestStatus: "In House", RoomNumber: "101", GuestName: "Guest", Complaint: "AC issue",
      DepartmentIDs: [10], ReceivedByIDs: [3], InformedToIDs: [4], Time: "14:30", CompanyName: "ABC" });
    assert.equal(response.success, true);
    assert.equal(inserted.OrganizationID, 30);
    assert.equal(inserted.Status, "Open");
    assert.equal(inserted.CurrentWorkflowStage, undefined);
    assert.deepEqual(inserted.DepartmentHODComments, [{
      departmentName: "Engineering",
      HODComment: "",
    }]);
  } finally { Object.assign(repository, originals); }
});

test("static dropdown values are stored without Guest Glitch option-master validation", () => {
  const serviceSource = require("node:fs").readFileSync(require.resolve("../../services/GuestGlitchService/GuestGlitchService"), "utf8");
  const repositorySource = require("node:fs").readFileSync(require.resolve("../../repositories/GuestGlitchRepository/GuestGlitchRepository"), "utf8");
  assert.doesNotMatch(serviceSource, /validateOptions|listOptions|upsertOption/);
  assert.doesNotMatch(repositorySource, /const findOption|const listOptions|const upsertOption/);
  const validation = validator.validateUpdate({
    ID: 1, GuestStatus: "Frontend Static Status", ComplaintSource: "Frontend Static Source",
    RaiseSource: "Frontend Raise Source", ProcessLapseCategory: "Frontend Category",
    InternalActionTakenCategory: "Frontend Action Category",
  });
  assert.deepEqual(validation.errors, []);
});

test("create rejects an organization not mapped to the authenticated user", async () => {
  const original = repository.resolveOrganizations;
  try {
    repository.resolveOrganizations = async () => [{ organizationid: "30" }];
    const response = await service.create({ UserID: 7, OrganizationID: 99 });
    assert.equal(response.statusCode, 403);
  } finally { repository.resolveOrganizations = original; }
});

test("complete detail preserves review attribution and resolves department names", () => {
  const result = completeReportDTO({ id: 1, departmenthodcomments: [{ departmentId: 10, comment: "Corrected", commentedBy: "hod" }] },
    { departments: [{ ID: 10, Name: "Engineering" }] });
  assert.deepEqual(result.DepartmentHODComments, [{ departmentName: "Engineering", HODComment: "Corrected" }]);
});

test("report query accepts dedicated filters and safe sorting", () => {
  const data = reportListDTO({ departmentIds: "1,2", roomNumber: "101", guestName: "Guest", complaintSource: "Call", sortBy: "Hotel", sortDirection: "ASC" });
  assert.deepEqual(validator.validateReportList(data), []);
  assert.deepEqual(data.departmentIds, [1, 2]);
  assert.ok(validator.validateReportList(reportListDTO({ sortBy: "gg.id; DROP TABLE users" })).some((item) => item.field === "sortBy"));
});
