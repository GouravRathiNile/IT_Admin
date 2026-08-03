//==================================================RabbitMq
const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
//==================================================Azur
const uploadToAzure = require("../AzurConfigration/OrganizationMaster/AzureUpload");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");
//==================================================Get Funcation from Serive


// ========================================= Create Division
exports.createDivision = async (req, res) => {
  try {

    const {
      DivisionName,
      ShortName,
      CreatedBy,
    } = req.body;

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

    const response = await producer.sendMessage(
      QUEUE.DIVISION.REQUEST,
      QUEUE.DIVISION.RESPONSE,
      {
        action: "GET_ALL_DIVISIONS",
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
// ========================================= Update Division
exports.updateDivision = async (req, res) => {
  try {

    const {
      DivisionName,
      ShortName,
      ModifiedBy,
    } = req.body;

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
          DivisionID: req.params.id,
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

    const response = await producer.sendMessage(
      QUEUE.DIVISION.REQUEST,
      QUEUE.DIVISION.RESPONSE,
      {
        action: "DELETE_DIVISION",
        data: {
          DivisionID: req.params.id,
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
// ========================================= Get Division Dropdown
exports.getDivisionDropdown = async (req, res) => {
    try {

        const response = await producer.sendMessage(
            QUEUE.DIVISION.REQUEST,
            QUEUE.DIVISION.RESPONSE,
            {
                action: "GET_DIVISION_DROPDOWN"
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

    }

    catch (error) {

        handleError(error, res);

    }

};