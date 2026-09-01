const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pool } = require("../../db");
const CapexService = require("../../services/CapexService/CapexService");

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
