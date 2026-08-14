const jwt = require("jsonwebtoken");
const STATUS_CODES = require("../utils/statusCodes");

const FORGOT_PASSWORD_OTP_PURPOSE = "FORGOT_PASSWORD_OTP";
const PASSWORD_RESET_VERIFIED_PURPOSE = "PASSWORD_RESET_VERIFIED";

const verifyTemporaryToken = (
  expectedPurpose,
  expiredMessage,
  invalidMessage
) => (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Authorization token is required",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : null;

    if (!token) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Bearer token is required",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.purpose !== expectedPurpose) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: invalidMessage,
      });
    }

    req.otpUser = decoded;
    next();
  } catch (error) {
    const message = error.name === "TokenExpiredError"
      ? expiredMessage
      : invalidMessage;

    return res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message,
    });
  }
};

const verifyForgotPasswordToken = verifyTemporaryToken(
  FORGOT_PASSWORD_OTP_PURPOSE,
  "OTP has expired. Please request a new OTP.",
  "Invalid OTP verification token"
);

const verifyPasswordResetToken = verifyTemporaryToken(
  PASSWORD_RESET_VERIFIED_PURPOSE,
  "Verified reset token has expired. Please restart the password reset process.",
  "Invalid verified reset token"
);

module.exports = {
  verifyForgotPasswordToken,
  verifyPasswordResetToken,
};
