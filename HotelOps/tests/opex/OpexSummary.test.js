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
    assert.deepEqual(call.values, [20, "RD-FC"]);
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
  assert.doesNotMatch(handler, /STATUS_CODES\.FORBIDDEN/);
});
