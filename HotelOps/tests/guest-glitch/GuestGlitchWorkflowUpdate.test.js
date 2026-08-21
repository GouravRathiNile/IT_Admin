require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../../services/GuestGlitchService/GuestGlitchService");
const repository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const validator = require("../../validators/GuestGlitchValidator");

const baseRecord = () => ({
  id: 1010, organizationid: 1, currentworkflowstage: "HOD_REVIEW", createdby: "99",
  departmentids: [10], receivedbyids: [], informedtoids: [], departmenthodcomments: [],
  department: "Engineering", receivedby: "", informedto: "", resolvedby: "",
  guestname: "Existing Guest", roomnumber: "101", complaint: "Existing complaint",
  status: "Open", updatedby: "creator",
});

const withUpdateMocks = async (work, overrides = {}) => {
  const originals = {};
  for (const name of ["resolveOrganizations", "getClient", "findByID", "getWorkflowAccess",
    "validateDepartments", "validateUsers", "findOption", "updateChangedFields"]) originals[name] = repository[name];
  const queries = [], updates = [];
  const client = { query: async (sql) => { queries.push(sql); return { rows: [], rowCount: 0 }; }, release() {} };
  repository.resolveOrganizations = async () => [{ organizationid: 1, usertype: "HOD", departmentid: 10 }];
  repository.getClient = async () => client;
  repository.findByID = async () => baseRecord();
  repository.getWorkflowAccess = async () => ({ stagekey: "HOD_REVIEW", stagename: "HOD Review", canview: true,
    canedit: true, canproceed: true, editablefields: ["DepartmentHODComments"],
    requiredactionfields: ["DepartmentHODComments"], nextstage: "GM_REVIEW", isfinalstage: false });
  repository.validateDepartments = async (_client, _org, ids) => ids.map((id) => ({ departmentid: id, departmentname: id === 10 ? "Engineering" : "Other" }));
  repository.validateUsers = async () => [];
  repository.findOption = async () => ({ optionid: 1 });
  repository.updateChangedFields = async (_client, _id, _org, changed) => { updates.push(changed); return { id: 1010 }; };
  Object.assign(repository, overrides);
  try { return await work({ updates, queries }); }
  finally { Object.assign(repository, originals); }
};

const comment = (departmentId, text = "Engineering inspected the room") =>
  ({ departmentId, comment: text });

test("partial update validator does not require DepartmentIDs with HOD comments", () => {
  const result = validator.validateUpdate({ ID: 1010, DepartmentHODComments: [comment(10)], WorkflowAction: "PROCEED" });
  assert.deepEqual(result.errors, []);
});

test("HOD can update an assigned department comment and proceed without resending create fields", async () => {
  await withUpdateMocks(async ({ updates }) => {
    const response = await service.update({ UserID: 7, Username: "hod", ID: 1010,
      DepartmentHODComments: [comment(10)], WorkflowAction: "PROCEED", IP: "127.0.0.1" });
    assert.equal(response.success, true);
    assert.equal(response.data.CurrentWorkflowStage, "GM_REVIEW");
    assert.deepEqual(updates[0].DepartmentIDs, undefined);
    assert.deepEqual(updates[0].DepartmentHODComments, [comment(10)]);
  });
});

test("unchanged non-editable DepartmentIDs are ignored but changed DepartmentIDs are forbidden", async () => {
  await withUpdateMocks(async () => {
    const unchanged = await service.update({ UserID: 7, Username: "hod", ID: 1010,
      DepartmentIDs: [10], DepartmentHODComments: [comment(10)], WorkflowAction: "PROCEED", IP: "127.0.0.1" });
    assert.equal(unchanged.success, true);
  });
  await withUpdateMocks(async () => {
    const changed = await service.update({ UserID: 7, Username: "hod", ID: 1010,
      DepartmentIDs: [20], IP: "127.0.0.1" });
    assert.equal(changed.statusCode, 403);
    assert.equal(changed.message, "You are not authorized to update field: DepartmentIDs");
  });
});

test("HOD comment must belong to a department already assigned to the glitch", async () => {
  await withUpdateMocks(async () => {
    const response = await service.update({ UserID: 7, Username: "hod", ID: 1010,
      DepartmentHODComments: [comment(20)], WorkflowAction: "PROCEED", IP: "127.0.0.1" });
    assert.equal(response.success, false);
    assert.equal(response.message, "Department HOD comment can only be added for a selected department");
  });
});

test("unchanged displayed fields are ignored while actual unauthorized changes are rejected", async () => {
  await withUpdateMocks(async () => {
    const unchanged = await service.update({ UserID: 7, Username: "hod", ID: 1010,
      GuestName: "Existing Guest", DepartmentHODComments: [comment(10)], WorkflowAction: "PROCEED", IP: "127.0.0.1" });
    assert.equal(unchanged.success, true);
  });
  await withUpdateMocks(async () => {
    const changed = await service.update({ UserID: 7, Username: "hod", ID: 1010,
      GuestName: "Changed Guest", IP: "127.0.0.1" });
    assert.equal(changed.statusCode, 403);
    assert.equal(changed.message, "You are not authorized to update field: GuestName");
  });
});

test("new HOD comment replaces the same department comment without duplicating others", async () => {
  await withUpdateMocks(async ({ updates }) => {
    repository.findByID = async () => ({ ...baseRecord(), departmentids: [10, 11],
      departmenthodcomments: [comment(10, "Old"), comment(11, "Keep")] });
    const response = await service.update({ UserID: 7, Username: "hod", ID: 1010,
      DepartmentHODComments: [comment(10, "Replacement")], IP: "127.0.0.1" });
    assert.equal(response.success, true);
    assert.deepEqual(updates[0].DepartmentHODComments, [comment(10, "Replacement"), comment(11, "Keep")]);
  });
});
