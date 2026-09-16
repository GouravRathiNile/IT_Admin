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

async function getRecords({ userType = "HOD", department = "Finance", organization = 20, config = [], rows }) {
  const context = {
    console,
    formatDate: () => null,
    fail: (message, statusCode) => ({ success: false, message, statusCode }),
    ok: (message, data) => ({ success: true, message, data }),
    retryableDatabaseResponse: () => null,
    databaseFailure: (error) => { throw error; },
    pool: { query: async (sql, values) => {
      assert.doesNotMatch(sql, /COALESCE\(\s*aa\.AMCApprovalID/i);
      if (sql.includes("FROM Engineering_AMC_Documents")) return { rows: [] };
      if (sql.includes("FROM Engineering_AMC_Approval_Config") && !sql.includes("Engineering_AMC_Master")) {
        assert.equal(values[0], organization);
        return { rows: config.map((role, i) => ({ amcapprovalconfigid: i + 1, approvallevel: i + 1,
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
  const result = await context.run({ OrganizationID: organization, UserID: 3, UserType: userType, DepartmentName: department });
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
  assert.equal((await getRecords({ organization: 10, config: ["RD", "CEO"], rows: [{ rdstatus: "Pending" }] }))[0].CanApprove, true);
  assert.equal((await getRecords({ userType: "CEO", config: ["GM"], rows: [{ gmstatus: "Pending" }] }))[0].CanApprove, false);
});
