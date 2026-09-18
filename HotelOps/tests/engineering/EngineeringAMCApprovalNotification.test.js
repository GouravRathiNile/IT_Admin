const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveAMCApprovalNotificationRecipients, amcApprovalNotificationContent,
  notifyAMCApproval } = require("../../services/EngineeringService/EngineeringAMCApprovalNotificationService");

const recipientDb = (rows) => ({ query: async (sql, params) => ({ rows: typeof rows === "function"
  ? rows(sql, params) : rows }) });

test("AMC approval notification content uses the exact approved formats", () => {
  const base = { equipmentName: "Chiller", organizationShortName: "HJU",
    actorName: "Approver Name", approverRole: "GM" };
  assert.deepEqual(amcApprovalNotificationContent({ ...base, kind: "CREATE", firstRole: "FC" }),
    { title: "AMC - Chiller - HJU", message: "AMC created and pending with FC." });
  assert.deepEqual(amcApprovalNotificationContent({ ...base, kind: "APPROVE", nextRole: "RD" }),
    { title: "AMC - Chiller - HJU", message: "Approved by Approver Name." });
  assert.equal(amcApprovalNotificationContent({ ...base, kind: "FINAL_APPROVE" }).message,
    "Finally approved by Approver Name.");
  assert.equal(amcApprovalNotificationContent({ ...base, kind: "RETURN" }).message,
    "Returned by Approver Name.");
  assert.equal(amcApprovalNotificationContent({ ...base, kind: "REJECT" }).message,
    "Rejected by Approver Name.");
});

test("recipient query keeps local roles scoped and resolves RD from organization 10", async () => {
  const calls = [];
  await resolveAMCApprovalNotificationRecipients({ organizationID: 20, roles: ["FC"],
    directUserIds: [5], excludeUserID: 7, actorUserID: 7,
    queryable: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } } });
  assert.match(calls[0].sql, /direct_uom\.OrganizationID = \$1/);
  assert.match(calls[0].sql, /um\.IsActive = TRUE AND um\.IsDeleted = FALSE AND um\.IsLocked = FALSE/);
  assert.match(calls[0].sql, /fc_uom\.OrganizationID = \$1/);
  assert.match(calls[0].sql, /'RD' = ANY[\s\S]*rd_uom\.OrganizationID = \$6/);
  assert.match(calls[0].sql, /rd_uom\.IsActive = TRUE AND rd_uom\.IsDeleted = FALSE/);
  assert.doesNotMatch(calls[0].sql, /UserType\)\) = 'RD'/);
  assert.deepEqual(calls[0].params, [20, ["FC"], ["5"], "7", "7", 10]);
});

