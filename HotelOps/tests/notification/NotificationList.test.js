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
  assert.match(source, /const NOTIFICATION_MODULE_NAMES = Object\.freeze\(\{\s*capex: "Capex",\s*guestglitch: "Guest Glitch",\s*incidentreport: "Incident Report",\s*opex: "Opex"/);
  assert.match(source, /trimmed\.toLowerCase\(\)\.replace\(\/\\s\+\/g, ""\)/);
  const create = source.match(/const createNotification = async \(data\)[\s\S]*?const getNotifications/)?.[0] || "";
  assert.match(create, /const moduleName = normalizeNotificationModuleName\(data\.moduleName\)/);
  assert.match(create, /data\.type \|\| "info",\s*moduleName,/);
  assert.doesNotMatch(create, /data\.type \|\| "info",\s*data\.moduleName,/);
  assert.match(source, /normalizeNotificationModuleName\(data\.moduleName\)/);
  assert.match(source, /normalizeNotificationModuleName\(moduleName\)/);
  assert.match(source, /new Set\(\["Capex", "Guest Glitch", "Incident Report", "Opex", "Engineering", "Minutes of Meeting", "Credit Application"\]\)/);
  assert.match(source, /PUSH_NOTIFICATION_MODULES\.has\(notification\.module_name\)/);
});

test("CAPEX email delivery uses committed notification recipients and stays independent from Firebase", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/NotificationService/NotificationService.js"), "utf8"
  );
  const emailDelivery = source.match(/const emailNotificationToRecipients[\s\S]*?\/\/ =+/)?.[0] || "";
  const create = source.match(/const createNotification = async \(data\)[\s\S]*?const getNotifications/)?.[0] || "";

  assert.match(source, /const EMAIL_NOTIFICATION_MODULES = new Set\(\["Capex"\]\)/);
  assert.match(emailDelivery, /um\.userid::text = ANY\(\$1::text\[\]\)/);
  assert.match(emailDelivery, /um\.isactive = TRUE AND um\.isdeleted = FALSE AND um\.islocked = FALSE/);
  assert.match(emailDelivery, /NULLIF\(TRIM\(um\.email\), ''\) IS NOT NULL/);
  assert.match(emailDelivery, /uniqueEmails\.set\(email\.toLowerCase\(\), email\)/);
  assert.match(emailDelivery, /Promise\.all\(\[\.\.\.uniqueEmails\.values\(\)\]\.map/);
  assert.match(emailDelivery, /await sendNotificationEmail\(email, emailNotification\)/);
  assert.match(emailDelivery, /Notification email delivery failed/);
  assert.match(emailDelivery, /FROM organization_master om/);
  assert.match(emailDelivery, /organization_master_logo oml/);
  assert.match(emailDelivery, /generateOrganizationLogoUrl\(organization\.logoname\)/);

  const commitIndex = create.indexOf('await client.query("COMMIT")');
  const firebaseIndex = create.indexOf("PUSH_NOTIFICATION_MODULES.has");
  const emailIndex = create.indexOf("EMAIL_NOTIFICATION_MODULES.has");
  assert.ok(commitIndex >= 0 && firebaseIndex > commitIndex && emailIndex > commitIndex);
  assert.notEqual(firebaseIndex, emailIndex);
});

test("Engineering warranty persistence atomically prevents duplicate database rows", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/NotificationService/NotificationService.js"), "utf8"
  );
  const create = source.match(/const createNotification = async \(data\)[\s\S]*?const getNotifications/)?.[0] || "";
  assert.match(source, /const ENGINEERING_WARRANTY_ENTITY = "EquipmentWarrantySummary"/);
  assert.match(source, /"WARRANTY_DAILY_SUMMARY"[\s\S]*"WARRANTY_EXPIRING_TODAY"[\s\S]*"WARRANTY_EXPIRED"/);
  assert.match(create, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(create, /organization_id = \$1[\s\S]*entity_id = \$4[\s\S]*action = ANY\(\$5::text\[\]\)/);
  assert.match(create, /message: "Notification already exists\."/);
  assert.match(create, /data\.action === "WARRANTY_DAILY_SUMMARY"[\s\S]*message: "Legacy warranty notification ignored\."/);
  assert.ok(create.indexOf("pg_advisory_xact_lock") < create.indexOf("INSERT INTO notifications"));
});

test("scheduled Engineering maintenance and AMC summaries are persistence-idempotent", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../services/NotificationService/NotificationService.js"), "utf8"
  );
  const create = source.match(/const createNotification = async \(data\)[\s\S]*?const getNotifications/)?.[0] || "";
  assert.match(source, /EquipmentMaintenanceSummary: new Set\(\["MAINTENANCE_DUE"\]\)/);
  assert.match(source, /EquipmentAMCSummary: new Set\(\["AMC_EXPIRING_TODAY"\]\)/);
  assert.match(create, /scheduledActions\?\.has\(data\.action\)/);
  assert.match(create, /entity_type = \$3 AND entity_id = \$4 AND action = \$5/);
  assert.ok(create.lastIndexOf("pg_advisory_xact_lock") < create.indexOf("INSERT INTO notifications"));
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
