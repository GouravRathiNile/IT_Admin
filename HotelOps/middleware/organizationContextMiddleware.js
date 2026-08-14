const { pool } = require("../db");
const STATUS_CODES = require("../utils/statusCodes");

const organizationContextMiddleware = async (req, res, next) => {
  try {
    const rawOrganizationID = req.get("X-Organization-ID");
    if (!rawOrganizationID) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "X-Organization-ID header is required.",
      });
    }

    if (!/^\d+$/.test(rawOrganizationID) || !Number.isSafeInteger(Number(rawOrganizationID)) || Number(rawOrganizationID) < 1) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Please provide a valid organization ID.",
      });
    }

    const organizationID = Number(rawOrganizationID);
    const result = await pool.query(
      `SELECT 1
       FROM user_org_mapping uom
       INNER JOIN user_master um ON um.userid = uom.userid
       INNER JOIN organization_master om ON om.organizationid = uom.organizationid
       WHERE uom.userid = $1 AND uom.organizationid = $2
         AND uom.isactive = TRUE AND uom.isdeleted = FALSE
         AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
         AND om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
       LIMIT 1;`,
      [req.user.UserID, organizationID]
    );

    if (result.rows.length === 0) {
      return res.status(STATUS_CODES.FORBIDDEN).json({
        success: false,
        message: "You are not authorized to access this organization.",
      });
    }

    req.organizationID = organizationID;
    next();
  } catch (error) {
    console.error("Organization Context Error:", error.message);
    return res.status(STATUS_CODES.SERVICE_UNAVAILABLE).json({
      success: false,
      message: "Unable to validate organization access at this time.",
    });
  }
};

module.exports = organizationContextMiddleware;
