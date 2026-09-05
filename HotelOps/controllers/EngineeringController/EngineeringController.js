//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/Engineering/AzureUpload");
// =========================================================Get Data From service
const CapexService = require("../../services/CapexService/CapexService");


// ============================================================Queue Helper
const sendQueueResponse = async (
  req,
  res,
  action,
  data,
  successCode = STATUS_CODES.SUCCESS,
) => {
  try {
    const response = await producer.sendMessage(
      QUEUE.ENGINEERING.REQUEST,
      QUEUE.ENGINEERING.RESPONSE,
      {
        action,

        data: {
          ...data,

          // Trusted JWT Fields
          UserID: req.user.UserID,

          UserType: req.user.UserType,

          DepartmentName: req.user.DepartmentName,

          LoginType: req.user.LoginType,

          AllOrganizationAccess: req.user.AllOrganizationAccess,
        },
      },
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to process Engineering request.",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res.status(response.queued ? 202 : successCode).json(response);
  } catch (error) {
    if (
      ["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(
        error.message,
      )
    ) {
      return handleError(
        new AppError(
          "Engineering service is temporarily unavailable.",
          STATUS_CODES.SERVICE_UNAVAILABLE,
        ),
        res,
      );
    }

    return handleError(error, res);
  }
};
// ===========================================================Upload Multiple Documents Helper
const uploadDocuments = async (files = []) => {
  const documents = [];

  for (const file of files) {
    const blobName = await uploadToAzure(file);

    documents.push({
      FileName: file.originalname,

      FilePath: blobName,

      FileType: file.mimetype,

      FileSize: file.size,
    });
  }

  return documents;
};
// ============================================================CREATE Equipment
exports.createEquipment = async (req, res) => {
  try {
    const {
      OrganizationID,
      Department,
      Description,
      SerialNumber,
      TypeOfMachine,
      Capacity,
      ModelNumber,
      Make,
      Area,
      CommissioningDate,

      WarrantyStartDate,
      WarrantyEndDate,
      WarrantyStatus,

      AMCType,
      AMCStartDate,
      AMCEndDate,
      AMCStatus,
      AMCYearlyExpense,
      IsMandatoryAMC,

      ScheduleOfServicing,
      ScheduleDay,
      ResponsiblePerson,

      Status,
      Remarks,
    } = req.body || {};

    if (!OrganizationID) {
      return res.status(400).json({
        success: false,
        message: "OrganizationID is required.",
      });
    }

    if (!Description || !String(Description).trim()) {
      return res.status(400).json({
        success: false,
        message: "Description is required.",
      });
    }

    const Documents = await uploadDocuments(req.files || []);

    return sendQueueResponse(
      req,
      res,
      "CREATE_ENGINEERING_EQUIPMENT",
      {
        OrganizationID,
        Department,
        Description,
        SerialNumber,
        TypeOfMachine,
        Capacity,
        ModelNumber,
        Make,
        Area,
        CommissioningDate,

        WarrantyStartDate,
        WarrantyEndDate,
        WarrantyStatus,

        AMCType,
        AMCStartDate,
        AMCEndDate,
        AMCStatus,
        AMCYearlyExpense,
        IsMandatoryAMC,

        ScheduleOfServicing,
        ScheduleDay,
        ResponsiblePerson,

        Status,
        Remarks,

        Documents,
      },
      STATUS_CODES.CREATED,
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ Equipment LIST
exports.getAllEquipment = async (req, res) => {
  return sendQueueResponse(req, res, "GET_ENGINEERING_EQUIPMENT_LIST", {
    OrganizationID: req.query.OrganizationID || null,

    Department: req.query.Department || null,

    Status: req.query.Status || null,

    Search: req.query.Search || null,

    page: Number(req.query.page) || 1,

    PageSize: Number(req.query.PageSize) || 10,
  });
};
// ============================================================GET Equipment BY ID
exports.getEquipmentById = async (req, res) => {
  return sendQueueResponse(req, res, "GET_ENGINEERING_EQUIPMENT_BY_ID", {
    EquipmentID: req.params.id,

    OrganizationID: req.query.OrganizationID || null,
  });
};
// ============================================================UPDATE Equipment
exports.updateEquipment = async (req, res) => {
  try {
    const Documents = await uploadDocuments(req.files || []);

    let DeleteDocumentIDs = req.body?.DeleteDocumentIDs || [];

    if (typeof DeleteDocumentIDs === "string") {
      try {
        DeleteDocumentIDs = JSON.parse(DeleteDocumentIDs);
      } catch {
        DeleteDocumentIDs = DeleteDocumentIDs.split(",")
          .map(Number)
          .filter(Boolean);
      }
    }

    const Changes = {
      ...req.body,
    };

    delete Changes.DeleteDocumentIDs;

    return sendQueueResponse(req, res, "UPDATE_ENGINEERING_EQUIPMENT", {
      EquipmentID: req.params.id,

      OrganizationID: req.body.OrganizationID,

      Changes,

      Documents,

      DeleteDocumentIDs,
    });
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================DELETE Equipment
exports.deleteEquipment = async (req, res) => {
  return sendQueueResponse(req, res, "DELETE_ENGINEERING_EQUIPMENT", {
    EquipmentID: req.params.id,

    OrganizationID: req.body?.OrganizationID || req.query?.OrganizationID,
  });
};
