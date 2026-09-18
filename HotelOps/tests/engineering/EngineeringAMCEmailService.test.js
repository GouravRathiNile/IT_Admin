const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAMCEmail, processEngineeringAMCEmails } =
  require("../../services/EngineeringService/EngineeringAMCEmailService");

const row = (id, organizationid = 20) => ({ amcid: id, organizationid,
  equipmentname: `<Pump ${id}>`, serialnumber: `S-${id}`, make: "Make", modelnumber: "M1",
  area: "Plant", amctype: "Full", amcstartdate: "2025-09-17",
  amcenddate: "2026-09-17", amcstatus: "Active", amcamount: 12000,
  vendorname: "Vendor & Co", organizationname: "Hotel & Spa" });

const emailDb = (delivered = []) => ({ query: async (sql) => {
  if (/CREATE TABLE/i.test(sql)) return { rows: [] };
  if (/SELECT OrganizationID/i.test(sql)) return { rows: delivered };
  if (/INSERT INTO Engineering_Email_Delivery_Log/i.test(sql)) return { rows: [] };
  throw new Error(`Unexpected query: ${sql}`);
} });

test("AMC email contains complete escaped table and plain-text fallback", () => {
  const message = buildAMCEmail({ organizationName: "Hotel & Spa", businessDate: "2026-09-17",
    rows: [row(1)] });
  assert.match(message.subject, /AMC Expiring Today/);
  assert.match(message.html, /&lt;Pump 1&gt;/);
  assert.match(message.html, /Vendor &amp; Co/);
  assert.match(message.html, /Yearly Expense/);
  assert.match(message.text, /Dear Sir\/Madam/);
  assert.match(message.html, /href="http:\/\/localhost:5173\/Hotelops\/Pages\/AMCRenewal\/Pages\/List"[^>]*>View AMC<\/a>/);
  assert.match(message.text, /View AMC: http:\/\/localhost:5173\/Hotelops\/Pages\/AMCRenewal\/Pages\/List/);
});

test("AMC email deduplicates recipients and writes persistent delivery markers", async () => {
  const sent = [];
  const result = await processEngineeringAMCEmails({ businessDate: "2026-09-17",
    amcRows: [row(1), row(2)], recipientRows: [{ organizationid: 20, email: "HOD@Hotel.com" },
      { organizationid: 20, email: "hod@hotel.com" }, { organizationid: 20, email: "" }],
    queryable: emailDb(), deliverEmail: async (...args) => sent.push(args) });
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
});

test("AMC email skips prior delivery and isolates recipient failure", async () => {
  const skipped = await processEngineeringAMCEmails({ businessDate: "2026-09-17",
    amcRows: [row(1)], recipientRows: [{ organizationid: 20, email: "hod@hotel.com" }],
    queryable: emailDb([{ organizationid: 20, recipientemail: "hod@hotel.com" }]),
    deliverEmail: async () => assert.fail("must not deliver") });
  assert.equal(skipped.skipped, 1);
  const failed = await processEngineeringAMCEmails({ businessDate: "2026-09-17",
    amcRows: [row(1)], recipientRows: [{ organizationid: 20, email: "one@hotel.com" },
      { organizationid: 20, email: "two@hotel.com" }], queryable: emailDb(),
    deliverEmail: async (email) => { if (email === "one@hotel.com") throw new Error("SMTP down"); } });
  assert.equal(failed.failed, 1);
  assert.equal(failed.sent, 1);
});

test("AMC email no-data result does not touch database", async () => {
  const result = await processEngineeringAMCEmails({ businessDate: "2026-09-17",
    amcRows: [], queryable: { query: async () => assert.fail("must not query") } });
  assert.deepEqual(result, { records: 0, organizations: 0, sent: 0, skipped: 0, failed: 0 });
});
