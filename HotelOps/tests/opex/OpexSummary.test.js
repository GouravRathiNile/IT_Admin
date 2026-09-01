const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pool } = require("../../db");
const OpexService = require("../../services/OpexService/OpexService");

const summaryRow = {
  totalopex: "6",
  totalamount: "2100",
  pendingcount: "1",
  pendingamount: "100",
  approvedcount: "1",
  approvedamount: "200",
  rejectedcount: "1",
  rejectedamount: "300",
  holdcount: "1",
  holdamount: "400",
  returnedcount: "1",
  returnedamount: "500",
  voidcount: "1",
  voidamount: "600",
};

test("non-approval roles receive the organization-wide OPEX summary", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [summaryRow] };
  };

  try {
    const user = await OpexService.getOpexSummaryReport({
      Filters: { OrganizationID: 20 },
      UserType: "USER",
    });
    const other = await OpexService.getOpexSummaryReport({
      Filters: { OrganizationID: 20 },
      UserType: "OTHER",
    });

    assert.equal(user.success, true);
    assert.deepEqual(user.data, other.data);
    assert.equal(user.data.TotalOpex, 6);
    assert.equal(user.data.HoldCount, 1);
    assert.deepEqual(calls.map((call) => call.values), [[20], [20]]);
    assert.match(calls[0].sql, /cm\.IsDeleted = FALSE/);
    assert.match(calls[0].sql, /ca\.FinalStatus/);
    assert.match(calls[0].sql, /cm\.IsVoid = TRUE THEN 'Void'/);
  } finally {
    pool.query = originalQuery;
  }
});

test("OPEX approval roles retain their role-scoped summary", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [summaryRow] };
  };

  try {
    const response = await OpexService.getOpexSummaryReport({
      Filters: { OrganizationID: 20 },
      UserType: "rd-fc",
    });

    assert.equal(response.success, true);
    assert.deepEqual(call.values, [20, "RD-FC", null]);
    assert.match(call.sql, /CurrentApprovalRole = \$2/);
  } finally {
    pool.query = originalQuery;
  }
});

test("OPEX OrganizationID remains mandatory and UserType comes from JWT", async () => {
  const response = await OpexService.getOpexSummaryReport({
    Filters: {},
    UserType: "USER",
  });
  assert.equal(response.success, false);
  assert.equal(response.statusCode, 400);

  const controllerSource = fs.readFileSync(
    path.join(__dirname, "../../controllers/OpexController/OpexController.js"),
    "utf8",
  );
  const handler = controllerSource.match(
    /exports\.getOpexSummaryReport[\s\S]*?\/\/ =+ Department Report/,
  )[0];

  assert.match(handler, /const UserType = user\.UserType\.toUpperCase\(\)/);
  assert.doesNotMatch(handler, /req\.(query|body).*UserType/);
  assert.doesNotMatch(handler, /Only HOD, FC, GM, RD-FC, or CEO/);
});

