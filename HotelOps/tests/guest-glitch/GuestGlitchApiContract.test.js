require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const authenticateToken = require("../../middleware/authMiddleware");
const organizationContext = require("../../middleware/organizationContextMiddleware");
const router = require("../../routes/GuestGlitchRoutes/GuestGlitchRoutes");
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
  assert.ok(has("/report/:id", "get"));
  assert.ok(has("/master-report", "get"));
  assert.ok(has("/master-report/:id/pdf", "get"));
  assert.ok(has("/gm/:id", "get"));
  assert.ok(has("/gm-action", "patch"));
  assert.ok(has("/attachment/:id", "get"));
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

test("organization middleware requires OrganizationID in authenticated context", async () => {
  const response = mockResponse();
  await organizationContext({ user: { UserID: 1 } }, response, () => assert.fail("next must not run"));
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.message, "Organization information is not available for the authenticated user");
});

test("report query accepts dedicated filters and safe sorting", () => {
  const data = reportListDTO({ departmentIds: "1,2", roomNumber: "101", guestName: "Guest", complaintSource: "Call", sortBy: "Hotel", sortDirection: "ASC" });
  assert.deepEqual(validator.validateReportList(data), []);
  assert.deepEqual(data.departmentIds, [1, 2]);
  assert.ok(validator.validateReportList(reportListDTO({ sortBy: "gg.id; DROP TABLE users" })).some((item) => item.field === "sortBy"));
});
