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