test("non-Finance HOD OPEX summary is scoped to JWT department", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [summaryRow] };
  };

  try {
    const response = await OpexService.getOpexSummaryReport({
      Filters: { OrganizationID: 20 },
      UserType: "HOD",
      DepartmentName: "  Engineering  ",
    });

    assert.equal(response.success, true);
    assert.deepEqual(call.values, [20, "HOD", "Engineering"]);
    assert.match(
      call.sql,
      /LOWER\(TRIM\(cm\.Department\)\) = LOWER\(TRIM\(\$3::text\)\)/,
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("HOD OPEX summary without JWT department is forbidden", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let queried = false;
  pool.query = async () => {
    queried = true;
    return { rows: [summaryRow] };
  };

  try {
    const response = await OpexService.getOpexSummaryReport({
      Filters: { OrganizationID: 20 },
      UserType: "HOD",
      DepartmentName: "",
    });

    assert.equal(response.success, false);
    assert.equal(response.statusCode, 403);
    assert.equal(queried, false);
  } finally {
    pool.query = originalQuery;
  }
});

test("non-Finance HOD OPEX list scopes every status and count to JWT department", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    for (const Status of [null, "Pending", "Approved", "Rejected", "Hold", "Returned"]) {
      const response = await OpexService.getAllOpex({
        OrganizationID: 20,
        UserType: "HOD",
        DepartmentName: "  Engineering  ",
        Status,
        page: 1,
        PageSize: 10,
      });
      assert.equal(response.success, true);
    }

    assert.equal(calls.length, 12);
    for (const call of calls) {
      assert.match(
        call.sql,
        /LOWER\(TRIM\(cm\.Department\)\) = LOWER\(TRIM\(\$\d+\)\)/,
      );
      assert.equal(call.values.includes("Engineering"), true);
      assert.equal(call.values[0], 20);
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("Finance HOD receives organization-wide FC list filters", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    for (const Status of [null, "Pending", "Approved", "Rejected", "Hold", "Returned"]) {
      const response = await OpexService.getAllOpex({
        OrganizationID: 20,
        UserType: "hod",
        DepartmentName: "  finance  ",
        Status,
        page: 1,
        PageSize: 10,
      });
      assert.equal(response.success, true);
    }

    assert.equal(calls.length, 12);
    for (const call of calls) {
      assert.doesNotMatch(call.sql, /AND LOWER\(TRIM\(cm\.Department\)\)/);
      assert.equal(call.values.includes("finance"), false);
      assert.equal(call.values.includes("HOD"), false);
    }
    assert.equal(calls.some((call) => call.values.includes("FC")), true);
    assert.equal(calls.some((call) => /approval_state\.FCStatus/.test(call.sql)), true);
  } finally {
    pool.query = originalQuery;
  }
});

test("Finance HOD receives organization-wide FC summary", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [summaryRow] };
  };

  try {
    const response = await OpexService.getOpexSummaryReport({
      Filters: { OrganizationID: 20 },
      UserType: " HOD ",
      DepartmentName: " finance ",
    });

    assert.equal(response.success, true);
    assert.deepEqual(call.values, [20, "FC", null]);
  } finally {
    pool.query = originalQuery;
  }
});

test("Finance HOD OPEX PDF reuses FC list visibility and returns a valid PDF", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const response = await OpexService.generateOpexListPdf({
      OrganizationID: 20,
      UserType: "HOD",
      DepartmentName: " Finance ",
      Status: "Pending",
    });

    assert.equal(response.success, true);
    assert.equal(Buffer.isBuffer(response.data), true);
    assert.equal(response.data.subarray(0, 4).toString(), "%PDF");
    assert.equal(calls.some((call) => call.values?.includes("FC")), true);
    assert.equal(calls.some((call) => call.values?.includes("Finance")), false);
  } finally {
    pool.query = originalQuery;
  }
});

test("HOD without JWT department is forbidden before querying", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let queried = false;
  pool.query = async () => {
    queried = true;
    return { rows: [] };
  };

  try {
    const response = await OpexService.getAllOpex({
      OrganizationID: 20,
      UserType: "HOD",
      DepartmentName: " ",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, false);
    assert.equal(response.statusCode, 403);
    assert.equal(queried, false);
  } finally {
    pool.query = originalQuery;
  }
});

test("non-HOD OPEX list behavior remains department-unrestricted", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const response = await OpexService.getAllOpex({
      OrganizationID: 20,
      UserType: "USER",
      DepartmentName: "Finance",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, true);
    assert.equal(calls.length, 2);
    assert.equal(calls.some((call) => /LOWER\(TRIM\(cm\.Department\)\)/.test(call.sql)), false);
    assert.equal(calls.some((call) => call.values.includes("Finance")), false);
  } finally {
    pool.query = originalQuery;
  }
});

test("OPEX controller reads DepartmentName only from JWT context", () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, "../../controllers/OpexController/OpexController.js"),
    "utf8",
  );
  assert.match(
    controllerSource,
    /DepartmentName: String\(req\.user\?\.DepartmentName \|\| ""\)\.trim\(\)/,
  );

  const listHandler = controllerSource.match(
    /exports\.getAllOpex[\s\S]*?\/\/ =+ Get Opex By ID/,
  )[0];
  assert.doesNotMatch(listHandler, /req\.(query|body).*DepartmentName/);
  assert.match(listHandler, /STATUS_CODES\.FORBIDDEN/);

  const approvalHandler = controllerSource.match(
    /exports\.approveOpex[\s\S]*?\/\/ =+ Report Helpers/,
  )[0];
  assert.match(approvalHandler, /DepartmentName: user\.DepartmentName/);
  assert.doesNotMatch(approvalHandler, /req\.(query|body).*DepartmentName/);
});
