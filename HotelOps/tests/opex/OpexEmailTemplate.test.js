const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOpexEmail } = require("../../services/OpexService/OpexEmailTemplate");

const base = {
  notificationTitle: "OPEX - Printer (2) - Finance - HJU",
  organizationName: "Howard Johnson Udaipur",
  logoUrl: "https://assets.example.com/hju.png",
  details: { entityId: "42/7", item: "Printer", department: "Finance", quantity: 2, rate: 100,
    total: 200, description: "Replacement printer", actionQuantity: 1,
    remark: "Reviewed", actionBy: "General Manager", actionDate: "2026-09-15T06:30:00.000Z" },
};

test("OPEX CREATE email has branding, one description, details and no action table", () => {
  const email = buildOpexEmail({ ...base, details: { ...base.details, kind: "CREATE" } });
  assert.equal(email.subject, "[HotelOps] OPEX - Printer (2) - Finance - HJU");
  assert.match(email.html, /OPEX Notification/);
  assert.match(email.html, />OPEX - Printer<\/div>/);
  assert.match(email.html, /A new OPEX request has been created and is available for your review\./);
  assert.match(email.html, /https:\/\/assets\.example\.com\/hju\.png/);
  assert.match(email.html, /OPEX Details/);
  assert.equal((email.html.match(/Replacement printer/g) || []).length, 1);
  assert.doesNotMatch(email.html, /Action Details/);
  assert.match(email.html, /<a href="http:\/\/localhost:5173\/Hotelops\/Pages\/Opex\/Pages\/Details\?opexId=42%2F7"[^>]*>VIEW OPEX REQUEST<\/a>/);
});

for (const [kind, expected] of Object.entries({
  APPROVE: "approved by General Manager",
  REJECT: "rejected by General Manager",
  RETURN: "returned by General Manager for further review",
  HOLD: "placed on hold by General Manager",
})) {
  test(`OPEX ${kind} email contains its action data and DB date`, () => {
    const email = buildOpexEmail({ ...base, details: { ...base.details, kind } });
    assert.match(email.html, new RegExp(expected));
    assert.match(email.html, /Action Details/);
    assert.match(email.html, /Action Quantity/);
    assert.match(email.html, /Reviewed/);
    assert.match(email.html, /General Manager/);
    assert.match(email.html, /15 Sept? 2026/);
    assert.equal((email.html.match(/Replacement printer/g) || []).length, 1);
  });
}

test("OPEX URL supports a configurable full-page override and logo text fallback", () => {
  const previous = process.env.OPEX_FRONTEND_URL;
  process.env.OPEX_FRONTEND_URL = "https://hotelops.example.com/opex";
  try {
    const email = buildOpexEmail({ ...base, logoUrl: null, details: { ...base.details, kind: "CREATE" } });
    assert.match(email.html, /<a href="https:\/\/hotelops\.example\.com\/opex\?opexId=42%2F7"/);
    assert.match(email.html, />HotelOps<\/div>/);
  } finally {
    if (previous === undefined) delete process.env.OPEX_FRONTEND_URL;
    else process.env.OPEX_FRONTEND_URL = previous;
  }
});
