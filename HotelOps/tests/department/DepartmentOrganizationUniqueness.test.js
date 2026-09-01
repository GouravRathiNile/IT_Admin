const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../../docs/department-organization-uniqueness-migration.sql"),
  "utf8",
);

test("department uniqueness is scoped to active records in an organization", () => {
  assert.match(
    migration,
    /ON Department_Master \(OrganizationID, DepartmentName\)\s+WHERE IsDeleted = FALSE/i,
  );
  assert.match(
    migration,
    /ON Department_Master \(OrganizationID, DepartmentShortName\)\s+WHERE IsDeleted = FALSE/i,
  );
  assert.match(migration, /DROP CONSTRAINT/i);
  assert.match(migration, /pi\.indnkeyatts = 1/i);
});

test("migration checks organization-scoped duplicates before changing indexes", () => {
  assert.match(
    migration,
    /GROUP BY OrganizationID, DepartmentName\s+HAVING COUNT\(\*\) > 1/i,
  );
  assert.match(
    migration,
    /GROUP BY OrganizationID, DepartmentShortName\s+HAVING COUNT\(\*\) > 1/i,
  );
  assert.match(migration, /BEGIN;/i);
  assert.match(migration, /COMMIT;/i);
});
