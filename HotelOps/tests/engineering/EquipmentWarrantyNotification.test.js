const test = require("node:test");
const assert = require("node:assert/strict");

const EngineeringService = require("../../services/EngineeringService/EngineeringService");
const { kolkataDateTime, runEngineeringWarrantyNotificationJob } =
  require("../../services/EngineeringService/EngineeringWarrantyNotificationJob");

const equipment = (id, organizationId, event, endDate, extra = {}) => ({
  equipmentid: id, organizationid: organizationId, description: `Equipment ${id}`,
  serialnumber: `SER-${id}`, area: "Plant room", warrantyenddate: endDate,
  warrantyevent: event, ...extra,
});

const queryable = ({ equipments = [], hods = [], existing = [] } = {}) => {
  let call = 0;
  return { query: async () => ({ rows: [equipments, hods, existing][call++] || [] }) };
};

test("sends exact tomorrow, today and expired events to same-organization Engineering HODs", async () => {
  const sent = [];
  const db = queryable({
    equipments: [equipment(1, 20, "TOMORROW", "2026-09-17"),
      equipment(2, 20, "TODAY", "2026-09-16"),
      equipment(3, 21, "EXPIRED", "2026-09-15")],
    hods: [{ userid: 6, organizationid: 20 }, { userid: 6, organizationid: 20 },
      { userid: 9, organizationid: 21 }],
  });
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16", queryable: db,
    publishNotification: async (data) => { sent.push(data); return { success: true }; },
  });
  assert.equal(result.sent, 3);
  assert.deepEqual(sent.map((item) => item.title), ["Equipment Warranty Expiring Tomorrow",
    "Equipment Warranty Expiring Today", "Equipment Warranty Expired - Take Action"]);
  assert.deepEqual(sent[0].userIds, [6]);
  assert.deepEqual(sent[2].userIds, [9]);
  assert.deepEqual(sent.map((item) => item.action), ["WARRANTY_EXPIRING_TOMORROW",
    "WARRANTY_EXPIRING_TODAY", "WARRANTY_EXPIRED"]);
  assert.ok(sent.every((item) => item.moduleName === "Engineering" && item.entityType === "Equipment"));
});

test("skips duplicate events and organizations without an eligible HOD", async () => {
  const sent = [];
  const db = queryable({ equipments: [equipment(1, 20, "TODAY", "2026-09-16"),
    equipment(2, 99, "TODAY", "2026-09-16")],
  hods: [{ userid: 6, organizationid: 20 }],
  existing: [{ entity_id: "1", action: "WARRANTY_EXPIRING_TODAY" }] });
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16", queryable: db,
    publishNotification: async (data) => { sent.push(data); return { success: true }; },
  });
  assert.equal(result.skipped, 2);
  assert.equal(sent.length, 0);
});

test("an invalid business date is rejected and an empty candidate batch is safe", async () => {
  await assert.rejects(() => EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "invalid", queryable: queryable(), publishNotification: async () => ({ success: true }),
  }), /valid warranty notification business date/);
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16", queryable: queryable(),
  });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

test("candidate and recipient SQL enforce warranty dates and active same-organization Engineering HODs", async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) return { rows: [equipment(1, 20, "TODAY", "2026-09-16")] };
    if (calls.length === 2) return { rows: [] };
    return { rows: [] };
  } };
  await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16", queryable: db,
  });
  assert.deepEqual(calls[0].params, ["2026-09-17", "2026-09-16", "2026-09-15"]);
  assert.match(calls[0].sql, /WarrantyEndDate IN/);
  assert.match(calls[0].sql, /WarrantyStatus[\s\S]*'EXPIRED'/);
  assert.match(calls[1].sql, /DepartmentName\)\) = 'ENGINEERING'/);
  assert.match(calls[1].sql, /um\.IsActive = TRUE[\s\S]*um\.IsDeleted = FALSE[\s\S]*um\.IsLocked = FALSE/);
  assert.match(calls[1].sql, /uom\.OrganizationID = ANY/);
});

test("one notification failure is isolated and remaining equipment continues", async () => {
  let calls = 0;
  const db = queryable({ equipments: [equipment(1, 20, "TODAY", "2026-09-16"),
    equipment(2, 20, "TODAY", "2026-09-16")], hods: [{ userid: 6, organizationid: 20 }] });
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16", queryable: db,
    publishNotification: async () => { calls += 1; return calls === 1
      ? { success: false, message: "temporary failure" } : { success: true }; },
  });
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 1);
  assert.equal(calls, 2);
});

test("job uses Asia/Kolkata date and skips when advisory lock is held", async () => {
  assert.equal(kolkataDateTime(new Date("2026-09-15T19:00:00.000Z")).date, "2026-09-16");
  let released = false;
  const poolOverride = { connect: async () => ({
    query: async () => ({ rows: [{ locked: false }] }), release: () => { released = true; },
  }) };
  let processed = false;
  const result = await runEngineeringWarrantyNotificationJob({ poolOverride,
    service: { processEquipmentWarrantyNotifications: async () => { processed = true; } } });
  assert.deepEqual(result, { skipped: true, reason: "already-running" });
  assert.equal(processed, false);
  assert.equal(released, true);
});

test("job releases an acquired advisory lock after processing", async () => {
  const queries = [];
  const poolOverride = { connect: async () => ({ query: async (sql) => {
    queries.push(sql); return { rows: [{ locked: true }] };
  }, release() {} }) };
  const result = await runEngineeringWarrantyNotificationJob({ poolOverride,
    now: new Date("2026-09-16T02:30:00.000Z"),
    service: { processEquipmentWarrantyNotifications: async ({ businessDate }) =>
      ({ businessDate, sent: 2 }) } });
  assert.equal(result.businessDate, "2026-09-16");
  assert.equal(result.sent, 2);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /pg_advisory_unlock/);
});
