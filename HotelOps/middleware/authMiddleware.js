// const jwt = require("jsonwebtoken");
// const { pool } = require("../db");
// //==================================================Error Handling
// const STATUS_CODES = require("../utils/statusCodes");

// const authenticateToken = (req, res, next) => {
//   try {
//     const authHeader = req.headers.authorization;

//     if (!authHeader) {
//       return res.status(STATUS_CODES.UNAUTHORIZED).json({
//         success: false,
//         message: "Authentication token is required",
//       });
//     }

//     const token = authHeader.startsWith("Bearer ")
//       ? authHeader.substring(7)
//       : null;

//     if (!token) {
//       return res.status(STATUS_CODES.UNAUTHORIZED).json({
//         success: false,
//         message: "Invalid or expired authentication token",
//       });
//     }

//     const decoded = jwt.verify(
//       token,
//       process.env.JWT_SECRET
//     );

//     req.user = decoded;

//     next();

//   } catch (error) {

//     console.log(
//       "Authentication Error:",
//       error.message
//     );

//     return res.status(STATUS_CODES.UNAUTHORIZED).json({
//       success: false,
//       message: "Invalid or expired authentication token",
//     });
//   }
// };

// module.exports = authenticateToken;


const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const STATUS_CODES = require("../utils/statusCodes");

const authenticateToken = async (req, res, next) => {
  try {

    // ========================================================
    // Authorization Header
    // ========================================================

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    // ========================================================
    // Bearer Token
    // ========================================================

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Invalid or expired authentication token",
      });
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Invalid or expired authentication token",
      });
    }

    // ========================================================
    // Verify JWT
    // ========================================================

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    // ========================================================
    // Validate Required JWT Claims
    // ========================================================

    if (!decoded.UserID || !decoded.jti) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    // ========================================================
    // Check Token Blacklist
    // ========================================================

    const blacklistResult = await pool.query(
      `
      SELECT TokenBlacklistID
      FROM auth_token_blacklist
      WHERE JTI = $1
        AND IsActive = TRUE
        AND TokenExpiresAt > CURRENT_TIMESTAMP
      LIMIT 1;
      `,
      [decoded.jti]
    );

    // ========================================================
    // Token Revoked
    // ========================================================

    if (blacklistResult.rows.length > 0) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Authentication token has been revoked",
      });
    }

    // ========================================================
    // Authentication Successful
    // ========================================================

    req.user = decoded;

    next();

  } catch (error) {

    console.log(
      "Authentication Error:",
      error.message
    );

    return res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
};

module.exports = authenticateToken;
