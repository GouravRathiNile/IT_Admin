const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMaintenanceEmail, processEngineeringMaintenanceEmails } =
  require("../../services/EngineeringService/EngineeringMaintenanceEmailService");

const item = (id, organizationid = 20) => ({ equipmentid: id, organizationid,
  equipmentname: `Equipment ${id}`, serialnumber: `SER-${id}`, make: "Make",
  modelnumber: "Model", area: "Plant Room", scheduleofservicing: "Monthly",
  scheduleday: "17", organizationname: `Hotel ${organizationid}` });
const db = (deliveries = []) => ({ query: async (sql) => {
  if (/SELECT OrganizationID/i.test(sql)) return { rows: deliveries };
  if (/INSERT INTO Engineering_Email_Delivery_Log/i.test(sql)) return { rows: [] };
  throw new Error(`Unexpected query: ${sql}`);
} });

test("combines every due item into one organization email", async () => {
  const sent = [];
  const result = await processEngineeringMaintenanceEmails({ businessDate: "2026-09-17",
    dueItems: [item(1), item(2)], recipientRows: [{ organizationid: 20, email: "hod@example.com" }],
    queryable: db(), deliverEmail: async (...args) => sent.push(args) });
  assert.equal(result.sent, 1);
  assert.match(sent[0][1], /Today's Scheduled Maintenance - Hotel 20/);
  assert.match(sent[0][3], /Equipment 1/);
  assert.match(sent[0][3], /Equipment 2/);
});

test("deduplicates recipient emails and keeps organizations separate", async () => {
  const sent = [];
  await processEngineeringMaintenanceEmails({ businessDate: "2026-09-17",
    dueItems: [item(1, 20), item(2, 21)], recipientRows: [
      { organizationid: 20, email: "HOD@example.com" },
      { organizationid: 20, email: "hod@example.com" },
      { organizationid: 21, email: "other@example.com" }], queryable: db(),
    deliverEmail: async (email, _subject, text) => sent.push({ email, text }) });
  assert.deepEqual(sent.map((entry) => entry.email), ["hod@example.com", "other@example.com"]);
  assert.doesNotMatch(sent[0].text, /Equipment 2/);
});

test("persistent delivery marker prevents restart duplicates", async () => {
  const sent = [];
  const result = await processEngineeringMaintenanceEmails({ businessDate: "2026-09-17",
    dueItems: [item(1)], recipientRows: [{ organizationid: 20, email: "hod@example.com" }],
    queryable: db([{ organizationid: 20, recipientemail: "hod@example.com" }]),
    deliverEmail: async (...args) => sent.push(args) });
  assert.equal(sent.length, 0);
  assert.equal(result.skipped, 1);
});

test("recipient failure is isolated and is not marked delivered", async () => {
  const inserts = [];
  const queryable = { query: async (sql, params) => {
    if (/SELECT OrganizationID/i.test(sql)) return { rows: [] };
    if (/INSERT INTO Engineering_Email_Delivery_Log/i.test(sql)) { inserts.push(params); return { rows: [] }; }
    throw new Error("Unexpected query");
  } };
  const result = await processEngineeringMaintenanceEmails({ businessDate: "2026-09-17",
    dueItems: [item(1)], recipientRows: [{ organizationid: 20, email: "bad@example.com" },
      { organizationid: 20, email: "good@example.com" }], queryable,
    deliverEmail: async (email) => { if (email.startsWith("bad")) throw new Error("SMTP failed"); } });
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][3], "good@example.com");
});

test("no due data or no HOD safely skips", async () => {
  const empty = await processEngineeringMaintenanceEmails({ businessDate: "2026-09-17",
    dueItems: [], deliverEmail: async () => assert.fail("must not send") });
  assert.equal(empty.sent, 0);
  const noHod = await processEngineeringMaintenanceEmails({ businessDate: "2026-09-17",
    dueItems: [item(1)], recipientRows: [], queryable: db(),
    deliverEmail: async () => assert.fail("must not send") });
  assert.equal(noHod.sent, 0);
});

test("template contains branding, required table columns, and escaped values", () => {
  const email = buildMaintenanceEmail({ organizationName: "Hotel", logoUrl: "https://logo.test/a.png",
    maintenanceDate: "2026-09-17", rows: [{ ...item(1), equipmentname: "<script>bad</script>" }] });
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /Dear Sir\/Madam/);
  assert.match(email.html, /https:\/\/logo\.test\/a\.png/);
  assert.match(email.html, /href="http:\/\/localhost:5173\/Hotelops\/Pages\/EngineeringModule\/Pages\/List"[^>]*>View Equipment<\/a>/);
  assert.match(email.text, /View Equipment: http:\/\/localhost:5173\/Hotelops\/Pages\/EngineeringModule\/Pages\/List/);
  for (const label of ["Equipment", "Serial Number", "Make / Model", "Area", "Schedule",
    "Schedule Day", "Maintenance / Task", "Assigned Engineer", "Status"])
    assert.match(email.html, new RegExp(label.replace("/", "\\/")));
});
