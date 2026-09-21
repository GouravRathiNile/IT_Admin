const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveCreditApplicationRecipients, creditApplicationContent,
  dispatchCreditApplicationEvent } = require("../../services/CreditApplicationService/CreditApplicationNotificationService");

const eligibleRows = [
  { userid: 6, email: "finance@example.com", organizationname: "Hotel Udaipur",
    organizationshortname: "HJU", logoname: null },
  { userid: 6, email: "finance@example.com", organizationname: "Hotel Udaipur",
    organizationshortname: "HJU", logoname: null },
];

test("recipient query enforces organization, active mapping and FC/GM role rules", async () => {
  const calls = [];
  const result = await resolveCreditApplicationRecipients({ organizationID: 20,
    roles: ["FC"], excludeUserIds: [2, 8], queryable: { query: async (sql, params) => {
      calls.push({ sql, params }); return { rows: eligibleRows };
    } } });
  assert.deepEqual(calls[0].params, [20, ["FC"], ["2", "8"], 10]);
  assert.match(calls[0].sql, /uom\.OrganizationID = \$1 AND uom\.IsActive = TRUE AND uom\.IsDeleted = FALSE/);
  assert.match(calls[0].sql, /um\.IsActive = TRUE AND um\.IsDeleted = FALSE AND um\.IsLocked = FALSE/);
  assert.match(calls[0].sql, /COALESCE\(dm\.DepartmentName, ''\)\)\) IN \('FC', 'FINANCE'\)/);
  assert.match(calls[0].sql, /dm\.OrganizationID = \$1 AND dm\.IsDeleted = FALSE/);
  assert.match(calls[0].sql, /NOT EXISTS \([\s\S]*central_uom\.OrganizationID = \$4/);
  assert.match(calls[0].sql, /central_om\.IsActive = TRUE[\s\S]*central_om\.ActivationStatus = TRUE/);
  assert.match(calls[0].sql, /'GM' = ANY[\s\S]*UserType\)\) = 'GM'/);
  assert.deepEqual(result.userIds, ["6"]);
});

test("CREATE sends FC-only canonical notification and email to the same resolved user set", async () => {
  const notifications = [];
  const emails = [];
  const result = await dispatchCreditApplicationEvent({ organizationID: 20,
    creditApplicationID: 31, companyName: "Acme Ltd", roles: ["FC"], kind: "CREATE",
    action: "CREATED", details: { applicationDate: "2026-09-21" },
    queryable: { query: async (_sql, params) => {
      assert.deepEqual(params[1], ["FC"]);
      assert.equal(params[3], 10);
      // PostgreSQL applies the central-Finance exclusion, leaving Org 20 FC only.
      return { rows: eligibleRows };
    } }, publishNotification: async (payload) => {
      notifications.push(payload); return { success: true };
    }, deliverEmail: async (...args) => emails.push(args) });

  assert.deepEqual(result.userIds, ["6"]);
  assert.equal(result.emailCount, 1);
  assert.deepEqual(notifications[0], {
    organizationId: 20,
    title: "Credit Application - Acme Ltd - HJU",
    message: "Credit application created and requires your action.",
    type: "info",
    moduleName: "Credit Application",
    entityType: "CreditApplication",
    entityId: "31",
    action: "CREATED",
    priority: "normal",
    userIds: ["6"],
  });
  assert.equal(emails.length, 1);
  assert.equal(emails[0][0], "finance@example.com");
  assert.equal(emails[0][1], "[HotelOps] Credit Application - Acme Ltd - HJU");
});

test("FC approval targets GM and GM approval targets organization FC", async () => {
  for (const scenario of [
    { kind: "FC_APPROVE", role: "GM",
      message: "Credit application approved by FC and requires your action." },
    { kind: "GM_APPROVE", role: "FC",
      message: "Credit application approved by GM. Please update the ARID." },
  ]) {
    const payloads = [];
    await dispatchCreditApplicationEvent({ organizationID: 20, creditApplicationID: 32,
      companyName: "Acme Ltd", roles: [scenario.role], excludeUserIds: [2, 8],
      kind: scenario.kind, action: "APPROVED",
      queryable: { query: async (_sql, params) => {
        assert.deepEqual(params[1], [scenario.role]);
        assert.deepEqual(params[2], ["2", "8"]);
        return { rows: [{ ...eligibleRows[0], userid: scenario.role === "GM" ? 10 : 6 }] };
      } }, publishNotification: async (payload) => { payloads.push(payload); return { success: true }; },
      deliverEmail: async () => {} });
    assert.equal(payloads[0].message, scenario.message);
  }
});