test("CREATE publishes only finalized role recipients and deduplicates IDs", async () => {
  const payloads = [];
  const result = await notifyAMCApproval({ organizationID: 20, amcID: 12,
    equipmentName: "Generator", roles: ["FC"], kind: "CREATE", firstRole: "FC",
    action: "CREATED", queryable: recipientDb([
      { userid: 6, organizationshortname: "HJU" },
      { userid: 6, organizationshortname: "HJU" },
    ]), publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
  assert.equal(result.skipped, false);
  assert.deepEqual(payloads[0].userIds, ["6"]);
  assert.equal(payloads[0].moduleName, "Engineering");
  assert.equal(payloads[0].entityType, "AMC");
  assert.equal(payloads[0].entityId, "12");
  assert.equal(payloads[0].action, "CREATED");
});

test("custom configured first and next roles are passed through without hardcoding", async () => {
  const payloads = [];
  const db = recipientDb([{ userid: 11, organizationshortname: "HJU",
    actorname: "GM User" }]);
  await notifyAMCApproval({ organizationID: 20, amcID: 13, equipmentName: "Boiler",
    roles: ["GM"], kind: "CREATE", firstRole: "GM", action: "CREATED",
    queryable: db, publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
  await notifyAMCApproval({ organizationID: 20, amcID: 13, equipmentName: "Boiler",
    roles: ["CEO"], directUserIds: [2], excludeUserID: 11, actorUserID: 11,
    kind: "APPROVE", approverRole: "GM", nextRole: "CEO", action: "APPROVED",
    queryable: db, publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
  assert.equal(payloads[0].message, "AMC created and pending with GM.");
  assert.equal(payloads[1].message, "Approved by GM User.");
});

test("FC to GM to RD to CEO approvals use next role plus creator and exclude actor", async () => {
  const transitions = [["FC", "GM"], ["GM", "RD"], ["RD", "CEO"]];
  for (const [actingRole, nextRole] of transitions) {
    const calls = [];
    const payloads = [];
    await notifyAMCApproval({ organizationID: actingRole === "RD" ? 10 : 20,
      amcID: 15, equipmentName: "AHU", roles: [nextRole], directUserIds: [2],
      excludeUserID: 7, actorUserID: 7, kind: "APPROVE", approverRole: actingRole,
      nextRole, action: "APPROVED", queryable: { query: async (sql, params) => {
        calls.push(params); return { rows: [{ userid: 2, organizationshortname: "HJU",
          actorname: actingRole }, { userid: 9, organizationshortname: "HJU",
          actorname: actingRole }] };
      } }, publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
    assert.deepEqual(calls[0][1], [nextRole]);
    assert.equal(calls[0][3], "7");
    assert.deepEqual(payloads[0].userIds, ["2", "9"]);
    assert.equal(payloads[0].message, `Approved by ${actingRole}.`);
  }
});

test("final approval notifies only the creator", async () => {
  const calls = [];
  const payloads = [];
  await notifyAMCApproval({ organizationID: 20, amcID: 18, equipmentName: "Pump",
    directUserIds: [2], actorUserID: 10, kind: "FINAL_APPROVE", approverRole: "CEO",
    action: "APPROVED", queryable: { query: async (sql, params) => {
      calls.push(params); return { rows: [{ userid: 2, organizationshortname: "HJU",
        actorname: "CEO Name" }] };
    } }, publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
  assert.deepEqual(calls[0][1], []);
  assert.deepEqual(calls[0][2], ["2"]);
  assert.equal(calls[0][3], null);
  assert.deepEqual(payloads[0].userIds, ["2"]);
  assert.equal(payloads[0].message, "Finally approved by CEO Name.");
});

test("RETURN and REJECT include creator and acting-role peers while excluding actor", async () => {
  for (const [kind, action, label] of [["RETURN", "RETURNED", "Returned"],
    ["REJECT", "REJECTED", "Rejected"]]) {
    const calls = [];
    const payloads = [];
    await notifyAMCApproval({ organizationID: 20, amcID: 21, equipmentName: "Lift",
      roles: ["GM"], directUserIds: [2], excludeUserID: 8, actorUserID: 8,
      kind, approverRole: "GM", action, queryable: { query: async (sql, params) => {
        calls.push(params); return { rows: [{ userid: 2, organizationshortname: "HJU",
          actorname: "GM User" }, { userid: 9, organizationshortname: "HJU",
          actorname: "GM User" }] };
      } }, publishNotification: async (payload) => { payloads.push(payload); return { success: true }; } });
    assert.deepEqual(calls[0][1], ["GM"]);
    assert.equal(calls[0][3], "8");
    assert.deepEqual(payloads[0].userIds, ["2", "9"]);
    assert.equal(payloads[0].message, `${label} by GM User.`);
    assert.equal(payloads[0].action, action);
  }
});

test("no recipient skips safely and notification failure rejects only the detached work", async () => {
  const skipped = await notifyAMCApproval({ organizationID: 20, amcID: 1,
    equipmentName: "Pump", roles: ["FC"], kind: "CREATE", firstRole: "FC",
    action: "CREATED", queryable: recipientDb([]),
    publishNotification: async () => assert.fail("must not publish") });
  assert.equal(skipped.skipped, true);
  await assert.rejects(() => notifyAMCApproval({ organizationID: 20, amcID: 1,
    equipmentName: "Pump", roles: ["FC"], kind: "CREATE", firstRole: "FC",
    action: "CREATED", queryable: recipientDb([{ userid: 6, organizationshortname: "HJU" }]),
    publishNotification: async () => ({ success: false, message: "queue down" }) }), /queue down/);
});

test("AMC create and actions dispatch only after commit and use configured stage order", () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    "../../services/EngineeringService/EngineeringService.js"), "utf8");
  const create = source.match(/const createAMC = async \(data\)[\s\S]*?\/\/ =+AMC List/)?.[0] || "";
  const approval = source.match(/const processAMCApproval = async \(data\)[\s\S]*?\/\/ =+Create AMC Approval Config/)?.[0] || "";
  assert.ok(create.indexOf('await client.query("COMMIT")') <
    create.indexOf("notifyCommittedAMCApproval"));
  assert.match(create, /ORDER BY\s+ApprovalOrder ASC,\s+ApprovalLevel ASC/);
  assert.match(create, /firstApprovalRole = configuredFlow\[0\]\?\.ApprovalRole/);
  assert.ok(approval.lastIndexOf('await client.query("COMMIT")') <
    approval.lastIndexOf("notifyCommittedAMCApproval"));
  assert.match(approval, /nextApprovalRole = approvalFlow\[currentIndex \+ 1\]\?\.ApprovalRole/);
  assert.doesNotMatch(approval, /kind: "HOLD"|action: "HOLD"/);
});
