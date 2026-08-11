//==================================================RabbitMq
const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");
//==================================================Get Funcation from Service
const DepartmentService = require("../services/DepartmentService");

// ========================================= Create Department
exports.createDepartment = async (req, res) => {
  try {

    const {
      DepartmentName,
      DepartmentShortName,
      OrganizationID,
      DivisionID,
    } = req.body;
    const CreatedBy = req.user.UserID;

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
          CreatedBy,
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
    const { OrganizationID, DivisionID, DepartmentName } = req.query;

    if (!Number.isInteger(page) || page < 1) {
      throw new AppError(
        "Page must be a positive integer",
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

    if (
      DepartmentName !== undefined
      && (typeof DepartmentName !== "string" || !DepartmentName.trim())
    ) {
      throw new AppError(
        "Department Name cannot be empty",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const currentPage = OrganizationID || DivisionID || DepartmentName
      ? 1
      : page;

    const response =
      await DepartmentService.getAllDepartments(
        currentPage,
        OrganizationID,
        DivisionID,
        DepartmentName?.trim()
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

    const response =
      await DepartmentService.getDepartmentsDropdown();

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
        action: "UPDATE_DEPARTMENT",
        data: {
          ...req.body,
          DepartmentID,
          ModifiedBy: req.user.UserID,
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
