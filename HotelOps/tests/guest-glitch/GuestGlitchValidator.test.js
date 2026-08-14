const test = require("node:test");
const assert = require("node:assert/strict");
const validator = require("../../validators/GuestGlitchValidator");
const { getPermissions } = require("../../config/guestGlitchPermissions");
const { PERMISSIONS } = require("../../config/guestGlitchConstants");

const validCreate = () => ({
  GuestStatus: "In House", RoomNumber: "101", GuestName: "Test Guest",
  Complaint: "Air conditioning issue", DepartmentIDs: [1], ReceivedByIDs: [2],
  InformedToIDs: [3], DepartmentHODComments: [{ departmentId: 1, comment: "Reviewing" }],
  Time: "14:30", CheckInDate: "2026-08-14", CheckOutDate: "2026-08-15", Rate: "1200.00",
});

test("valid create payload passes structural validation", () => {
  assert.deepEqual(validator.validateCreate(validCreate()).errors, []);
});

test("required create fields produce structured errors", () => {
  const errors = validator.validateCreate({}).errors;
  assert.ok(errors.some((item) => item.field === "GuestName"));
  assert.ok(errors.some((item) => item.field === "DepartmentIDs"));
});

test("duplicate IDs are rejected", () => {
  const input = validCreate(); input.DepartmentIDs = [1, 1];
  assert.ok(validator.validateCreate(input).errors.some((item) => item.field === "DepartmentIDs"));
});

test("invalid dates, time, and negative values are rejected", () => {
  const input = validCreate();
  input.Time = "25:00"; input.CheckOutDate = "2026-08-01"; input.SRA_Room = -1;
  const errors = validator.validateCreate(input).errors;
  assert.ok(errors.some((item) => item.field === "Time"));
  assert.ok(errors.some((item) => item.field === "CheckOutDate"));
  assert.ok(errors.some((item) => item.field === "SRA_Room"));
});

test("protected audit and organization fields are rejected", () => {
  const input = validCreate(); input.OrganizationID = 99; input.CreatedBy = 1;
  const errors = validator.validateCreate(input).errors;
  assert.ok(errors.some((item) => item.field === "OrganizationID"));
  assert.ok(errors.some((item) => item.field === "CreatedBy"));
});

test("list pagination and safe sorting are validated", () => {
  const errors = validator.validateList({ page: 0, pageSize: 101, sortBy: "DROP TABLE", sortDirection: "SIDEWAYS", departmentIds: [], receivedByIds: [], informedToIds: [] });
  assert.equal(errors.length, 4);
});

test("role permission map grants Hotel HOD core permissions and defaults unknown roles to deny", () => {
  const hotel = getPermissions({ LoginType: "Hotel", UserType: " HOD" });
  assert.ok(hotel.includes(PERMISSIONS.CREATE));
  assert.ok(hotel.includes(PERMISSIONS.DELETE));
  assert.deepEqual(getPermissions({ LoginType: "Unknown", UserType: "Unknown" }), []);
});
