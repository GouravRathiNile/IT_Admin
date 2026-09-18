const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../services/EngineeringService/EngineeringService.js"), "utf8");
const defaultsStart = source.indexOf("const DEFAULT_AMC_APPROVALS =");
const defaultsEnd = source.indexOf("const AMC_APPROVAL_ROLES", defaultsStart);
const start = source.indexOf("const resolveAMCApprovalRole =");
const end = source.indexOf("const getAMCById =", start);

test("AMC detail approval flag respects new records, stages and existing access restrictions", async () => {
  let row;
  let flow;
  const context = {
    console, formatDate: () => null,
    fail: (message, statusCode) => ({ success: false, message, statusCode }),
    ok: (message, data) => ({ success: true, data }),
    retryableDatabaseResponse: () => null,
    databaseFailure: (error) => { throw error; },
    pool: { query: async (sql) => {
      if (sql.includes("FROM user_master um")) return { rows: [] };
      assert.doesNotMatch(sql, /COALESCE\(\s*aa\.AMCApprovalID/i);
      if (sql.includes("FROM Engineering_AMC_Master")) {
        assert.match(sql.slice(0, sql.indexOf("FROM Engineering_AMC_Master")), /aa\.AMCApprovalID,/);
      }
      return { rows: [row] };
    } },
    attachAMCRelatedData: async () => [{ Approvals: flow }],
  };
  vm.createContext(context);
  const roleEnd = source.indexOf("const getAMCApprovalFlow =", start);
  const detailEnd = source.indexOf("const updateAMC =", end);
  vm.runInContext(source.slice(start, roleEnd) + source.slice(end, detailEnd) + "\nthis.run = getAMCById;", context);
  for (const scenario of [
    { id: 0, expected: false },
    { expected: true },
    { status: "Rejected", expected: false },
    { status: "Returned", expected: false },
    { final: "Approved", status: "Approved", expected: false },
    { missing: true, expected: false },
    { user: "Employee", expected: false },
    { user: "GM", forbidden: true },
    { status: "Approved", stage: "GM", expected: false },
  ]) {
    row = { organizationid: 20, equipmentid: 2, departmentid: 1,
      amcapprovalid: scenario.missing ? null : 1,
      currentapprovalrole: scenario.stage || "FC",
      fcstatus: scenario.status || "Pending", finalstatus: scenario.final || "Pending" };
    flow = [{ ApprovalRole: "FC", Status: row.fcstatus }, { ApprovalRole: "GM", Status: "Pending" }];
    const result = await context.run({ AMCID: scenario.id ?? 1, EquipmentID: 2,
      UserID: 3, UserType: scenario.user || "HOD", DepartmentName: "Finance" });
    if (scenario.forbidden) assert.equal(result.statusCode, 403);
    else {
      assert.equal(result.success, true);
      assert.equal(result.data.CanApprove, scenario.expected);
    }
  }
});

async function getRecords({ userType = "HOD", department = "Finance", organization = 20,
  config = [], rows, centralRD = false, mapped = true }) {
  const context = {
    console,
    formatDate: () => null,
    fail: (message, statusCode) => ({ success: false, message, statusCode }),
    ok: (message, data) => ({ success: true, message, data }),
    retryableDatabaseResponse: () => null,
    databaseFailure: (error) => { throw error; },
    pool: { query: async (sql, values) => {
      if (sql.includes("FROM user_master um")) return { rows: centralRD ? [{ one: 1 }] : [] };
      if (sql.includes("FROM user_org_mapping uom") && !sql.includes("user_master")) {
        return { rows: mapped ? [{ one: 1 }] : [] };
      }
      assert.doesNotMatch(sql, /COALESCE\(\s*aa\.AMCApprovalID/i);
      if (sql.includes("FROM Engineering_AMC_Documents")) return { rows: [] };
      if (sql.includes("FROM Engineering_AMC_Approval_Config") && !sql.includes("Engineering_AMC_Master")) {
        return { rows: config.map((role, i) => ({ amcapprovalconfigid: i + 1,
          organizationid: organization, approvallevel: i + 1,
          approvalorder: i + 1, approvalrole: role, ismandatory: true })) };
      }
      if (sql.includes("COUNT(*)")) return { rows: [{ totalcount: rows.length }] };
      const selectColumns = sql.slice(0, sql.indexOf("FROM Engineering_AMC_Master"));
      assert.match(selectColumns, /aa\.AMCApprovalID,\s*aa\.FCStatus,/);
      return { rows: rows.map((row, i) => ({ amcid: i + 1, organizationid: organization, equipmentid: 2,
        amcapprovalid: i + 1, finalstatus: "Pending", ...row })) };
    } },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(defaultsStart, defaultsEnd) + source.slice(start, end) + "\nthis.run = getAllAMC;", context);
  const result = await context.run({ OrganizationID: organization, UserID: 3,
    UserType: userType, DepartmentName: department });
  assert.equal(result.success, true);
  assert.equal(result.data.TotalCount, rows.length);
  return result.data.data;
}

test("AMC list returns a boolean per row for active, pending approval only", async () => {
  const records = await getRecords({ rows: [
    { fcstatus: "Pending" },
    { fcstatus: "Approved", gmstatus: "Pending" },
    { fcstatus: "Rejected" },
    { fcstatus: "Returned" },
    { fcstatus: "Pending", finalstatus: "Approved" },
    { fcstatus: "Pending", amcapprovalid: null },
  ] });
  assert.deepEqual(Array.from(records, (row) => row.CanApprove), [true, false, false, false, false, false]);
});

test("AMC database failure passes the original error and operation to the handler", async () => {
  const original = new Error("Database query failed");
  let handled = false;
  const context = {
    console: { error() {} },
    pool: { query: async () => { throw original; } },
    retryableDatabaseResponse: () => null,
    databaseFailure: (error, operation) => {
      assert.equal(error, original);
      assert.equal(operation, "Fetch AMC records");
      handled = true;
      return { success: false, statusCode: 500 };
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(defaultsStart, defaultsEnd) + source.slice(start, end) + "\nthis.run = getAllAMC;", context);
  const result = await context.run({ OrganizationID: 20, UserID: 3, UserType: "GM" });
  assert.equal(result.statusCode, 500);
  assert.equal(handled, true);
});

test("configured order/subset and JWT role determine visibility", async () => {
  assert.equal((await getRecords({ userType: "GM", config: ["GM", "FC"], rows: [{ gmstatus: " pending " }] }))[0].CanApprove, true);
  assert.equal((await getRecords({ config: ["GM", "FC"], rows: [{ gmstatus: "Pending", fcstatus: "Pending" }] }))[0].CanApprove, false);
  assert.equal((await getRecords({ userType: "GM", rows: [{ fcstatus: "Approved", gmstatus: "Pending" }] }))[0].CanApprove, true);
  assert.equal((await getRecords({ userType: "Employee", rows: [{ fcstatus: "Pending" }] }))[0].CanApprove, false);
  assert.equal((await getRecords({ organization: 10, centralRD: true,
    config: ["RD", "CEO"], rows: [{ rdstatus: "Pending" }] }))[0].CanApprove, true);
  assert.equal((await getRecords({ userType: "CEO", config: ["GM"], rows: [{ gmstatus: "Pending" }] }))[0].CanApprove, false);
});

test("central RD uses org 10 as global view and requires mapping for a specific organization", async () => {
  const context = { console, fail: (message, statusCode) => ({ success: false, message, statusCode }) };
  vm.createContext(context);
  const accessEnd = source.indexOf("// ===============Get AMC Approval Flow Helper", start);
  vm.runInContext(source.slice(start, accessEnd) + "\nthis.resolve = resolveAMCAccess;", context);
  const global = await context.resolve({ UserID: 8, UserType: "HOD",
    DepartmentName: "Finance", OrganizationID: 10 },
  { query: async () => ({ rows: [{ one: 1 }] }) }, { requireSelectedMapping: true });
  assert.equal(global.approvalRole, "RD");
  assert.equal(global.globalView, true);

  let queryNumber = 0;
  const denied = await context.resolve({ UserID: 8, UserType: "HOD",
    DepartmentName: "Finance", OrganizationID: 20 }, { query: async () => {
    queryNumber += 1;
    return { rows: queryNumber === 1 ? [{ one: 1 }] : [] };
  } }, { requireSelectedMapping: true });
  assert.equal(denied.error.statusCode, 403);
});

test("RD pending and approved filters use the RD status column", async () => {
  const context = { console, fail: (message, statusCode) => ({ success: false, message, statusCode }) };
  vm.createContext(context);
  const accessEnd = source.indexOf("// ===============Get AMC Approval Flow Helper", start);
  vm.runInContext(source.slice(start, accessEnd) + "\nthis.resolve = resolveAMCAccess;", context);
  const db = { query: async () => ({ rows: [{ one: 1 }] }) };
  assert.equal((await context.resolve({ UserID: 8, UserType: "HOD",
    DepartmentName: "Finance", OrganizationID: 20 }, db)).approvalRole, "RD");
  assert.match(source.slice(start, end), /RD:\s*"aa\.RDStatus"/);
});

test("RD approval actions update only the RD approval columns", () => {
  const approvalStart = source.indexOf("const processAMCApproval = async");
  const approvalEnd = source.indexOf("// ============================================================AMC Approval Config List", approvalStart);
  const approvalSource = source.slice(approvalStart, approvalEnd);
  assert.match(approvalSource, /RD:\s*\{\s*Status:\s*"RDStatus",[\s\S]*?DateTime:\s*"RDStatusDateTime",[\s\S]*?ApprovedBy:\s*"RDStatusApprovedBy",[\s\S]*?Remarks:\s*"RDRemarks"/);
  assert.match(approvalSource, /resolveAMCAccess\(\{[\s\S]*?UserID/);
});

test("AMC document paths are returned through the Engineering Azure URL helper", () => {
  const attachStart = source.indexOf("const attachAMCRelatedData =");
  const attachEnd = source.indexOf("// ===================Get All AMC Function", attachStart);
  assert.match(source.slice(attachStart, attachEnd),
    /FilePath:\s*row\.filepath \? generateUrl\(row\.filepath\) : null/);
});
