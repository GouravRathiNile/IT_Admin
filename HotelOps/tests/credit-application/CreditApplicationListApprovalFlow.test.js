const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../../db");
const {
  getCreditApplicationList,
} = require("../../services/CreditApplicationService/CreditApplicationService");

test("ApprovalFlow status filters the selected stage without reusing it for login-role visibility", async () => {
  const originalQuery = pool.query;
  const calls = [];

  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/COUNT\s*\(\s*\*\s*\)/i.test(sql)) {
      return { rows: [{ totalcount: "0" }] };
    }
    return { rows: [] };
  };

  try {
    const response = await getCreditApplicationList({
      OrganizationID: 20,
      UserType: "HOD",
      DepartmentName: "Finance",
      ApprovalFlow: "GM",
      Status: "Rejected",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, true);
    assert.equal(calls.length, 2);

    for (const call of calls) {
      assert.match(
        call.sql,
        /UPPER\(TRIM\(COALESCE\(approval\.GMStatus, 'Pending'\)\)\)\s*=\s*\$4/i,
      );
      assert.doesNotMatch(
        call.sql,
        /UPPER\(TRIM\(COALESCE\(approval\.FinanceStatus, ''\)\)\)\s*=\s*\$\d+/i,
      );
    }

    assert.deepEqual(calls[0].values, [20, "FC", "GM", "REJECTED"]);
    assert.deepEqual(calls[1].values, [20, "FC", "GM", "REJECTED", 10, 0]);
  } finally {
    pool.query = originalQuery;
  }
});

test("ApprovalFlow Pending remains tied to the selected current stage", async () => {
  const originalQuery = pool.query;
  const calls = [];

  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/COUNT\s*\(\s*\*\s*\)/i.test(sql)) {
      return { rows: [{ totalcount: "0" }] };
    }
    return { rows: [] };
  };

  try {
    const response = await getCreditApplicationList({
      OrganizationID: 20,
      UserType: "HOD",
      DepartmentName: "Finance",
      ApprovalFlow: "GM",
      Status: "Pending",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, true);
    assert.equal(calls.length, 2);
    assert.match(
      calls[0].sql,
      /current_stage\.ApprovalRole[\s\S]*=\s*\$3[\s\S]*current_stage\.Status[\s\S]*'PENDING'/i,
    );
    assert.deepEqual(calls[0].values, [20, "FC", "GM"]);
    assert.deepEqual(calls[1].values, [20, "FC", "GM", 10, 0]);
  } finally {
    pool.query = originalQuery;
  }
});
