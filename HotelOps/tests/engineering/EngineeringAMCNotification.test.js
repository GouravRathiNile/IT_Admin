const test = require("node:test");
const assert = require("node:assert/strict");
const AMCService = require("../../services/EngineeringService/EngineeringAMCService");
const { kolkataDateTime, runEngineeringAMCNotificationJob } =
  require("../../services/EngineeringService/EngineeringAMCNotificationJob");

const amc = (id, organizationid = 20) => ({ amcid: id, organizationid,
  equipmentid: id, equipmentname: `Equipment ${id}`, serialnumber: `SER-${id}`,
  area: "Plant Room", amcstartdate: "2025-09-17", amcenddate: "2026-09-17",
  amctype: "Comprehensive", organizationname: `Hotel ${organizationid}` });
const notificationDb = (existing = []) => ({ query: async (sql) => {
  if (/FROM notifications/i.test(sql)) return { rows: existing };
  throw new Error(`Unexpected query: ${sql}`);
} });

test("AMC expiry groups by organization, deduplicates HODs, and shows small-batch details", async () => {
  const payloads = [];
  const result = await AMCService.processAMCNotifications({ businessDate: "2026-09-17",
    amcRows: [amc(1), amc(2)], recipientRows: [{ organizationid: 20, userid: 8 },
      { organizationid: 20, userid: 8 }, { organizationid: 20, userid: 9 }],
    queryable: notificationDb(), publishNotification: async (payload) => {
      payloads.push(payload); return { success: true };
    } });
  assert.equal(result.sent, 1);
  assert.deepEqual(payloads[0].userIds, [8, 9]);
  assert.equal(payloads[0].action, "AMC_EXPIRING_TODAY");
  assert.equal(payloads[0].entityId, "2026-09-17");
  assert.match(payloads[0].message, /^Two AMCs Expire Today\./);
  assert.match(payloads[0].message, /Affected Equipment/);
});

test("more than three AMCs uses word count and count-only notification", async () => {
  const payloads = [];
  await AMCService.processAMCNotifications({ businessDate: "2026-09-17",
    amcRows: [amc(1), amc(2), amc(3), amc(4)],
    recipientRows: [{ organizationid: 20, userid: 8 }], queryable: notificationDb(),
    publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
  assert.equal(payloads[0].message, "Four AMCs Expire Today.");
});

test("existing AMC summary and missing HOD skip safely", async () => {
  const existing = await AMCService.processAMCNotifications({ businessDate: "2026-09-17",
    amcRows: [amc(1)], recipientRows: [{ organizationid: 20, userid: 8 }],
    queryable: notificationDb([{ organization_id: 20 }]),
    publishNotification: async () => assert.fail("must not publish") });
  assert.equal(existing.skipped, 1);
  const noHod = await AMCService.processAMCNotifications({ businessDate: "2026-09-17",
    amcRows: [amc(1)], recipientRows: [], queryable: notificationDb(),
    publishNotification: async () => assert.fail("must not publish") });
  assert.equal(noHod.skipped, 1);
});

test("AMC query uses master expiry date and active organization", async () => {
  const calls = [];
  await AMCService.resolveExpiringAMCs({ businessDate: "2026-09-17",
    queryable: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } } });
  assert.match(calls[0].sql, /FROM Engineering_AMC_Master am/);
  assert.match(calls[0].sql, /am\.AMCEndDate::date = \$1::date/);
  assert.match(calls[0].sql, /om\.IsActive = TRUE/);
  assert.deepEqual(calls[0].params, ["2026-09-17"]);
});

test("AMC notification failure is isolated", async () => {
  const result = await AMCService.processAMCNotifications({ businessDate: "2026-09-17",
    amcRows: [amc(1)], recipientRows: [{ organizationid: 20, userid: 8 }],
    queryable: notificationDb(), publishNotification: async () => { throw new Error("queue down"); } });
  assert.equal(result.failed, 1);
});

test("AMC job uses India date, advisory lock, and releases it", async () => {
  assert.equal(kolkataDateTime(new Date("2026-09-16T19:00:00Z")).date, "2026-09-17");
  const lockQueries = [];
  const poolOverride = { connect: async () => ({ query: async (sql) => {
    lockQueries.push(sql); return { rows: [{ locked: true }] };
  }, release() {} }) };
  const service = { resolveExpiringAMCs: async () => [], resolveAMCRecipients: async () => [],
    processAMCNotifications: async () => ({ sent: 0 }) };
  const result = await runEngineeringAMCNotificationJob({ poolOverride, service,
    emailService: { processEngineeringAMCEmails: async () => ({ sent: 0 }) },
    now: new Date("2026-09-16T19:00:00Z") });
  assert.equal(result.skipped, false);
  assert.match(lockQueries[1], /pg_advisory_unlock/);
});
