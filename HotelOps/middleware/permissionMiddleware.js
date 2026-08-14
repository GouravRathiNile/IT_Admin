const STATUS_CODES = require("../utils/statusCodes");
const { getPermissions } = require("../config/guestGlitchPermissions");

const requirePermission = (permission) => (req, res, next) => {
  const permissions = getPermissions(req.user);
  if (!permissions.includes(permission)) {
    return res.status(STATUS_CODES.FORBIDDEN).json({
      success: false,
      message: "You are not authorized to perform this action.",
    });
  }
  next();
};

module.exports = requirePermission;
