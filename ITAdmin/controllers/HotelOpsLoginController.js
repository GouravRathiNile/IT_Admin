const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");

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




