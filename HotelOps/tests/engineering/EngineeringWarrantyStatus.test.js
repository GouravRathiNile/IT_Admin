const test = require("node:test");
const assert = require("node:assert/strict");

const EngineeringService = require("../../services/EngineeringService/EngineeringService");
const { kolkataDateTime, warrantyStatusSchedule, runEngineeringWarrantyStatusJob } =
  require("../../services/EngineeringService/EngineeringWarrantyStatusJob");

const equipment = (id, endDate, status = "Under Warranty", isDeleted = false) => ({
  equipmentid: id, warrantyenddate: endDate, warrantystatus: status, isdeleted: isDeleted,
});

const statusPool = (rows, { failUpdate = false } = {}) => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [] };
      if (/SELECT\s+COUNT\(\*\) FILTER/i.test(sql)) {
        const today = params[0];
        const active = rows.filter((row) => !row.isdeleted);
        return { rows: [{
          candidates: active.filter((row) => row.warrantyenddate && row.warrantyenddate < today &&
            String(row.warrantystatus || "").trim().toUpperCase() !== "EXPIRED").length,
          alreadyexpired: active.filter((row) => row.warrantyenddate && row.warrantyenddate < today &&
            String(row.warrantystatus || "").trim().toUpperCase() === "EXPIRED").length,
          skipped: active.filter((row) => !row.warrantyenddate || row.warrantyenddate >= today).length,
        }] };
      }
      if (/UPDATE Engineering_Equipment_Entry_Master/i.test(sql)) {
        if (failUpdate) throw new Error("database unavailable");
        const [today, status] = params;
        const updated = rows.filter((row) => !row.isdeleted && row.warrantyenddate < today &&
          String(row.warrantystatus || "").trim().toUpperCase() !== "EXPIRED");
        updated.forEach((row) => { row.warrantystatus = status; });
        return { rows: updated.map((row) => ({ equipmentid: row.equipmentid })) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  return { connect: async () => client, queries };
};

test("expired yesterday becomes Expired", async () => {
  const rows = [equipment(1, "2026-09-17")];
  const result = await EngineeringService.processWarrantyStatusUpdates({
    businessDate: "2026-09-18", poolOverride: statusPool(rows),
  });
  assert.equal(rows[0].warrantystatus, "Expired");
  assert.deepEqual({ candidates: result.candidates, updated: result.updated, failed: result.failed },
    { candidates: 1, updated: 1, failed: 0 });
});

test("end date today and future dates remain valid", async () => {
  const rows = [equipment(1, "2026-09-18"), equipment(2, "2026-09-19")];
  const result = await EngineeringService.processWarrantyStatusUpdates({
    businessDate: "2026-09-18", poolOverride: statusPool(rows),
  });
  assert.deepEqual(rows.map((row) => row.warrantystatus), ["Under Warranty", "Under Warranty"]);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 2);
});

test("already Expired and deleted equipment are not unnecessarily updated", async () => {
  const rows = [equipment(1, "2026-09-17", "Expired"),
    equipment(2, "2026-09-17", "Under Warranty", true)];
  const result = await EngineeringService.processWarrantyStatusUpdates({
    businessDate: "2026-09-18", poolOverride: statusPool(rows),
  });
  assert.equal(result.alreadyExpired, 1);
  assert.equal(result.candidates, 0);
  assert.equal(result.updated, 0);
  assert.equal(rows[1].warrantystatus, "Under Warranty");
});

test("database failure rolls back and returns an isolated failure result", async () => {
  const rows = [equipment(1, "2026-09-17")];
  const database = statusPool(rows, { failUpdate: true });
  const result = await EngineeringService.processWarrantyStatusUpdates({
    businessDate: "2026-09-18", poolOverride: database,
  });
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 0);
  assert.ok(database.queries.some((sql) => /^ROLLBACK$/i.test(sql)));
});

test("job derives the India business date and uses its dedicated advisory lock", async () => {
  assert.equal(kolkataDateTime(new Date("2026-09-17T18:30:00.000Z")).date, "2026-09-18");
  const queries = [];
  let receivedDate;
  const poolOverride = { connect: async () => ({
    query: async (sql) => { queries.push(sql); return { rows: [{ locked: true }] }; },
    release() {},
  }) };
  const result = await runEngineeringWarrantyStatusJob({ poolOverride,
    now: new Date("2026-09-17T18:30:00.000Z"),
    service: { processWarrantyStatusUpdates: async ({ businessDate }) => {
      receivedDate = businessDate;
      return { candidates: 1, updated: 1, alreadyExpired: 0, skipped: 0, failed: 0 };
    } },
  });
  assert.equal(receivedDate, "2026-09-18");
  assert.equal(result.updated, 1);
  assert.match(queries[0], /pg_try_advisory_lock/);
  assert.match(queries[1], /pg_advisory_unlock/);
});

test("warranty status scheduler defaults to 08:00 and accepts valid configuration", () => {
  const previousHour = process.env.ENGINEERING_WARRANTY_STATUS_JOB_HOUR;
  const previousMinute = process.env.ENGINEERING_WARRANTY_STATUS_JOB_MINUTE;
  try {
    delete process.env.ENGINEERING_WARRANTY_STATUS_JOB_HOUR;
    delete process.env.ENGINEERING_WARRANTY_STATUS_JOB_MINUTE;
    assert.deepEqual(warrantyStatusSchedule(), { hour: 8, minute: 0 });
    process.env.ENGINEERING_WARRANTY_STATUS_JOB_HOUR = "7";
    process.env.ENGINEERING_WARRANTY_STATUS_JOB_MINUTE = "30";
    assert.deepEqual(warrantyStatusSchedule(), { hour: 7, minute: 30 });
  } finally {
    if (previousHour === undefined) delete process.env.ENGINEERING_WARRANTY_STATUS_JOB_HOUR;
    else process.env.ENGINEERING_WARRANTY_STATUS_JOB_HOUR = previousHour;
    if (previousMinute === undefined) delete process.env.ENGINEERING_WARRANTY_STATUS_JOB_MINUTE;
    else process.env.ENGINEERING_WARRANTY_STATUS_JOB_MINUTE = previousMinute;
  }
});
