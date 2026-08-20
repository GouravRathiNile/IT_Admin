// const { pool } = require("../db");
// const STATUS_CODES = require("../utils/statusCodes");

// const organizationContextMiddleware = async (req, res, next) => {
//   try {
//     const rawOrganizationID = req.user?.OrganizationID;
//     if (rawOrganizationID === undefined || rawOrganizationID === null || rawOrganizationID === "") {
//       return res.status(STATUS_CODES.FORBIDDEN).json({
//         success: false,
//         message: "Organization information is not available for the authenticated user",
//       });
//     }

//     if (!/^\d+$/.test(rawOrganizationID) || !Number.isSafeInteger(Number(rawOrganizationID)) || Number(rawOrganizationID) < 1) {
//       return res.status(STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: "Please provide a valid organization ID",
//       });
//     }

//     const organizationID = Number(rawOrganizationID);
//     const result = await pool.query(
//       `SELECT 1
//        FROM user_org_mapping uom
//        INNER JOIN user_master um ON um.userid = uom.userid
//        INNER JOIN organization_master om ON om.organizationid = uom.organizationid
//        WHERE uom.userid = $1 AND uom.organizationid = $2
//          AND uom.isactive = TRUE AND uom.isdeleted = FALSE
//          AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
//          AND om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
//        LIMIT 1;`,
//       [req.user.UserID, organizationID]
//     );

//     if (result.rows.length === 0) {
//       return res.status(STATUS_CODES.FORBIDDEN).json({
//         success: false,
//         message: "You are not authorized to access this organization.",
//       });
//     }

//     req.organizationID = organizationID;
//     next();
//   } catch (error) {
//     console.error("Organization Context Error:", error.message);
//     return res.status(STATUS_CODES.SERVICE_UNAVAILABLE).json({
//       success: false,
//       message: "Unable to validate organization access at this time.",
//     });
//   }
// };

// module.exports = organizationContextMiddleware;


const { pool } = require("../db");
const STATUS_CODES = require("../utils/statusCodes");

const organizationContextMiddleware = async (req, res, next) => {
  try {
    // ---------------------------------------------------------
    // 1. Authenticated user must exist
    // ---------------------------------------------------------
    const userID = req.user?.UserID;

    if (
      userID === undefined ||
      userID === null ||
      userID === ""
    ) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Authenticated user information is unavailable",
      });
    }

    // ---------------------------------------------------------
    // 2. Organization comes from request header, NOT JWT
    // ---------------------------------------------------------
    const rawOrganizationID = req.get("X-Organization-ID");

    if (
      rawOrganizationID === undefined ||
      rawOrganizationID === null ||
      rawOrganizationID === ""
    ) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "X-Organization-ID header is required",
      });
    }

    // ---------------------------------------------------------
    // 3. Validate organization ID format
    // ---------------------------------------------------------
    if (
      !/^\d+$/.test(String(rawOrganizationID)) ||
      !Number.isSafeInteger(Number(rawOrganizationID)) ||
      Number(rawOrganizationID) < 1
    ) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Please provide a valid organization ID",
      });
    }

    const organizationID = Number(rawOrganizationID);

    // ---------------------------------------------------------
    // 4. Verify user has access to this organization
    // ---------------------------------------------------------
    const result = await pool.query(
      `SELECT 1
       FROM user_org_mapping uom
       INNER JOIN user_master um
         ON um.userid = uom.userid
       INNER JOIN organization_master om
         ON om.organizationid = uom.organizationid
       WHERE uom.userid = $1
         AND uom.organizationid = $2
         AND uom.isactive = TRUE
         AND uom.isdeleted = FALSE
         AND um.isactive = TRUE
         AND um.isdeleted = FALSE
         AND um.islocked = FALSE
         AND om.isactive = TRUE
         AND om.activationstatus = TRUE
         AND om.isdeleted = FALSE
       LIMIT 1;`,
      [userID, organizationID]
    );

    // ---------------------------------------------------------
    // 5. User is not mapped to requested organization
    // ---------------------------------------------------------
    if (result.rows.length === 0) {
      return res.status(STATUS_CODES.FORBIDDEN).json({
        success: false,
        message: "You are not authorized to access this organization.",
      });
    }

    // ---------------------------------------------------------
    // 6. Store trusted organization context
    // ---------------------------------------------------------
    req.organizationID = organizationID;

    next();
  } catch (error) {
    console.error("Organization Context Error:", error);

    return res.status(STATUS_CODES.SERVICE_UNAVAILABLE).json({
      success: false,
      message: "Unable to validate organization access at this time.",
    });
  }
};

module.exports = organizationContextMiddleware;