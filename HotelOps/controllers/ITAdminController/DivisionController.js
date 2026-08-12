//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Get Funcation from Service
const DivisionService = require("../../services/ITAdminService/DivisionService");

// ========================================= Create Division
exports.createDivision = async (req, res) => {
  try {

    const {
      DivisionName,
      ShortName,
    } = req.body;
    const CreatedBy = req.user.UserID;

    if (!DivisionName) {
      throw new AppError(
        "Division Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!ShortName) {
      throw new AppError(
        "Short Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.DIVISION.REQUEST,
      QUEUE.DIVISION.RESPONSE,
      {
        action: "CREATE_DIVISION",
        data: {
          DivisionName,
          ShortName,
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
// ========================================= Get All Divisions
exports.getAllDivisions = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.PageSize || 10);
    const { DivisionName } = req.query;

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

    const divisionNameFilter = typeof DivisionName === "string"
      ? DivisionName.trim()
      : "";

    const currentPage = divisionNameFilter ? 1 : page;
    const response = await DivisionService.getAllDivisions(
      currentPage,
      divisionNameFilter,
      pageSize
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch divisions",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    handleError(error, res);
  }
};
// ========================================= Update Division
exports.updateDivision = async (req, res) => {
  try {

    const {
      DivisionID,
      DivisionName,
      ShortName,
    } = req.body;
    const ModifiedBy = req.user.UserID;

    if (!DivisionID) {
      throw new AppError(
        "Division ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!DivisionName) {
      throw new AppError(
        "Division Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!ShortName) {
      throw new AppError(
        "Short Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.DIVISION.REQUEST,
      QUEUE.DIVISION.RESPONSE,
      {
        action: "UPDATE_DIVISION",
        data: {
          DivisionID,
          DivisionName,
          ShortName,
          ModifiedBy,
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
// ========================================= Delete Division
exports.deleteDivision = async (req, res) => {
  try {
    const { DivisionID } = req.body;

    if (!DivisionID) {
      throw new AppError(
        "Division ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.DIVISION.REQUEST,
      QUEUE.DIVISION.RESPONSE,
      {
        action: "DELETE_DIVISION",
        data: {
          DivisionID,
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
// ========================================= Get Division Dropdown
exports.getDivisionsDropdown = async (req, res) => {
  try {


    const response = await DivisionService.getDivisionDropdown();

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch divisions",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    handleError(error, res);
  }
};
