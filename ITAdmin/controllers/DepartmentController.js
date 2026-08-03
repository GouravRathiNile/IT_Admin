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
      CreatedBy,
    } = req.body;

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

    const response =
      await DepartmentService.getAllDepartments();

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

    const response = await producer.sendMessage(
      QUEUE.DEPARTMENT.REQUEST,
      QUEUE.DEPARTMENT.RESPONSE,
      {
        action: "UPDATE_DEPARTMENT",
        data: {
          DepartmentID: req.params.id,
          ...req.body,
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

    const response = await producer.sendMessage(
      QUEUE.DEPARTMENT.REQUEST,
      QUEUE.DEPARTMENT.RESPONSE,
      {
        action: "DELETE_DEPARTMENT",
        data: {
          DepartmentID: req.params.id,
          DeletedBy: req.body.DeletedBy,
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