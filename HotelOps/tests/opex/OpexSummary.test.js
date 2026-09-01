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
      UserType: "gm",
    });

    assert.equal(response.success, true);
    assert.deepEqual(call.values, [20, "GM", null, false]);
    assert.match(call.sql, /CurrentApprovalRole = \$2/);
  } finally {
    pool.query = originalQuery;
  }
});

test("native RD-FC JWT users are forbidden", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let queried = false;
  pool.query = async () => {
    queried = true;
    return { rows: [] };
  };

  try {
    const list = await OpexService.getAllOpex({
      OrganizationID: 20,
      UserType: "RD-FC",
      page: 1,
      PageSize: 10,
    });
    const summary = await OpexService.getOpexSummaryReport({
      Filters: { OrganizationID: 20 },
      UserType: "RD-FC",
    });

    assert.equal(list.statusCode, 403);
    assert.equal(summary.statusCode, 403);
    assert.equal(queried, false);
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
    assert.deepEqual(call.values, [20, "HOD", "Engineering", false]);
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
    assert.deepEqual(call.values, [20, "FC", null, false]);
  } finally {
    pool.query = originalQuery;
  }
});

test("Organization 10 Finance HOD receives global RD-FC list and count", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/FROM user_org_mapping/.test(sql)) return { rows: [{ "?column?": 1 }] };
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const response = await OpexService.getAllOpex({
      UserID: 6,
      OrganizationID: 10,
      UserType: "HOD",
      DepartmentName: " finance ",
      Status: "Pending",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, true);
    assert.deepEqual(calls[0].values, [6, 10]);
    for (const call of calls.slice(1)) {
      assert.doesNotMatch(call.sql, /AND cm\.OrganizationID = \$\d+/);
      assert.equal(call.values.includes("RD-FC"), true);
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("Organization 10 Finance HOD mapping cannot be spoofed", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [] };
  };

  try {
    const response = await OpexService.getAllOpex({
      UserID: 99,
      OrganizationID: 10,
      UserType: "HOD",
      DepartmentName: "Finance",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.statusCode, 403);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /FROM user_org_mapping/);
  } finally {
    pool.query = originalQuery;
  }
});

test("Organization 10 Finance HOD receives global RD-FC summary", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return /FROM user_org_mapping/.test(sql)
      ? { rows: [{ "?column?": 1 }] }
      : { rows: [summaryRow] };
  };

  try {
    const response = await OpexService.getOpexSummaryReport({
      UserID: 6,
      Filters: { OrganizationID: 10 },
      OrganizationID: 10,
      UserType: "HOD",
      DepartmentName: "Finance",
    });

    assert.equal(response.success, true);
    assert.deepEqual(calls[1].values, [10, "RD-FC", null, true]);
    assert.match(calls[1].sql, /\$4::boolean = TRUE OR cm\.OrganizationID = \$1/);
  } finally {
    pool.query = originalQuery;
  }
});

test("central Finance HOD approves another organization's RD-FC stage", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const transactionCalls = [];

  pool.query = async (sql, values) => {
    assert.match(sql, /FROM user_org_mapping/);
    assert.deepEqual(values, [6, 10]);
    return { rows: [{ "?column?": 1 }] };
  };

  const client = {
    query: async (sql, values) => {
      transactionCalls.push({ sql, values });
      if (/FROM Opex_Master cm/.test(sql) && /FOR UPDATE OF cm/.test(sql)) {
        return { rows: [{ opexid: 501, opexnumber: 9, organizationid: 20, isvoid: false }] };
      }
      if (/FROM Opex_Approval_Config/.test(sql)) return { rows: [] };
      if (/FROM Opex_Approval/.test(sql) && /FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            opexapprovalid: 701,
            hodstatus: "Approved",
            fcstatus: "Approved",
            gmstatus: "Approved",
            rdfcstatus: "Pending",
            ceostatus: "Pending",
            finalstatus: "Pending",
          }],
        };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  pool.connect = async () => client;

  try {
    const response = await OpexService.processOpexApproval({
      OpexID: 501,
      Action: "APPROVE",
      UserID: 6,
      UserType: "HOD",
      DepartmentName: "Finance",
    });

    assert.equal(response.success, true);
    const rdfcUpdate = transactionCalls.find((call) => /RDFCStatus = \$1/.test(call.sql));
    assert.ok(rdfcUpdate);
    assert.deepEqual(rdfcUpdate.values, ["Approved", 6, null, null, 701]);
    assert.equal(transactionCalls.some((call) => /FinalStatus = NULL/.test(call.sql)), true);
    assert.equal(transactionCalls.some((call) => /^COMMIT$/i.test(call.sql.trim())), true);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
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

test("central Finance HOD PDF uses global RD-FC visibility", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/FROM user_org_mapping/.test(sql)) return { rows: [{ "?column?": 1 }] };
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const response = await OpexService.generateOpexListPdf({
      UserID: 6,
      OrganizationID: 10,
      UserType: "HOD",
      DepartmentName: "Finance",
      Status: "Pending",
    });

    assert.equal(response.success, true);
    assert.equal(response.data.subarray(0, 4).toString(), "%PDF");
    const listCalls = calls.filter((call) => /FROM Opex_Master cm/.test(call.sql));
    assert.equal(listCalls.some((call) => call.values?.includes("RD-FC")), true);
    assert.equal(listCalls.some((call) => /AND cm\.OrganizationID = \$\d+/.test(call.sql)), false);
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
