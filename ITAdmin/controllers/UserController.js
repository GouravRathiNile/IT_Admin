//==================================================RabbitMq
const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
//==================================================Azur
const uploadToAzure = require("../AzurConfigration/UserMaster/AzureUpload");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");
//==================================================Get Funcation from Serive
const UserService = require("../services/UserService");

// ========================================= Create User
exports.createUser = async (req, res) => {
  try {
    const {
      EmployeeCode,
      Username,
      PasswordHash,
      FullName,
      Designation,
      Department,
      Division,
      LoginType,
      UserType,
      Email,
      PhoneNumber,
      Gender,
      LastPasswordChangedDate,
      PasswordExpiryDate,
      DateOfJoining,
      CreatedBy,
      Organizations,
      Products,
    } = req.body;
    // ========================================= Validation

    if (!Username) {
      throw new AppError("Username is required", STATUS_CODES.BAD_REQUEST);
    }

    if (!PasswordHash) {
      throw new AppError("Password is required", STATUS_CODES.BAD_REQUEST);
    }

    const passwordRegex =
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$#!%*?&])[A-Za-z\d@$!#%*?&]{6,}$/;

    if (!passwordRegex.test(PasswordHash)) {
      throw new AppError(
        "Password must be 6+ characters with uppercase, lowercase, number & special character",
        STATUS_CODES.BAD_REQUEST,
      );
    }
    if (!FullName) {
      throw new AppError("Full Name is required", STATUS_CODES.BAD_REQUEST);
    }

    if (!LoginType) {
      throw new AppError("Login Type is required", STATUS_CODES.BAD_REQUEST);
    }

    // ========================================= Profile Photo Upload
    let ProfilePhoto = null;

    if (req.file) {
      ProfilePhoto = await uploadToAzure(req.file);
    }

    // ========================================= Parse Mapping Data
    let organizationMappings = [];
    let productMappings = [];

    if (Organizations) {
      organizationMappings =
        typeof Organizations === "string"
          ? JSON.parse(Organizations)
          : Organizations;
    }

    if (Products) {
      productMappings =
        typeof Products === "string" ? JSON.parse(Products) : Products;
    }

    // ========================================= Send To RabbitMQ
    const response = await producer.sendMessage(
      QUEUE.USER.REQUEST,
      QUEUE.USER.RESPONSE,
      {
        action: "CREATE_USER",

        data: {
          EmployeeCode,
          Username,
          PasswordHash,
          FullName,
          Designation,
          Department,
          Division,
          LoginType,
          UserType,
          Email,
          PhoneNumber,
          Gender,
          ProfilePhoto,
          LastPasswordChangedDate,
          PasswordExpiryDate,
          DateOfJoining,
          IsLocked: false,
          IsActive: true,
          IsDeleted: false,
          CreatedBy,
          Organizations: organizationMappings,
          Products: productMappings,
        },
      },
    );
    // ========================================= RabbitMQ Error
    if (!response.success) {
      throw new AppError(
        response.message || "Unable to create user",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
      );
    }
    // ========================================= Response
    return res.status(STATUS_CODES.CREATED).json(response);
  } catch (error) {
    handleError(error, res);
  }
};
// ========================================= Delete User
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const { DeletedBy } = req.body;

    if (!id) {
      throw new AppError("User ID is required", STATUS_CODES.BAD_REQUEST);
    }

    const response = await producer.sendMessage(
      QUEUE.USER.REQUEST,
      QUEUE.USER.RESPONSE,
      {
        action: "DELETE_USER",

        data: {
          UserID: id,
          DeletedBy,
        },
      },
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to delete user",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    handleError(error, res);
  }
};
// ========================================= Update User
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new AppError("User ID is required", STATUS_CODES.BAD_REQUEST);
    }

    const { Organizations, Products, ...userData } = req.body;

    // ========================================= Profile Photo

    let ProfilePhoto;

    if (req.file) {
      ProfilePhoto = await uploadToAzure(req.file);
    }

    // ========================================= Parse Organizations

    let organizationMappings = [];

    if (Organizations) {
      organizationMappings =
        typeof Organizations === "string"
          ? JSON.parse(Organizations)
          : Organizations;
    }

    // ========================================= Parse Products

    let productMappings = [];

    if (Products) {
      productMappings =
        typeof Products === "string" ? JSON.parse(Products) : Products;
    }

    // ========================================= Send Update

    const response = await producer.sendMessage(
      QUEUE.USER.REQUEST,
      QUEUE.USER.RESPONSE,
      {
        action: "UPDATE_USER",

        data: {
          UserID: id,

          ...userData,

          ...(ProfilePhoto !== undefined && {
            ProfilePhoto,
          }),

          Organizations: organizationMappings,
          Products: productMappings,
        },
      },
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to update user",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    handleError(error, res);
  }
};
// ========================================= Get All Users
exports.getAllUsers = async (req, res) => {
  try {


    const response = await UserService.getAllUsers();

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch users",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    handleError(error, res);
  }
};
// ========================================= Get User By ID
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new AppError(
        "User ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await UserService.getUserById({
      UserID: id,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch user",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    handleError(error, res);
  }
};
// =========================================Get User Dropdown
exports.getUserDropdown = async (req, res) => {
  try {
    const response = await UserService.getUserDropdown();

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch users",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    handleError(error, res);
  }
};

module.exports = exports;
