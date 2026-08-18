//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/ITAdmin/UserMaster/AzureUpload");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Get Funcation from Serive
const UserService = require("../../services/ITAdminService/UserService");

// ========================================= Create User
exports.createUser = async (req, res) => {
  try {
    const {
      EmployeeCode,
      Username,
      PasswordHash,
      FullName,
      Designation,
      DepartmentID,
      DivisionID,
      LoginType,
      UserType,
      Email,
      PhoneNumber,
      Gender,
      LastPasswordChangedDate,
      PasswordExpiryDate,
      DateOfJoining,
      CreatedBy,
      BrandID,
      AllOrganizationAccess,
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

    if (
      LoginType === "SuperAdmin" &&
      AllOrganizationAccess === undefined
    ) {
      throw new AppError(
        "AllOrganizationAccess is required for SuperAdmin",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const normalizedAllOrganizationAccess =
      String(AllOrganizationAccess).toLowerCase() === "true";

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

    // ========================================================
    // LOGIN TYPE VALIDATION
    // ========================================================

    if (
      !["SuperAdmin", "Organization", "Brand"].includes(LoginType)
    ) {
      throw new AppError(
        "LoginType must be SuperAdmin, Organization or Brand",
        STATUS_CODES.BAD_REQUEST
      );
    }


    // ========================================================
    // SUPER ADMIN
    // ========================================================

    if (LoginType === "SuperAdmin") {

      if (AllOrganizationAccess === undefined) {
        throw new AppError(
          "AllOrganizationAccess is required for SuperAdmin",
          STATUS_CODES.BAD_REQUEST
        );
      }

      // ALL ORGANIZATIONS
      if (normalizedAllOrganizationAccess === true) {

        if (
          Array.isArray(organizationMappings) &&
          organizationMappings.length > 0
        ) {
          throw new AppError(
            "Organizations should not be provided when AllOrganizationAccess is true",
            STATUS_CODES.BAD_REQUEST
          );
        }

      }

      // SELECTED ORGANIZATIONS
      else {

        if (
          !Array.isArray(organizationMappings) ||
          organizationMappings.length === 0
        ) {
          throw new AppError(
            "At least one organization is required for limited SuperAdmin access",
            STATUS_CODES.BAD_REQUEST
          );
        }
      }

      if (BrandID) {
        throw new AppError(
          "BrandID should not be provided for SuperAdmin",
          STATUS_CODES.BAD_REQUEST
        );
      }
    }


    // ========================================================
    // ORGANIZATION
    // ========================================================

    if (LoginType === "Organization") {

      if (BrandID) {
        throw new AppError(
          "BrandID should not be provided for Organization login",
          STATUS_CODES.BAD_REQUEST
        );
      }

      if (
        !Array.isArray(organizationMappings) ||
        organizationMappings.length !== 1
      ) {
        throw new AppError(
          "Organization user must have exactly one organization",
          STATUS_CODES.BAD_REQUEST
        );
      }
    }


    // ========================================================
    // BRAND
    // ========================================================

    if (LoginType === "Brand") {

      if (!BrandID) {
        throw new AppError(
          "BrandID is required for Brand login",
          STATUS_CODES.BAD_REQUEST
        );
      }

      if (
        !Array.isArray(organizationMappings) ||
        organizationMappings.length === 0
      ) {
        throw new AppError(
          "At least one organization is required for Brand login",
          STATUS_CODES.BAD_REQUEST
        );
      }
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
          DepartmentID,
          DivisionID,
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
          BrandID,
          AllOrganizationAccess: normalizedAllOrganizationAccess,
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
// ============================================================
// DELETE USER
// ============================================================
exports.deleteUser = async (req, res) => {

  try {

    // ========================================================
    // USER ID FROM BODY
    // ========================================================

    const UserID = req.body?.UserID;

    if (!UserID) {

      throw new AppError(
        "UserID is required",
        STATUS_CODES.BAD_REQUEST
      );

    }


    // ========================================================
    // DELETED BY FROM JWT
    // ========================================================

    const DeletedBy =
      req.user?.UserID || UserID;


    // ========================================================
    // SEND TO RABBITMQ
    // ========================================================

    const response =
      await producer.sendMessage(
        QUEUE.USER.REQUEST,
        QUEUE.USER.RESPONSE,
        {

          action: "DELETE_USER",

          data: {

            UserID: Number(UserID),

            DeletedBy: Number(DeletedBy)

          }

        }
      );


    // ========================================================
    // ERROR
    // ========================================================

    if (!response.success) {

      throw new AppError(

        response.message ||
        "Unable to delete user",

        response.statusCode ||
        STATUS_CODES.BAD_REQUEST

      );

    }


    // ========================================================
    // RESPONSE
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);


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
        STATUS_CODES.BAD_REQUEST,
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
      throw new AppError("User ID is required", STATUS_CODES.BAD_REQUEST);
    }

    const response = await UserService.getUserById({
      UserID: id,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch user",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
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
        STATUS_CODES.BAD_REQUEST,
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    handleError(error, res);
  }
};
// =========================================User wise Organization
exports.getUserOrganizations = async (req, res) => {

  try {

    // JWT middleware se UserID
    const UserID = req.user.UserID;

    if (!UserID) {

      throw new AppError(
        "User ID not found in token",
        STATUS_CODES.UNAUTHORIZED
      );

    }

    const response =
      await UserService.getUserOrganizations(UserID);


    if (!response.success) {

      throw new AppError(
        response.message ||
        "Unable to fetch organizations",
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
// =========================================User wise product
exports.getUserProducts = async (req, res) => {

  try {

    // JWT se UserID
    const UserID = req.user.UserID;


    if (!UserID) {

      throw new AppError(
        "User ID not found in token",
        STATUS_CODES.UNAUTHORIZED
      );

    }


    const response =
      await UserService.getUserProducts(UserID);


    if (!response.success) {

      throw new AppError(
        response.message ||
        "Unable to fetch user products",

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
// ============================================================
// GET USER PERSONAL DETAILS
// ============================================================
exports.getUserPersonalDetails = async (req, res) => {

  try {

    // ========================================================
    // USER ID FROM JWT
    // ========================================================

    const UserID = req.user?.UserID;

    if (!UserID) {

      throw new AppError(
        "User ID not found in token",
        STATUS_CODES.UNAUTHORIZED
      );

    }


    // ========================================================
    // SERVICE
    // ========================================================

    const response =
      await UserService.getUserPersonalDetails(
        Number(UserID)
      );


    // ========================================================
    // ERROR
    // ========================================================

    if (!response.success) {

      throw new AppError(
        response.message ||
        "Unable to fetch user personal details",

        response.statusCode ||
        STATUS_CODES.BAD_REQUEST
      );

    }


    // ========================================================
    // RESPONSE
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {

    handleError(error, res);

  }

};
// ============================================================
// UPDATE USER PERSONAL DETAILS
// ============================================================
exports.updateUserPersonalDetails = async (req, res) => {

  try {

    // ========================================================
    // 1. USER ID FROM JWT
    // ========================================================

    const UserID = req.user?.UserID;

    if (!UserID) {

      throw new AppError(
        "User ID not found in token",
        STATUS_CODES.UNAUTHORIZED
      );

    }


    // ========================================================
    // 2. MODIFIED BY FROM JWT
    // ========================================================

    const ModifiedBy = req.user?.UserID;


    // ========================================================
    // 3. PROFILE PHOTO
    // ========================================================

    let ProfilePhoto;

    if (req.file) {

      ProfilePhoto =
        await uploadToAzure(req.file);

    }


    // ========================================================
    // 4. REQUEST BODY
    // ========================================================

    const {

      EmployeeCode,
      Username,
      FullName,

      Designation,

      DepartmentID,
      DivisionID,

      Email,
      PhoneNumber,
      Gender,

      DateOfJoining,

      IsLocked,
      IsActive,

    } = req.body;


    // ========================================================
    // 5. BASIC VALIDATION
    // ========================================================

    if (
      DepartmentID !== undefined &&
      DepartmentID !== null &&
      DepartmentID !== "" &&
      isNaN(Number(DepartmentID))
    ) {

      throw new AppError(
        "DepartmentID must be a valid number",
        STATUS_CODES.BAD_REQUEST
      );

    }


    if (
      DivisionID !== undefined &&
      DivisionID !== null &&
      DivisionID !== "" &&
      isNaN(Number(DivisionID))
    ) {

      throw new AppError(
        "DivisionID must be a valid number",
        STATUS_CODES.BAD_REQUEST
      );

    }


    // ========================================================
    // 6. SEND TO RABBITMQ
    // ========================================================

    const response =
      await producer.sendMessage(

        QUEUE.USER.REQUEST,

        QUEUE.USER.RESPONSE,

        {

          action:
            "UPDATE_USER_PERSONAL_DETAILS",

          data: {

            UserID:
              Number(UserID),

            EmployeeCode,
            Username,
            FullName,

            Designation,

            DepartmentID:
              DepartmentID !== undefined &&
              DepartmentID !== ""
                ? Number(DepartmentID)
                : undefined,

            DivisionID:
              DivisionID !== undefined &&
              DivisionID !== ""
                ? Number(DivisionID)
                : undefined,

            Email,
            PhoneNumber,
            Gender,

            ...(ProfilePhoto !== undefined && {
              ProfilePhoto
            }),

            DateOfJoining,

            IsLocked:
              IsLocked !== undefined
                ? (
                    typeof IsLocked === "string"
                      ? IsLocked.toLowerCase() === "true"
                      : IsLocked
                  )
                : undefined,

            IsActive:
              IsActive !== undefined
                ? (
                    typeof IsActive === "string"
                      ? IsActive.toLowerCase() === "true"
                      : IsActive
                  )
                : undefined,

            ModifiedBy:
              Number(ModifiedBy),

          }

        }

      );


    // ========================================================
    // 7. RABBITMQ ERROR
    // ========================================================

    if (!response.success) {

      throw new AppError(

        response.message ||
        "Unable to update user personal details",

        response.statusCode ||
        STATUS_CODES.BAD_REQUEST

      );

    }


    // ========================================================
    // 8. RESPONSE
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);


  } catch (error) {

    handleError(error, res);

  }

};
// =========================================Get All Users Tabel
exports.getAllUsersTabel = async (req, res) => {
  try {
    const response = await UserService.getAllUsersTabel();

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch users",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    handleError(error, res);
  }
};
// ============================================================
// UPDATE USER
// ============================================================
exports.updateUser = async (req, res) => {

  try {

    // ========================================================
    // USER ID FROM BODY
    // ========================================================

    const UserID = req.body?.UserID;

    if (!UserID) {

      throw new AppError(
        "UserID is required",
        STATUS_CODES.BAD_REQUEST
      );

    }

    // ========================================================
    // ORGANIZATIONS + PRODUCTS
    // ========================================================

    const {
      Organizations,
      Products,
      ...userData
    } = req.body;


    // ========================================================
    // PROFILE PHOTO
    // ========================================================

    let ProfilePhoto;

    if (req.file) {

      ProfilePhoto =
        await uploadToAzure(req.file);

    }


    // ========================================================
    // PARSE ORGANIZATIONS
    // ========================================================

    let organizationMappings = [];

    if (Organizations) {

      organizationMappings =
        typeof Organizations === "string"
          ? JSON.parse(Organizations)
          : Organizations;

    }


    // ========================================================
    // PARSE PRODUCTS
    // ========================================================

    let productMappings = [];

    if (Products) {

      productMappings =
        typeof Products === "string"
          ? JSON.parse(Products)
          : Products;

    }


    // ========================================================
    // SEND TO RABBITMQ
    // ========================================================

    const response =
      await producer.sendMessage(
        QUEUE.USER.REQUEST,
        QUEUE.USER.RESPONSE,
        {

          action: "UPDATE_USER",

          data: {

            UserID: Number(UserID),

            ...userData,

            ...(ProfilePhoto !== undefined && {
              ProfilePhoto
            }),

            Organizations:
              organizationMappings,

            Products:
              productMappings,

            // ModifiedBy JWT se
            ModifiedBy:
              Number(req.user?.UserID || UserID)

          }

        }
      );


    // ========================================================
    // ERROR
    // ========================================================

    if (!response.success) {

      throw new AppError(

        response.message ||
        "Unable to update user",

        response.statusCode ||
        STATUS_CODES.BAD_REQUEST

      );

    }


    // ========================================================
    // RESPONSE
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);


  } catch (error) {

    handleError(error, res);

  }

};
// ============================================================UPDATE USER PERSONAL DETAILS
exports.updateUserPersonalDetails = async (req, res) => {
  try {

    // ========================================================
    // Get UserID From JWT
    // ========================================================

    const UserID = req.user?.UserID;

    if (!UserID) {
      throw new AppError(
        "User ID not found in token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    // ========================================================
    // ModifiedBy From JWT
    // ========================================================

    const ModifiedBy = req.user.UserID;

    // ========================================================
    // Profile Photo
    // ========================================================

    let ProfilePhoto;

    if (req.file) {
      ProfilePhoto = await uploadToAzure(req.file);
    }

    // ========================================================
    // Send To RabbitMQ
    // ========================================================

    const response = await producer.sendMessage(
      QUEUE.USER.REQUEST,
      QUEUE.USER.RESPONSE,
      {
        action: "UPDATE_USER_PERSONAL_DETAILS",

        data: {
          UserID: Number(UserID),

          ...req.body,

          ...(ProfilePhoto !== undefined && {
            ProfilePhoto,
          }),

          ModifiedBy: Number(ModifiedBy),
        },
      }
    );

    // ========================================================
    // RabbitMQ Error
    // ========================================================

    if (!response.success) {
      throw new AppError(
        response.message ||
        "Unable to update user personal details",

        response.statusCode ||
        STATUS_CODES.BAD_REQUEST
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
// ============================================================
// UPDATE USER ORGANIZATIONS
// ============================================================
exports.updateUserOrganizations = async (req, res) => {

  try {

    // ========================================================
    // 1. USER ID FROM JWT
    // ========================================================

    const UserID = req.user?.UserID;

    if (!UserID) {

      throw new AppError(
        "User ID not found in token",
        STATUS_CODES.UNAUTHORIZED
      );

    }


    // ========================================================
    // 2. REQUEST DATA
    // ========================================================

    const {
      Organizations,
      AllOrganizationAccess
    } = req.body;


    // ========================================================
    // 3. VALIDATE ORGANIZATIONS
    // ========================================================

    if (!Array.isArray(Organizations)) {

      throw new AppError(
        "Organizations must be an array",
        STATUS_CODES.BAD_REQUEST
      );

    }


    // ========================================================
    // 4. NORMALIZE ALL ORGANIZATION ACCESS
    // ========================================================

    let normalizedAllOrganizationAccess =
      AllOrganizationAccess;


    if (
      typeof normalizedAllOrganizationAccess === "string"
    ) {

      normalizedAllOrganizationAccess =
        normalizedAllOrganizationAccess.toLowerCase() === "true";

    }


    // ========================================================
    // 5. VALIDATE VALUE
    // ========================================================

    if (
      normalizedAllOrganizationAccess !== true &&
      normalizedAllOrganizationAccess !== false &&
      normalizedAllOrganizationAccess !== undefined
    ) {

      throw new AppError(
        "AllOrganizationAccess must be true or false",
        STATUS_CODES.BAD_REQUEST
      );

    }


    // ========================================================
    // 6. MODIFIED BY FROM JWT
    // ========================================================

    const ModifiedBy =
      req.user?.UserID;


    // ========================================================
    // 7. SEND TO RABBITMQ
    // ========================================================

    const response =
      await producer.sendMessage(

        QUEUE.USER.REQUEST,

        QUEUE.USER.RESPONSE,

        {

          action:
            "UPDATE_USER_ORGANIZATIONS",

          data: {

            UserID:
              Number(UserID),

            Organizations,

            AllOrganizationAccess:
              normalizedAllOrganizationAccess,

            ModifiedBy:
              Number(ModifiedBy),

          }

        }

      );


    // ========================================================
    // 8. RABBITMQ ERROR
    // ========================================================

    if (!response.success) {

      throw new AppError(

        response.message ||
        "Unable to update user organizations",

        response.statusCode ||
        STATUS_CODES.BAD_REQUEST

      );

    }


    // ========================================================
    // 9. RESPONSE
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);


  } catch (error) {

    handleError(error, res);

  }

};
// ============================================================UPDATE USER PRODUCTS
exports.updateUserProducts = async (req, res) => {
  try {
    // ========================================================
    // UserID JWT se
    // ========================================================

    const UserID = req.user?.UserID;

    if (!UserID) {
      throw new AppError(
        "User ID not found in token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    // ========================================================
    // Products
    // ========================================================

    const { Products } = req.body;

    if (!Array.isArray(Products)) {
      throw new AppError(
        "Products must be an array",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // ModifiedBy JWT se
    // ========================================================

    const ModifiedBy = req.user?.UserID;

    // ========================================================
    // Send to RabbitMQ
    // ========================================================

    const response = await producer.sendMessage(
      QUEUE.USER.REQUEST,
      QUEUE.USER.RESPONSE,
      {
        action: "UPDATE_USER_PRODUCTS",

        data: {
          UserID: Number(UserID),
          Products,
          ModifiedBy: Number(ModifiedBy),
        },
      }
    );

    // ========================================================
    // RabbitMQ Response Error
    // ========================================================

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to update user products",
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

module.exports = exports;
