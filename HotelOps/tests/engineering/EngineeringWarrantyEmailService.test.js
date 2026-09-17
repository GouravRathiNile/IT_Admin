const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWarrantyEmail, processEngineeringWarrantyEmails } =
  require("../../services/EngineeringService/EngineeringWarrantyEmailService");

const equipment = (id, organizationid, date, status = "Under Warranty") => ({
  equipmentid: id, organizationid, equipmentname: `Equipment ${id}`,
  serialnumber: `SER-${id}`, make: "Make", modelnumber: "Model", area: "Plant Room",
  warrantystartdate: "2025-09-16", warrantyenddate: date, warrantystatus: status,
  warrantycategory: date === "2026-09-15" && status.toUpperCase() === "EXPIRED"
    ? "EXPIRED" : "TODAY",
  organizationname: `Hotel ${organizationid}`,
});
const queryable = (rows, recipients, deliveries = []) => ({ query: async (sql) => {
  if (/CREATE TABLE/i.test(sql)) return { rows: [] };
  if (/FROM Engineering_Equipment_Entry_Master/i.test(sql)) return { rows };
  if (/FROM user_master/i.test(sql)) return { rows: recipients };
  if (/SELECT EmailType/i.test(sql)) return { rows: deliveries };
  if (/INSERT INTO Engineering_Email_Delivery_Log/i.test(sql)) return { rows: [] };
  throw new Error(`Unexpected query: ${sql}`);
} });

test("TODAY equipment is combined into one organization email", async () => {
  const sent = [];
  const result = await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: queryable([equipment(1, 20, "2026-09-16"), equipment(2, 20, "2026-09-16")],
      [{ organizationid: 20, email: "hod@example.com" }]),
    deliverEmail: async (...args) => sent.push(args) });
  assert.equal(result.sent, 1);
  assert.match(sent[0][1], /Today's Warranty - Hotel 20/);
  assert.match(sent[0][3], /Equipment 1/);
  assert.match(sent[0][3], /Equipment 2/);
});

test("EXPIRED equipment creates a separate action-pending email", async () => {
  const sent = [];
  await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: queryable([equipment(1, 20, "2026-09-15", "EXPIRED")],
      [{ organizationid: 20, email: "hod@example.com" }]),
    deliverEmail: async (...args) => sent.push(args) });
  assert.equal(sent.length, 1);
  assert.match(sent[0][1], /Expired Warranty - Action Pending/);
  assert.match(sent[0][3], /have expired and require action/);
});

test("TODAY and EXPIRED produce two category emails for one organization", async () => {
  const subjects = [];
  await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: queryable([equipment(1, 20, "2026-09-16"),
      equipment(2, 20, "2026-09-15", "Expired")],
    [{ organizationid: 20, email: "hod@example.com" }]),
    deliverEmail: async (_to, subject) => subjects.push(subject) });
  assert.equal(subjects.length, 2);
  assert.match(subjects[0], /Today's Warranty/);
  assert.match(subjects[1], /Expired Warranty/);
});

test("recipient emails are organization-scoped and deduplicated", async () => {
  const recipients = [];
  await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: queryable([equipment(1, 20, "2026-09-16"), equipment(2, 21, "2026-09-16")], [
      { organizationid: 20, email: "hod@example.com" },
      { organizationid: 20, email: "HOD@example.com" },
      { organizationid: 21, email: "other@example.com" }]),
    deliverEmail: async (email, _subject, text) => recipients.push({ email, text }) });
  assert.deepEqual(recipients.map((item) => item.email), ["hod@example.com", "other@example.com"]);
  assert.match(recipients[0].text, /Equipment 1/);
  assert.doesNotMatch(recipients[0].text, /Equipment 2/);
});

test("no data or no eligible recipient sends no email", async () => {
  const empty = await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: queryable([], []), deliverEmail: async () => assert.fail("must not send") });
  assert.equal(empty.sent, 0);
  const noHod = await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: queryable([equipment(1, 20, "2026-09-16")], []),
    deliverEmail: async () => assert.fail("must not send") });
  assert.equal(noHod.sent, 0);
});

test("one recipient failure is isolated from remaining recipients", async () => {
  const attempted = [];
  const result = await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: queryable([equipment(1, 20, "2026-09-16")], [
      { organizationid: 20, email: "bad@example.com" },
      { organizationid: 20, email: "good@example.com" }]),
    deliverEmail: async (email) => { attempted.push(email); if (email.startsWith("bad")) throw new Error("failed"); } });
  assert.deepEqual(attempted, ["bad@example.com", "good@example.com"]);
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 1);
});

test("business date query uses today and yesterday and HTML values are escaped", async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  await processEngineeringWarrantyEmails({ businessDate: "2026-09-16", queryable: db });
  const equipmentCall = calls.find((call) => /FROM Engineering_Equipment_Entry_Master/i.test(call.sql));
  assert.deepEqual(equipmentCall.params, ["2026-09-16", "2026-09-15"]);
  const email = buildWarrantyEmail({ organizationName: "Hotel",
    logoUrl: "https://assets.example.com/hotel-logo.png", warrantyDate: "2026-09-16",
    expired: false, rows: [{ ...equipment(1, 20, "2026-09-16"), equipmentname: "<script>bad</script>" }] });
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /https:\/\/assets\.example\.com\/hotel-logo\.png/);
  assert.match(email.html, /Dear Sir\/Madam,/);
  assert.match(email.text, /Dear Sir\/Madam,/);
  for (const label of ["Equipment", "Serial Number", "Make / Model", "Area", "Warranty From", "Warranty To", "Warranty Status"])
    assert.match(email.html, new RegExp(label.replace("/", "\\/")));
});

test("successful delivery is skipped after an application restart", async () => {
  const sent = [];
  const db = queryable([equipment(1, 20, "2026-09-16")],
    [{ organizationid: 20, email: "hod@example.com" }],
    [{ emailtype: "WARRANTY_TODAY", organizationid: 20, recipientemail: "hod@example.com" }]);
  const result = await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: db, deliverEmail: async (...args) => sent.push(args) });
  assert.equal(sent.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 2);
});

test("failed delivery is not marked and remains retryable", async () => {
  const queries = [];
  const base = queryable([equipment(1, 20, "2026-09-16")],
    [{ organizationid: 20, email: "hod@example.com" }]);
  const db = { query: async (sql, params) => {
    queries.push({ sql, params });
    return base.query(sql, params);
  } };
  const result = await processEngineeringWarrantyEmails({ businessDate: "2026-09-16",
    queryable: db, deliverEmail: async () => { throw new Error("SMTP unavailable"); } });
  assert.equal(result.failed, 1);
  assert.equal(queries.some((call) => /INSERT INTO Engineering_Email_Delivery_Log/i.test(call.sql)), false);
});
