const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCreditApplicationEmail } = require("../../services/CreditApplicationService/CreditApplicationEmailTemplate");

test("Credit Application email contains professional details and no unverified CTA", () => {
  const email = buildCreditApplicationEmail({
    title: "Credit Application - A&B <Ltd> - HJU",
    message: "Credit application created and requires your action.",
    organizationName: "Hotel Udaipur",
    details: { companyName: "A&B <Ltd>", applicationDate: "2026-09-21",
      creditAmountAllowed: 50000, expectedBusinessFY: 200000,
      financialYear: "2026-27", authorisedPerson: "Director",
      accountsContact: "Accounts Manager" },
  });
  assert.equal(email.subject, "[HotelOps] Credit Application - A&B <Ltd> - HJU");
  assert.match(email.text, /Dear Sir\/Madam/);
  assert.match(email.html, /Credit Application Notification/);
  assert.match(email.html, /A&amp;B &lt;Ltd&gt;/);
  assert.match(email.html, /Credit Amount Allowed/);
  assert.doesNotMatch(email.html, /<a\s|VIEW CREDIT/i);
});