test("GM rejection targets organization FC while FC rejection has no event", async () => {
  const payloads = [];
  await dispatchCreditApplicationEvent({ organizationID: 30, creditApplicationID: 34,
    companyName: "Client Ltd", roles: ["FC"], excludeUserIds: [9, 3],
    kind: "GM_REJECT", action: "REJECTED",
    queryable: { query: async (sql, params) => {
      assert.deepEqual(params, [30, ["FC"], ["3", "9"], 10]);
      assert.match(sql, /central_uom\.OrganizationID = \$4/);
      return { rows: [{ ...eligibleRows[0], userid: 16, organizationshortname: "ORG30" }] };
    } }, publishNotification: async (payload) => { payloads.push(payload); return { success: true }; },
    deliverEmail: async () => {} });
  assert.deepEqual(payloads[0].userIds, ["16"]);
  assert.equal(payloads[0].message,
    "Credit application rejected by GM. Please review the application.");
});

test("notification and individual email failures remain isolated", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...parts) => errors.push(parts.join(" "));
  try {
    const result = await dispatchCreditApplicationEvent({ organizationID: 20,
      creditApplicationID: 33, companyName: "Acme", roles: ["FC"], kind: "CREATE",
      action: "CREATED", queryable: { query: async () => ({ rows: [eligibleRows[0],
        { ...eligibleRows[0], userid: 7, email: "second@example.com" },
        { ...eligibleRows[0], userid: 8, email: null }] }) },
      publishNotification: async () => ({ success: false, message: "queue down" }),
      deliverEmail: async (address) => {
        if (address === "finance@example.com") throw new Error("smtp down");
      } });
    assert.equal(result.skipped, false);
    assert.equal(result.emailCount, 2);
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some((message) => message.includes("notification failed: queue down")));
  assert.ok(errors.some((message) => message.includes("email failed: smtp down")));
});

test("exact Credit Application content is stable", () => {
  const base = { companyName: "Acme", organizationShortName: "HJU" };
  assert.equal(creditApplicationContent({ ...base, kind: "CREATE" }).message,
    "Credit application created and requires your action.");
  assert.equal(creditApplicationContent({ ...base, kind: "FC_APPROVE" }).message,
    "Credit application approved by FC and requires your action.");
  assert.equal(creditApplicationContent({ ...base, kind: "GM_APPROVE" }).message,
    "Credit application approved by GM. Please update the ARID.");
  assert.equal(creditApplicationContent({ ...base, kind: "GM_REJECT" }).message,
    "Credit application rejected by GM. Please review the application.");
});

test("service dispatches only after commit and leaves ARID, RETURN and FC REJECT silent", () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    "../../services/CreditApplicationService/CreditApplicationService.js"), "utf8");
  const create = source.match(/const createCreditApplication = async \(data\)[\s\S]*?\/\/ =+ Get Apis Helper/)?.[0] || "";
  const approval = source.match(/const processCreditApplicationApproval = async \(data\)[\s\S]*?\/\/ =+UPDATE AR ID/)?.[0] || "";
  const arid = source.match(/const updateCreditApplicationARID = async \(data\)[\s\S]*?\/\/ =+ Create Approval Config/)?.[0] || "";
  assert.match(create, /getCreditApplicationApprovalFlow\(OrganizationID, client\)/);
  assert.match(create, /await client\.query\("COMMIT"\);\s*dispatchCommittedCreditApplicationEvent/);
  assert.match(approval, /approvalRole === "FC" && nextStage[\s\S]*roles: \[nextStage\.ApprovalRole\]/);
  assert.match(approval, /approvalRole === "GM" && !nextStage[\s\S]*roles: \["FC"\]/);
  assert.match(approval, /if \(Action === "REJECT"\)[\s\S]*approvalRole === "GM"[\s\S]*kind: "GM_REJECT"/);
  assert.equal((approval.match(/organizationID: OrganizationID/g) || []).length, 3);
  assert.doesNotMatch(approval, /committedNotificationEvent = \{ organizationID,/);
  assert.match(approval, /await client\.query\("COMMIT"\);\s*if \(committedNotificationEvent\)/);
  assert.doesNotMatch(arid, /dispatchCommittedCreditApplicationEvent/);
  assert.doesNotMatch(approval, /approvalRole === "FC"[\s\S]{0,160}kind: "GM_REJECT"/);
  const notificationSource = fs.readFileSync(path.resolve(__dirname,
    "../../services/CreditApplicationService/CreditApplicationNotificationService.js"), "utf8");
  assert.doesNotMatch(notificationSource, /UserID\s*=\s*\d+/i);
});
