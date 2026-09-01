const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceSource = fs.readFileSync(
  path.join(__dirname, "../../services/ITAdminService/UserService.js"),
  "utf8",
);
const contextSource = fs.readFileSync(
  path.join(__dirname, "../../middleware/organizationContextMiddleware.js"),
  "utf8",
);

test("full user update accepts one or more organizations and processes every mapping", () => {
  const start = serviceSource.lastIndexOf("\nconst updateUser = async");
  const end = serviceSource.indexOf("\nconst updateUserPersonalDetails = async", start);
  const updateUser = serviceSource.slice(start, end);

  assert.match(
    updateUser,
    /LoginType === "Organization"[\s\S]*?Organizations\.length === 0/,
  );
  assert.match(
    updateUser,
    /ORGANIZATION USER[\s\S]*?for \(const organization of Organizations\)/,
  );
  assert.doesNotMatch(
    updateUser,
    /Organization user must have exactly one organization/,
  );
});

test("organization-only update accepts and persists multiple mappings", () => {
  const updateOrganizations = serviceSource.match(
    /const updateUserOrganizations = async[\s\S]*?const updateUserProducts = async/,
  )[0];

  assert.match(
    updateOrganizations,
    /LoginType === "Organization"[\s\S]*?Organizations\.length === 0/,
  );
  assert.match(
    updateOrganizations,
    /for \(const organization of Organizations\)[\s\S]*?OrganizationID/,
  );
  assert.doesNotMatch(
    updateOrganizations,
    /Organization user must have exactly one organization/,
  );
});

test("selected organization context verifies the authenticated user's mapping", () => {
  assert.match(contextSource, /X-Organization-ID header is required/);
  assert.match(contextSource, /uom\.organizationid = \$2/i);
  assert.match(contextSource, /uom\.isactive = TRUE/i);
  assert.match(contextSource, /uom\.isdeleted = FALSE/i);
});
