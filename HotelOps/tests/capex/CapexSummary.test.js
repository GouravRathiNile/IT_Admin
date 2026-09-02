const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pool } = require("../../db");
const CapexService = require("../../services/CapexService/CapexService");

test("CAPEX approval responses expose role-wise approved quantity", () => {
  const serviceSource = fs.readFileSync(
    path.join(__dirname, "../../services/CapexService/CapexService.js"),
    "utf8",
  );

  assert.match(serviceSource, /WHEN 'GM' THEN ca\.GMApprovedQuantity/);
  assert.match(serviceSource, /WHEN 'CEO' THEN ca\.CEOApprovedQuantity/);
  assert.match(serviceSource, /WHEN 'OWNER' THEN ca\.OwnerApprovedQuantity/);
  assert.match(serviceSource, /END AS ApprovedQuantity/);
  assert.match(serviceSource, /ApprovedQuantity:[\s\S]*Number\(row\.approvedquantity\)/);
});

test("CAPEX approval forwards and persists request Quantity", () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, "../../controllers/CapexController/CapexController.js"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.join(__dirname, "../../services/CapexService/CapexService.js"),
    "utf8",
  );

  const approvalController = controllerSource.match(
    /exports\.approveCapex[\s\S]*?\/\/ =+ Report Helpers/,
  )[0];
  assert.match(approvalController, /positiveNumber\(req\.body\.Quantity, "Quantity"\)/);
  assert.match(approvalController, /Remarks: remarks \|\| null,[\s\S]*Quantity,/);
  assert.match(serviceSource, /const approvedQuantity =[\s\S]*Number\(data\.Quantity\)/);
  assert.match(serviceSource, /"Approved",[\s\S]*approvedQuantity,/);
});

const summaryRow = {
  totalcapex: "6",
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

test("non-approval roles receive the organization-wide CAPEX summary", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [summaryRow] };
  };

  try {
    const hod = await CapexService.getCapexSummaryReport({
      Filters: { OrganizationID: 17 },
      UserType: " hod ",
    });
    const user = await CapexService.getCapexSummaryReport({
      Filters: { OrganizationID: 17 },
      UserType: "USER",
    });

    assert.equal(hod.success, true);
    assert.deepEqual(hod.data, user.data);
    assert.equal(hod.data.TotalCapex, 6);
    assert.equal(hod.data.HoldCount, 1);
    assert.deepEqual(calls.map((call) => call.values), [[17], [17]]);
    assert.match(calls[0].sql, /cm\.IsDeleted = FALSE/);
    assert.match(calls[0].sql, /ca\.FinalStatus/);
    assert.match(calls[0].sql, /cm\.IsVoid = TRUE THEN 'Void'/);
  } finally {
    pool.query = originalQuery;
  }
});

test("approval roles retain the role-scoped CAPEX query", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  let call;
  pool.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [summaryRow] };
  };

  try {
    const response = await CapexService.getCapexSummaryReport({
      Filters: { OrganizationID: 17 },
      UserType: "gm",
    });

    assert.equal(response.success, true);
    assert.deepEqual(call.values, [17, "GM"]);
    assert.match(call.sql, /CurrentApprovalRole = \$2/);
  } finally {
    pool.query = originalQuery;
  }
});

test("OrganizationID remains mandatory and the controller trusts JWT UserType", async () => {
  const response = await CapexService.getCapexSummaryReport({
    Filters: {},
    UserType: "USER",
  });
  assert.equal(response.success, false);
  assert.equal(response.statusCode, 400);

  const controllerSource = fs.readFileSync(
    path.join(__dirname, "../../controllers/CapexController/CapexController.js"),
    "utf8",
  );
  const summaryHandler = controllerSource.match(
    /exports\.getCapexSummaryReport[\s\S]*?\/\/ =+ Department Report/,
  )[0];

  assert.match(summaryHandler, /const UserType = user\.UserType\.toUpperCase\(\)/);
  assert.doesNotMatch(summaryHandler, /req\.(query|body).*UserType/);
  assert.doesNotMatch(summaryHandler, /STATUS_CODES\.FORBIDDEN/);
});

test("HOD Approved list uses the completed configured flow", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "1" }] }
      : { rows: [] };
  };

  try {
    const response = await CapexService.getAllCapex({
      OrganizationID: 20,
      UserType: "HOD",
      Status: "Approved",
      page: 1,
      PageSize: 10,
    });

    assert.equal(response.success, true);
    assert.equal(response.TotalCount, 1);
    assert.equal(calls.length, 2);

    for (const call of calls) {
      const statusFilter = call.sql.slice(call.sql.lastIndexOf("AND cm.OrganizationID"));
      assert.match(statusFilter, /approval_state\.FinalStatus/);
      assert.doesNotMatch(statusFilter, /approval_state\.OwnerStatus/);
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("CEO CAPEX list and count require GM approval for every status view", { concurrency: false }, async () => {
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
      const response = await CapexService.getAllCapex({
        OrganizationID: 20,
        UserType: "CEO",
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
        /UPPER\(COALESCE\(approval_state\.GMStatus, 'PENDING'\)\) = 'APPROVED'/,
      );
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("CAPEX list PDF reuses getAllCapex configured-flow visibility", { concurrency: false }, async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("SELECT COUNT(*) AS TotalCount")
      ? { rows: [{ totalcount: "0" }] }
      : { rows: [] };
  };

  try {
    const response = await CapexService.generateCapexListPdf({
      OrganizationID: 20,
      UserType: "HOD",
      Status: "Approved",
    });

    assert.equal(response.success, true);
    assert.equal(Buffer.isBuffer(response.data), true);
    assert.equal(response.data.subarray(0, 4).toString(), "%PDF");

    const executedCapexQueries = calls.filter((call) =>
      /FROM Capex_Master cm/.test(call.sql),
    );
    assert.equal(executedCapexQueries.length, 2);
    for (const call of executedCapexQueries) {
      assert.match(call.sql, /approval_state\.FinalStatus/);
      assert.match(
        call.sql,
        /COALESCE\(\s*approval_state\.FinalStatus,\s*'PENDING'\s*\)\s*\) = 'APPROVED'/,
      );
    }
  } finally {
    pool.query = originalQuery;
  }
});
