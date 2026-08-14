//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
// ===================================================Jwt
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");

// ============================================================Login
exports.login = async (req, res) => {
  try {
    const {
      Username,
      Password,
    } = req.body;

    // ========================================================
    // Headers
    // ========================================================

    const DeviceID = req.headers["deviceid"];
    const DeviceToken = req.headers["devicetoken"];
    const DeviceType = req.headers["devicetype"];

    // ========================================================
    // Validation
    // ========================================================

    if (!Username) {
      throw new AppError(
        "Username is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!Password) {
      throw new AppError(
        "Password is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!DeviceID) {
      throw new AppError(
        "Device ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!DeviceToken) {
      throw new AppError(
        "Device Token is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!DeviceType) {
      throw new AppError(
        "Device Type is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Send To RabbitMQ
    // ========================================================

    const response = await producer.sendMessage(
      QUEUE.AUTH.REQUEST,
      QUEUE.AUTH.RESPONSE,
      {
        action: "LOGIN",

        data: {
          Username: Username.trim(),
          Password,

          DeviceID: DeviceID.trim(),
          DeviceToken: DeviceToken.trim(),
          DeviceType: DeviceType.trim().toUpperCase(),
        },
      }
    );

    // ========================================================
    // RabbitMQ Error
    // ========================================================

    if (!response.success) {
      throw new AppError(
        response.message || "Login failed",
        response.statusCode || STATUS_CODES.UNAUTHORIZED
      );
    }

    // ========================================================
    // Response
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    handleError(error, res);
  }
};


// ============================================================Logout
exports.logout = async (req, res) => {
  try {
    return res.status(STATUS_CODES.SUCCESS).json({
      success: true,
      message: "Logout successful",
    });

  } catch (error) {
    handleError(error, res);
  }
};

// ============================================================Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { Username } = req.body || {};

    if (!Username || !String(Username).trim()) {
      throw new AppError("Username is required", STATUS_CODES.BAD_REQUEST);
    }

    const response = await producer.sendMessage(
      QUEUE.AUTH.REQUEST,
      QUEUE.AUTH.RESPONSE,
      {
        action: "FORGOT_PASSWORD",
        data: { Username: String(Username).trim() },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to process password reset request",
        response.statusCode || STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    handleError(error, res);
  }
};

// ============================================================Verify Forgot Password OTP
exports.verifyForgotPasswordOTP = async (req, res) => {
  try {
    const { OTP } = req.body || {};
    const { UserID, Username, OTPHash } = req.otpUser;

    if (OTP === undefined || OTP === null || String(OTP).trim() === "") {
      throw new AppError("OTP is required", STATUS_CODES.BAD_REQUEST);
    }

    const otp = String(OTP).trim();
    if (!/^\d{6}$/.test(otp)) {
      throw new AppError("OTP must be exactly 6 digits", STATUS_CODES.BAD_REQUEST);
    }

    const response = await producer.sendMessage(
      QUEUE.AUTH.REQUEST,
      QUEUE.AUTH.RESPONSE,
      {
        action: "VERIFY_FORGOT_PASSWORD_OTP",
        data: { UserID, Username, OTPHash, OTP: otp },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to verify OTP",
        response.statusCode || STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    handleError(error, res);
  }
};

// ============================================================Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { NewPassword } = req.body || {};
    const { UserID, Username } = req.otpUser;

    if (!NewPassword) {
      throw new AppError("New password is required", STATUS_CODES.BAD_REQUEST);
    }

    const passwordRegex =
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$#!%*?&])[A-Za-z\d@$!#%*?&]{6,}$/;
    if (!passwordRegex.test(NewPassword)) {
      throw new AppError("Password does not meet the required password policy", STATUS_CODES.BAD_REQUEST);
    }

    const response = await producer.sendMessage(
      QUEUE.AUTH.REQUEST,
      QUEUE.AUTH.RESPONSE,
      {
        action: "RESET_PASSWORD",
        data: { UserID, Username, NewPassword },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to reset password",
        response.statusCode || STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    handleError(error, res);
  }
};

// ============================================================Change Password
exports.changePassword = async (req, res) => {
  try {

    const {
      CurrentPassword,
      NewPassword,
    } = req.body;

    // ========================================================
    // JWT Middleware se UserID
    // ========================================================

    const UserID = req.user?.UserID;

    if (!UserID) {
      throw new AppError(
        "Invalid authentication token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    // ========================================================
    // Validation
    // ========================================================

    if (!CurrentPassword) {
      throw new AppError(
        "Current Password is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!NewPassword) {
      throw new AppError(
        "New Password is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Password Validation
    // ========================================================

    const passwordRegex =
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(NewPassword)) {
      throw new AppError(
        "Password must be 8+ characters with uppercase, lowercase, number & special character",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Send RabbitMQ
    // ========================================================

    const response = await producer.sendMessage(
      QUEUE.AUTH.REQUEST,
      QUEUE.AUTH.RESPONSE,
      {
        action: "CHANGE_PASSWORD",

        data: {
          UserID,

          CurrentPassword,
          NewPassword,
        },
      }
    );

    // ========================================================
    // RabbitMQ Error
    // ========================================================

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to change password",
        response.statusCode || STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Response
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {

    handleError(error, res);

  }
};


