const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../services/EngineeringService/EngineeringService.js"), "utf8");
const start = source.indexOf("const updateBreakdown =");
const end = source.indexOf("const deleteBreakdown =", start);

async function run(Parts, DeletePartIDs = [], found = true) {
  const calls = [];
  let released = false;
  const client = {
    release() { released = true; },
    async query(sql, values) {
      calls.push({ sql, values: values && Array.from(values) });
      if (sql.includes("FOR UPDATE")) return { rows: [{ organizationid: 20 }] };
      if (sql.includes("RETURNING BreakdownPartID")) return { rows: found ? [{ breakdownpartid: 10 }] : [] };
      return { rows: [] };
    },
  };
  const context = { console, pool: { connect: async () => client }, breakdownUpdateFields: {},
    fail: (message, statusCode) => ({ success: false, message, statusCode }),
    ok: () => ({ success: true }), databaseFailure: (error) => { throw error; } };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\nthis.run = updateBreakdown;", context);
  const result = await context.run({ BreakdownID: 1, UserID: 3, Parts, DeletePartIDs });
  assert.equal(released, true);
  return { result, calls };
}

test("mixed parts update the identified part and insert only the new part", async () => {
  for (const key of ["Breakdownpartid", "BreakdownPartID"]) {
    const { result, calls } = await run([
      { [key]: 10, Item: "Breaker", Qty: 2, Amount: 2000 },
      { Item: "Breaker2", Qty: 1, Amount: 1500 },
    ]);
    assert.equal(result.success, true);
    const update = calls.find(({ sql }) => sql.includes("RETURNING BreakdownPartID"));
    assert.deepEqual(update.values, ["Breaker", 2, 2000, 10, 1, 20]);
    assert.match(update.sql, /BreakdownID = \$5/);
    assert.match(update.sql, /OrganizationID = \$6/);
    assert.match(update.sql, /IsDeleted = FALSE/);
    const inserts = calls.filter(({ sql }) => sql.includes("INSERT INTO Engineering_Breakdown_Parts_Details"));
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].values, [1, 20, "Breaker2", 1, 1500, 3]);
    assert.equal(calls.at(-1).sql, "COMMIT");
  }
});

test("invalid, unmatched or simultaneously deleted part IDs never insert replacements", async () => {
  for (const [id, deleted, found, status] of [[0, [], true, 400], ["bad", [], true, 400], [10, [], false, 404], [10, [10], true, 400]]) {
    const { result, calls } = await run([{ BreakdownPartID: id, Item: "Breaker", Qty: 2, Amount: 2000 }], deleted, found);
    assert.equal(result.statusCode, status);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.ok(!calls.some(({ sql }) => sql.includes("INSERT INTO")));
  }
});
