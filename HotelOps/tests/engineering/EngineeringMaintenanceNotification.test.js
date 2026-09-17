const test = require("node:test");
const assert = require("node:assert/strict");
const { isMaintenanceDue, processMaintenanceNotifications, kolkataDateTime,
  runEngineeringMaintenanceNotificationJob } =
  require("../../services/EngineeringService/EngineeringMaintenanceNotificationJob");

const row = (id, organizationid = 20, schedule = "Monthly", day = "17") => ({
  equipmentid: id, organizationid, equipmentname: `Equipment ${id}`, area: "Plant Room",
  scheduleofservicing: schedule, scheduleday: day, organizationname: `Hotel ${organizationid}` });

test("schedule rules and ScheduleDay are evaluated exactly", () => {
  assert.equal(isMaintenanceDue(row(1), "2026-09-17"), true);
  assert.equal(isMaintenanceDue(row(1, 20, "Bi-Monthly"), "2026-09-17"), true);
  assert.equal(isMaintenanceDue(row(1, 20, "Bi-Monthly"), "2026-10-17"), false);
  assert.equal(isMaintenanceDue(row(1, 20, "Quarterly"), "2026-10-17"), true);
  assert.equal(isMaintenanceDue(row(1, 20, "Six Monthly"), "2026-07-17"), true);
  assert.equal(isMaintenanceDue(row(1, 20, "Annual"), "2026-01-17"), true);
  assert.equal(isMaintenanceDue(row(1, 20, "Yearly"), "2026-02-17"), false);
  assert.equal(isMaintenanceDue(row(1, 20, "Monthly", "Day-16"), "2026-09-17"), false);
});

const notificationDb = (existing = []) => ({ query: async (sql) => {
  if (/FROM notifications/i.test(sql)) return { rows: existing };
  throw new Error(`Unexpected query: ${sql}`);
} });

test("groups by organization, deduplicates HODs, and includes details for three items", async () => {
  const payloads = [];
  const result = await processMaintenanceNotifications({ businessDate: "2026-09-17",
    dueItems: [row(1), row(2), row(3)], recipientRows: [
      { organizationid: 20, userid: 8 }, { organizationid: 20, userid: 8 },
      { organizationid: 20, userid: 9 }], queryable: notificationDb(),
    publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
  assert.equal(result.sent, 1);
  assert.deepEqual(payloads[0].userIds, ["8", "9"]);
  assert.equal(payloads[0].moduleName, "Engineering");
  assert.equal(payloads[0].action, "MAINTENANCE_DUE");
  assert.match(payloads[0].message, /Scheduled Equipment/);
});

test("more than three items produces count-only content", async () => {
  const payloads = [];
  await processMaintenanceNotifications({ businessDate: "2026-09-17",
    dueItems: [row(1), row(2), row(3), row(4)],
    recipientRows: [{ organizationid: 20, userid: 8 }], queryable: notificationDb(),
    publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
  assert.equal(payloads[0].message, "4 Maintenance Items Due Today.");
});

test("existing organization event and missing HOD safely skip", async () => {
  const existing = await processMaintenanceNotifications({ businessDate: "2026-09-17",
    dueItems: [row(1)], recipientRows: [{ organizationid: 20, userid: 8 }],
    queryable: notificationDb([{ organization_id: 20 }]),
    publishNotification: async () => assert.fail("must not publish") });
  assert.equal(existing.skipped, 1);
  const noHod = await processMaintenanceNotifications({ businessDate: "2026-09-17",
    dueItems: [row(1)], recipientRows: [], queryable: notificationDb(),
    publishNotification: async () => assert.fail("must not publish") });
  assert.equal(noHod.skipped, 1);
});

test("notification failure is isolated", async () => {
  const result = await processMaintenanceNotifications({ businessDate: "2026-09-17",
    dueItems: [row(1)], recipientRows: [{ organizationid: 20, userid: 8 }],
    queryable: notificationDb(), publishNotification: async () => { throw new Error("queue down"); } });
  assert.equal(result.failed, 1);
});

test("job uses India date, advisory lock, and releases it", async () => {
  assert.equal(kolkataDateTime(new Date("2026-09-16T19:00:00Z")).date, "2026-09-17");
  const lockQueries = [];
  const poolOverride = { connect: async () => ({ query: async (sql) => {
    lockQueries.push(sql); return { rows: [{ locked: true }] };
  }, release() {} }) };
  const queryable = { query: async (sql) => {
    if (/FROM Engineering_Equipment_Entry_Master/i.test(sql)) return { rows: [] };
    throw new Error("Unexpected query");
  } };
  const result = await runEngineeringMaintenanceNotificationJob({ poolOverride, queryable,
    now: new Date("2026-09-16T19:00:00Z"),
    emailService: { processEngineeringMaintenanceEmails: async () => ({ sent: 0 }) } });
  assert.equal(result.skipped, false);
  assert.match(lockQueries[1], /pg_advisory_unlock/);
});
