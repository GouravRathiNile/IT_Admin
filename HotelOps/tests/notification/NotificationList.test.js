const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("NotificationList count and data queries are always unread-only", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/NotificationService/NotificationService.js"),
    "utf8"
  );
  const getNotifications = source.match(/const getNotifications = async \(data\)[\s\S]*?\n\};/)?.[0] || "";
  assert.match(getNotifications, /const conditions = \[\s*"nr\.user_id = \$1",\s*"nr\.is_read = FALSE",\s*\]/);
  assert.match(getNotifications, /FROM notifications n[\s\S]*\$\{whereClause\}/);
  assert.match(getNotifications, /n\.module_name = \$\$\{parameterIndex\}/);
  assert.doesNotMatch(getNotifications, /normalizedIsRead|nr\.is_read = \$\$\{parameterIndex\}/);
});

test("notification module names are normalized centrally before persistence and filtering", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/NotificationService/NotificationService.js"), "utf8"
  );
  assert.match(source, /const NOTIFICATION_MODULE_NAMES = Object\.freeze\(\{\s*guestglitch: "Guest Glitch",\s*opex: "Opex"/);
  assert.match(source, /trimmed\.toLowerCase\(\)\.replace\(\/\\s\+\/g, ""\)/);
  const create = source.match(/const createNotification = async \(data\)[\s\S]*?const getNotifications/)?.[0] || "";
  assert.match(create, /const moduleName = normalizeNotificationModuleName\(data\.moduleName\)/);
  assert.match(create, /data\.type \|\| "info",\s*moduleName,/);
  assert.doesNotMatch(create, /data\.type \|\| "info",\s*data\.moduleName,/);
  assert.match(source, /normalizeNotificationModuleName\(data\.moduleName\)/);
  assert.match(source, /normalizeNotificationModuleName\(moduleName\)/);
});

test("Guest Glitch create notification is organization-scoped to HOD, GM and CEO recipients", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/GuestGlitchService/GuestGlitchService.js"),
    "utf8"
  );
  const notify = source.match(/const notifyGuestGlitch[\s\S]*?const notifyCommittedGuestGlitch/)?.[0] || "";
  assert.match(notify, /INNER JOIN user_org_mapping uom ON uom\.userid = um\.userid/);
  assert.match(notify, /WHERE uom\.organizationid = \$1/);
  assert.match(notify, /COALESCE\(NULLIF\(TRIM\(om\.shortname\), ''\), om\.organizationname\) AS organization_short_name/);
  assert.match(notify, /IN \('HOD', 'CORPORATE HOD', 'GM', 'CEO'\)/);
  assert.match(notify, /AND \(\$5::boolean OR um\.userid::text <> \$2\)/);
  assert.match(notify, /\.filter\(\(id\) => isCreate \|\| id !== String\(actorUserId\)\)/);
  assert.match(notify, /notificationIds\(recipients\.rows\.map\(\(row\) => row\.userid\)\)/);
  assert.match(notify, /const glitchContext = `Glitch \$\{String\(current\.RoomNumber/);
  assert.match(notify, /title: isCreate \? glitchContext : "Guest Glitch Updated"/);
  assert.match(notify, /message: isCreate \? complaint : `\$\{glitchContext\} : \$\{complaint\}`/);
});

test("Guest Glitch notification module name is canonical and never read from request data", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/GuestGlitchService/GuestGlitchService.js"), "utf8"
  );
  const notify = source.match(/const notifyGuestGlitch[\s\S]*?const notifyCommittedGuestGlitch/)?.[0] || "";
  assert.match(source, /const GUEST_GLITCH_NOTIFICATION_MODULE = "Guest Glitch"/);
  assert.match(notify, /moduleName: GUEST_GLITCH_NOTIFICATION_MODULE/);
  assert.doesNotMatch(notify, /data\.moduleName|req\.body/);
});

test("Guest Glitch update notifications cover only meaningful workflow events", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/GuestGlitchService/GuestGlitchService.js"), "utf8"
  );
  const events = source.match(/const guestGlitchUpdateEvents[\s\S]*?\n\};/)?.[0] || "";
  assert.match(events, /events\.push\("Status"\)/);
  assert.match(events, /events\.push\("DepartmentHODComments"\)/);
  assert.match(events, /events\.push\("GMComment"\)/);
  assert.match(events, /events\.push\("Assignment"\)/);
  assert.doesNotMatch(events, /Complaint|DetailedInvestigation|ServiceRecovery|InternalActionTaken/);
});

test("Guest Glitch update sends one notification for multiple events and skips no-op events", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/GuestGlitchService/GuestGlitchService.js"), "utf8"
  );
  const notify = source.match(/const notifyGuestGlitch[\s\S]*?const notifyCommittedGuestGlitch/)?.[0] || "";
  assert.match(notify, /const changed = isCreate \? \[\] : guestGlitchUpdateEvents\(previous, current\)/);
  assert.match(notify, /if \(!isCreate && !changed\.length\) return/);
  assert.equal((notify.match(/sendMessage\(/g) || []).length, 1);
  assert.doesNotMatch(notify, /Guest Glitch #|changed\.join/);
});

test("Guest Glitch assignment events use existing organization-scoped recipient relationships", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/GuestGlitchService/GuestGlitchService.js"), "utf8"
  );
  assert.match(source, /"DepartmentIDs", "ReceivedByIDs", "InformedToIDs", "ResolvedBy"/);
  const notify = source.match(/const notifyGuestGlitch[\s\S]*?const notifyCommittedGuestGlitch/)?.[0] || "";
  assert.match(notify, /current\.InformedToIDs/);
  assert.match(notify, /current\.ReceivedByIDs/);
  assert.match(notify, /current\.CreatedBy/);
  assert.match(notify, /current\.ResolvedBy/);
  assert.match(notify, /dm\.organizationid = \$1/);
  assert.match(notify, /UPPER\(TRIM\(um\.usertype\)\) = 'GM'/);
});

test("Guest Glitch notification remains post-commit and generic notification service has no module orchestration", () => {
  const guestSource = fs.readFileSync(
    path.resolve(__dirname, "../../services/GuestGlitchService/GuestGlitchService.js"), "utf8"
  );
  const notificationSource = fs.readFileSync(
    path.resolve(__dirname, "../../services/NotificationService/NotificationService.js"), "utf8"
  );
  assert.match(guestSource, /await client\.query\("COMMIT"\);\s*notifyCommittedGuestGlitch\(/);
  assert.doesNotMatch(notificationSource, /const notifyGuestGlitch/);
  assert.doesNotMatch(notificationSource, /moduleName: "GuestGlitch"/);
});
