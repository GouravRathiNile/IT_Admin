const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeResponsibleUserIds,
  addedResponsibleUserIds,
  notifyMOMAssignment,
  notifyCommittedMOMAssignment,
} = require("../../services/MinutesOfMeetingService/MinutesOfMeetingNotificationService");

test("responsible IDs are validated, normalized and deduplicated", () => {
  assert.deepEqual(
    normalizeResponsibleUserIds([3, "2", " 3 ", null, 0, -1, "abc", ""]),
    ["2", "3"],
  );
});

test("update comparison detects only assignments newly added per action", () => {
  const before = [
    { actionid: 10, responsibleperson: [2] },
    { actionid: 11, responsibleperson: [2, 3] },
    { actionid: 12, responsibleperson: [2, 3] },
    { actionid: 13, responsibleperson: [2, 3] },
    { actionid: 14, responsibleperson: [8] },
  ];
  const after = [
    { actionid: 10, responsibleperson: [2, 4] }, // added 4
    { actionid: 11, responsibleperson: [3] }, // removed only
    { actionid: 12, responsibleperson: [3, 2] }, // order only
    { actionid: 14, responsibleperson: [9] }, // replaced 8 with 9
    { actionid: 15, responsibleperson: [2, 5, 5] }, // new action
    // Action 13 was deleted and contributes no recipient.
  ];

  assert.deepEqual(addedResponsibleUserIds(before, after), ["2", "4", "5", "9"]);
});

test("a user is notified when newly assigned to a different action", () => {
  const before = [{ actionid: 1, responsibleperson: [2] }];
  const after = [
    { actionid: 1, responsibleperson: [2] },
    { actionid: 2, responsibleperson: [2] },
  ];
  assert.deepEqual(addedResponsibleUserIds(before, after), ["2"]);
});

test("MOM notification uses eligible same-organization recipients and canonical payload", async () => {
  let query;
  let params;
  let published;
  const result = await notifyMOMAssignment({
    organizationID: 20,
    meetingID: 41,
    meetingTitle: "Daily Operations",
    responsibleUserIds: [7, 6, 7, 99],
    action: "ACTION_ASSIGNED",
    queryable: {
      query: async (sql, values) => {
        query = sql;
        params = values;
        // User 99 represents an invalid/inactive/unmapped candidate excluded by SQL.
        return {
          rows: [
            { userid: 7, organizationshortname: "HJU" },
            { userid: 6, organizationshortname: "HJU" },
            { userid: 7, organizationshortname: "HJU" },
          ],
        };
      },
    },
    publishNotification: async (data) => {
      published = data;
      return { success: true };
    },
  });

  assert.deepEqual(params, [["6", "7", "99"], 20]);
  assert.match(query, /um\.IsActive = TRUE AND um\.IsDeleted = FALSE AND um\.IsLocked = FALSE/);
  assert.match(query, /uom\.IsActive = TRUE AND uom\.IsDeleted = FALSE/);
  assert.match(query, /uom\.OrganizationID = \$2/);
  assert.deepEqual(result.userIds, ["6", "7"]);
  assert.deepEqual(published, {
    organizationId: 20,
    title: "MOM - Daily Operations - HJU",
    message: "You have been assigned one or more action items for this meeting.",
    type: "info",
    moduleName: "Minutes of Meeting",
    entityType: "MOM",
    entityId: "41",
    action: "ACTION_ASSIGNED",
    priority: "normal",
    userIds: ["6", "7"],
  });
});

test("MOM notification safely skips empty and ineligible recipient sets", async () => {
  let queryCalls = 0;
  let publishCalls = 0;
  const queryable = {
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
  };
  const publishNotification = async () => {
    publishCalls += 1;
    return { success: true };
  };

  assert.deepEqual(
    await notifyMOMAssignment({ responsibleUserIds: [], queryable, publishNotification }),
    { skipped: true, reason: "no-assignment" },
  );
  assert.deepEqual(
    await notifyMOMAssignment({ organizationID: 20, responsibleUserIds: [2],
      queryable, publishNotification }),
    { skipped: true, reason: "no-eligible-recipient" },
  );
  assert.equal(queryCalls, 1);
  assert.equal(publishCalls, 0);
});

test("post-commit notification failure is isolated from the MOM operation", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...values) => errors.push(values.join(" "));

  try {
    notifyCommittedMOMAssignment({
      organizationID: 20,
      meetingID: 41,
      meetingTitle: "Daily Operations",
      responsibleUserIds: [6],
      queryable: {
        query: async () => ({
          rows: [{ userid: 6, organizationshortname: "HJU" }],
        }),
      },
      publishNotification: async () => {
        throw new Error("RabbitMQ unavailable");
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }

  assert.equal(errors.length, 1);
  assert.match(errors[0], /MOM assignment notification failed: RabbitMQ unavailable/);
});

test("MOM service snapshots persisted assignments and dispatches only after commit", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname,
      "../../services/MinutesOfMeetingService/MinutesOfMeetingService.js"),
    "utf8",
  );
  const notificationSource = fs.readFileSync(
    path.resolve(__dirname,
      "../../services/MinutesOfMeetingService/MinutesOfMeetingNotificationService.js"),
    "utf8",
  );
  const create = source.match(/const createMOM = async \(data\)[\s\S]*?const getAllMOM/)?.[0] || "";
  const update = source.match(/const updateMOM = async \(data\)[\s\S]*?const deleteMOM/)?.[0] || "";

  assert.match(create, /await client\.query\("COMMIT"\);\s*notifyCommittedMOMAssignment\([\s\S]*action: "ACTION_ASSIGNED"/);
  assert.ok(create.indexOf("assignedUserIDs.push") < create.indexOf('client.query("COMMIT")'));
  assert.match(update, /SELECT ActionID, ResponsiblePerson[\s\S]*FOR UPDATE;/);
  assert.match(update, /const afterActionsResult = await client\.query/);
  assert.match(update, /addedResponsibleUserIds\(\s*beforeActionsResult\.rows,\s*afterActionsResult\.rows/);
  assert.match(update, /await client\.query\("COMMIT"\);\s*notifyCommittedMOMAssignment\([\s\S]*action: "RESPONSIBLE_PERSON_ADDED"/);
  assert.match(notificationSource, /MOM assignment notification failed/);
});
