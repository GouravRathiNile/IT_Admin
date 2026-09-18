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

test("all three warranty event types create three separate notifications", async () => {
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
  assert.ok(sent.every((item) => item.title === "Equipment Warranty Summary"));
  assert.deepEqual(sent[0].userIds, [6]);
  assert.deepEqual(sent[2].userIds, [9]);
  assert.deepEqual(sent.map((item) => item.action), ["WARRANTY_EXPIRING_TOMORROW",
    "WARRANTY_EXPIRING_TODAY", "WARRANTY_EXPIRED"]);
  assert.ok(sent.every((item) => item.moduleName === "Engineering" &&
    item.entityType === "EquipmentWarrantySummary"));
});

const runEventScenario = async (equipments) => {
  const sent = [];
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16",
    queryable: queryable({ equipments, hods: [{ userid: 6, organizationid: 20 }] }),
    publishNotification: async (data) => { sent.push(data); return { success: true }; },
  });
  return { result, sent };
};

test("only TODAY creates one today notification", async () => {
  const { result, sent } = await runEventScenario([equipment(1, 20, "TODAY", "2026-09-16")]);
  assert.equal(result.sent, 1);
  assert.equal(sent[0].action, "WARRANTY_EXPIRING_TODAY");
  assert.match(sent[0].message, /^One Warranty Expires Today\./);
});

test("17-Sep TODAY displays 17-Sep and 16-Sep expired stays in EXPIRED", async () => {
  const sent = [];
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-17",
    queryable: queryable({ equipments: [
      equipment(1, 20, "TODAY", "2026-09-17"),
      equipment(2, 20, "EXPIRED", "2026-09-16"),
    ], hods: [{ userid: 6, organizationid: 20 }] }),
    publishNotification: async (data) => { sent.push(data); return { success: true }; },
  });
  assert.equal(result.sent, 2);
  const today = sent.find((item) => item.action === "WARRANTY_EXPIRING_TODAY");
  const expired = sent.find((item) => item.action === "WARRANTY_EXPIRED");
  assert.match(today.message, /Warranty End Date: 2026-09-17/);
  assert.doesNotMatch(today.message, /2026-09-16/);
  assert.match(expired.message, /Warranty End Date: 2026-09-16/);
});

test("only EXPIRED creates one expired notification", async () => {
  const { result, sent } = await runEventScenario([equipment(1, 20, "EXPIRED", "2026-09-15")]);
  assert.equal(result.sent, 1);
  assert.equal(sent[0].action, "WARRANTY_EXPIRED");
  assert.match(sent[0].message, /^One Warranty has Expired and Require Action\./);
});

test("TOMORROW and TODAY create two separate notifications", async () => {
  const { result, sent } = await runEventScenario([equipment(1, 20, "TOMORROW", "2026-09-17"),
    equipment(2, 20, "TODAY", "2026-09-16")]);
  assert.equal(result.sent, 2);
  assert.deepEqual(sent.map((item) => item.action),
    ["WARRANTY_EXPIRING_TOMORROW", "WARRANTY_EXPIRING_TODAY"]);
});

test("skips duplicate events and organizations without an eligible HOD", async () => {
  const sent = [];
  const db = queryable({ equipments: [equipment(1, 20, "TODAY", "2026-09-16"),
    equipment(2, 99, "TODAY", "2026-09-16")],
  hods: [{ userid: 6, organizationid: 20 }],
  existing: [{ organization_id: 20, entity_id: "2026-09-16", action: "WARRANTY_EXPIRING_TODAY" }] });
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16", queryable: db,
    publishNotification: async (data) => { sent.push(data); return { success: true }; },
  });
  assert.equal(result.skipped, 2);
  assert.equal(sent.length, 0);
});

test("same organization event and business date creates only one notification", async () => {
  const sent = [];
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-17",
    queryable: queryable({ equipments: [equipment(1, 20, "TODAY", "2026-09-17"),
      equipment(2, 20, "TODAY", "2026-09-17")],
    hods: [{ userid: 6, organizationid: 20 }] }),
    publishNotification: async (data) => { sent.push(data); return { success: true }; },
  });
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].entityId, "2026-09-17");
  assert.equal(sent[0].action, "WARRANTY_EXPIRING_TODAY");
});

test("legacy daily summary prevents a duplicate during rolling deployment", async () => {
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-17",
    queryable: queryable({ equipments: [equipment(1, 20, "TODAY", "2026-09-17")],
      hods: [{ userid: 6, organizationid: 20 }],
      existing: [{ organization_id: 20, entity_id: "2026-09-17",
        action: "WARRANTY_DAILY_SUMMARY" }] }),
    publishNotification: async () => assert.fail("must not publish"),
  });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
});

test("an invalid business date is rejected and an empty candidate batch is safe", async () => {
  await assert.rejects(() => EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "invalid", queryable: queryable(), publishNotification: async () => ({ success: true }),
  }), /valid warranty notification business date/);
  const result = await EngineeringService.processEquipmentWarrantyNotifications({
    businessDate: "2026-09-16", queryable: queryable(),
  });
  assert.deepEqual(result, { candidates: 0, organizations: 0, sent: 0, skipped: 0, failed: 0 });
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
  assert.match(calls[0].sql, /WarrantyEndDate::date IN/);
  assert.match(calls[0].sql, /TO_CHAR\(e\.WarrantyEndDate, 'YYYY-MM-DD'\)/);
  assert.match(calls[0].sql, /WarrantyStatus[\s\S]*'EXPIRED'/);
  assert.match(calls[1].sql, /DepartmentName\)\) = 'ENGINEERING'/);
  assert.match(calls[1].sql, /um\.IsActive = TRUE[\s\S]*um\.IsDeleted = FALSE[\s\S]*um\.IsLocked = FALSE/);
  assert.match(calls[1].sql, /uom\.OrganizationID = ANY/);
  assert.equal(calls[2].params.length, 4);
  assert.doesNotMatch(calls[2].sql, /Created_At AT TIME ZONE/);
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
  assert.equal(result.sent, 0);
  assert.equal(calls, 1);
});

test("job uses Asia/Kolkata date and skips when advisory lock is held", async () => {
  assert.equal(kolkataDateTime(new Date("2026-09-15T19:00:00.000Z")).date, "2026-09-16");
  let released = false;
  const poolOverride = { connect: async () => ({
    query: async () => ({ rows: [{ locked: false }] }), release: () => { released = true; },
  }) };
  let processed = false;
  const result = await runEngineeringWarrantyNotificationJob({ poolOverride,
    service: { processEquipmentWarrantyNotifications: async () => { processed = true; } },
    warrantyEmailService: { processEngineeringWarrantyEmails: async () => ({ sent: 0 }) } });
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
      ({ businessDate, sent: 2 }) },
    warrantyEmailService: { processEngineeringWarrantyEmails: async () => ({ sent: 0 }) } });
  assert.equal(result.businessDate, "2026-09-16");
  assert.equal(result.sent, 2);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /pg_advisory_unlock/);
});
