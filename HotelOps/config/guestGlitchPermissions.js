const { PERMISSIONS } = require("./guestGlitchConstants");

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

const ROLE_PERMISSIONS = Object.freeze({
  "SUPERADMIN:HOD": ALL_PERMISSIONS,
  "HOTEL:HOD": [
    PERMISSIONS.VIEW,
    PERMISSIONS.CREATE,
    PERMISSIONS.UPDATE,
    PERMISSIONS.DELETE,
    PERMISSIONS.STATUS_UPDATE,
  ],
});

const normalizeRolePart = (value) => String(value || "").trim().toUpperCase();

const getPermissions = (user = {}) => {
  const key = `${normalizeRolePart(user.LoginType)}:${normalizeRolePart(user.UserType)}`;
  return ROLE_PERMISSIONS[key] || [];
};

module.exports = { getPermissions };
