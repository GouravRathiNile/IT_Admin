//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Get Funcation from Service
const DepartmentService = require("../../services/ITAdminService/DepartmentService");

// ========================================= Create Department
exports.createDepartment = async (req, res) => {
  try {

    const {
      DepartmentName,
      DepartmentShortName,
      OrganizationID,
      DivisionID,
      Products,
    } = req.body;

    const CreatedBy = req.user.UserID;

    // =========================================
    // BASIC VALIDATION
    // =========================================

    if (!DepartmentName) {
      throw new AppError(
        "Department Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!DepartmentShortName) {
      throw new AppError(
        "Department Short Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!OrganizationID) {
      throw new AppError(
        "Organization is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!DivisionID) {
      throw new AppError(
        "Division is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // =========================================
    // PRODUCTS
    // Only ProductID will come from request
    // =========================================

    let productMappings = [];

    if (Products !== undefined) {

      try {

        productMappings =
          typeof Products === "string"
            ? JSON.parse(Products)
            : Products;

      } catch (error) {

        throw new AppError(
          "Invalid Products JSON",
          STATUS_CODES.BAD_REQUEST
        );

      }

      // Products must be array
      if (!Array.isArray(productMappings)) {

        throw new AppError(
          "Products must be an array",
          STATUS_CODES.BAD_REQUEST
        );

      }

      // ProductID required
      for (const product of productMappings) {

        if (
          !product ||
          !product.ProductID
        ) {

          throw new AppError(
            "ProductID is required for every product",
            STATUS_CODES.BAD_REQUEST
          );

        }

      }

    }

    // =========================================
    // SEND TO RABBITMQ
    // =========================================

    const response = await producer.sendMessage(
      QUEUE.DEPARTMENT.REQUEST,
      QUEUE.DEPARTMENT.RESPONSE,
      {
        action: "CREATE_DEPARTMENT",

        data: {

          DepartmentName,
          DepartmentShortName,
          OrganizationID,
          DivisionID,

          Products:
            productMappings,

          CreatedBy,
        },
      }
    );

    // =========================================
    // RABBITMQ ERROR
    // =========================================

    if (!response.success) {

      throw new AppError(
        response.message,
        STATUS_CODES.BAD_REQUEST
      );

    }

    // =========================================
    // RESPONSE
    // =========================================

    return res
      .status(STATUS_CODES.CREATED)
      .json(response);

  } catch (error) {

    handleError(error, res);

  }
};
// ========================================= Get All Departments
exports.getAllDepartments = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.PageSize || 10);
    const { OrganizationID, DivisionID, DepartmentName } = req.query;

    if (!Number.isInteger(page) || page < 1) {
      throw new AppError(
        "Page must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new AppError(
        "Page Size must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const isPositiveInteger = (value) => /^\d+$/.test(value) && Number(value) > 0;

    if (OrganizationID && !isPositiveInteger(OrganizationID)) {
      throw new AppError(
        "Organization ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (DivisionID && !isPositiveInteger(DivisionID)) {
      throw new AppError(
        "Division ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const departmentNameFilter = typeof DepartmentName === "string"
      ? DepartmentName.trim()
      : "";

    const currentPage = OrganizationID || DivisionID || departmentNameFilter
      ? 1
      : page;

    const response =
      await DepartmentService.getAllDepartments(
        currentPage,
        OrganizationID,
        DivisionID,
        departmentNameFilter,
        pageSize
      );

    if (!response.success) {

      throw new AppError(
        response.message,
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
// ========================================= Get Departments Dropdown
exports.getDepartmentsDropdown = async (req, res) => {

  try {
    const { OrganizationID, DivisionID } = req.query;
    const isPositiveInteger = (value) => /^\d+$/.test(value) && Number(value) > 0;

    if (OrganizationID && !isPositiveInteger(OrganizationID)) {
      throw new AppError(
        "Organization ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (DivisionID && !isPositiveInteger(DivisionID)) {
      throw new AppError(
        "Division ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response =
      await DepartmentService.getDepartmentsDropdown(
        OrganizationID,
        DivisionID
      );

    if (!response.success) {

      throw new AppError(
        response.message,
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
// ========================================= Update Department
exports.updateDepartment = async (req, res) => {

  try {

    const {
      DepartmentID,
      DepartmentName,
      DepartmentShortName,
      OrganizationID,
      DivisionID,
      Products,
    } = req.body;


    // ========================================================
    // DEPARTMENT ID
    // ========================================================

    if (!DepartmentID) {

      throw new AppError(
        "Department ID is required",
        STATUS_CODES.BAD_REQUEST
      );

    }


    // ========================================================
    // PRODUCTS
    // ========================================================

    let productMappings = [];

    if (Products !== undefined) {

      try {

        productMappings =
          typeof Products === "string"
            ? JSON.parse(Products)
            : Products;

      } catch (error) {

        throw new AppError(
          "Invalid Products JSON",
          STATUS_CODES.BAD_REQUEST
        );

      }


      if (!Array.isArray(productMappings)) {

        throw new AppError(
          "Products must be an array",
          STATUS_CODES.BAD_REQUEST
        );

      }


      // ======================================================
      // PRODUCT ID VALIDATION
      // ======================================================

      for (const product of productMappings) {

        if (
          !product ||
          !product.ProductID
        ) {

          throw new AppError(
            "ProductID is required for every product",
            STATUS_CODES.BAD_REQUEST
          );

        }

      }

    }


    // ========================================================
    // SEND TO RABBITMQ
    // ========================================================

    const response =
      await producer.sendMessage(
        QUEUE.DEPARTMENT.REQUEST,
        QUEUE.DEPARTMENT.RESPONSE,
        {

          action: "UPDATE_DEPARTMENT",

          data: {

            DepartmentID,

            DepartmentName,
            DepartmentShortName,
            OrganizationID,
            DivisionID,

            Products:
              productMappings,

            ModifiedBy:
              req.user.UserID,

          },

        }
      );


    // ========================================================
    // ERROR
    // ========================================================

    if (!response.success) {

      throw new AppError(
        response.message,
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
// ========================================= Delete Department
exports.deleteDepartment = async (req, res) => {
  try {
    const { DepartmentID } = req.body;

    if (!DepartmentID) {
      throw new AppError(
        "Department ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.DEPARTMENT.REQUEST,
      QUEUE.DEPARTMENT.RESPONSE,
      {
        action: "DELETE_DEPARTMENT",
        data: {
          DepartmentID,
          DeletedBy: req.user.UserID,
        },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message,
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
// GET DEPARTMENT WISE PRODUCTS
// ============================================================
exports.getDepartmentWiseProducts = async (req, res) => {

  try {

    const { DepartmentID } = req.query;

    const response =
      await DepartmentService.getDepartmentWiseProducts(
        DepartmentID
      );


    if (!response.success) {

      throw new AppError(
        response.message ||
        "Unable to fetch department products",
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