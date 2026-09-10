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
const EngineeringService = require("../../services/EngineeringService/EngineeringService",);

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
// ============================================================================================Equipment Entries
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
      DepartmentID,
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

      Remarks,
    } = req.body || {};

    // ============================================================
    // Required Fields
    // ============================================================

    if (!OrganizationID) {
      return res.status(400).json({
        success: false,
        message: "OrganizationID is required.",
      });
    }

    if (!DepartmentID) {
      return res.status(400).json({
        success: false,
        message: "DepartmentID is required.",
      });
    }

    if (!Description || !String(Description).trim()) {
      return res.status(400).json({
        success: false,
        message: "Equipment Name is required.",
      });
    }

    if (!SerialNumber || !String(SerialNumber).trim()) {
      return res.status(400).json({
        success: false,
        message: "SerialNumber is required.",
      });
    }

    if (!Area || !String(Area).trim()) {
      return res.status(400).json({
        success: false,
        message: "Area is required.",
      });
    }

    // ============================================================
    // Upload Documents
    // ============================================================

    const Documents = await uploadDocuments(req.files || []);

    // ============================================================
    // RabbitMQ
    // ============================================================

    return sendQueueResponse(
      req,
      res,
      "CREATE_ENGINEERING_EQUIPMENT",
      {
        OrganizationID,
        DepartmentID,
        Description: String(Description).trim(),
        SerialNumber: String(SerialNumber).trim(),
        TypeOfMachine,
        Capacity,
        ModelNumber,
        Make,
        Area: String(Area).trim(),
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
  try {
    const result = await EngineeringService.getAllEquipment({
      OrganizationID: req.query.OrganizationID || null,

      DepartmentID: req.query.DepartmentID || req.query.Department || null,
      Status: req.query.Status || null,

      WarrantyStatus: req.query.WarrantyStatus || null,
      AMCStatus: req.query.AMCStatus || null,

      SerialNo: req.query.SerialNo || null,
      Area: req.query.Area || null,
      Equipment: req.query.Equipment || null,

      Search: req.query.Search || null,

      page: Number(req.query.page) || 1,
      PageSize: Number(req.query.PageSize) || 10,
    });

    return res
      .status(result.statusCode || (result.success ? 200 : 400))
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================GET Equipment BY ID
exports.getEquipmentById = async (req, res) => {
  try {
    const result = await EngineeringService.getEquipmentById({
      EquipmentID: req.params.id,
    });

    return res
      .status(result.statusCode || (result.success ? 200 : 400))
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================UPDATE Equipment
exports.updateEquipment = async (req, res) => {
  try {
    const Documents = await uploadDocuments(
      req.files || [],
    );

    let DeleteDocumentIDs =
      req.body?.DeleteDocumentIDs || [];

    if (typeof DeleteDocumentIDs === "string") {
      try {
        DeleteDocumentIDs = JSON.parse(
          DeleteDocumentIDs,
        );
      } catch {
        DeleteDocumentIDs =
          DeleteDocumentIDs
            .split(",")
            .map(Number)
            .filter(Boolean);
      }
    }

    const Changes = {
      ...req.body,
    };

    delete Changes.EquipmentID;
    delete Changes.OrganizationID;
    delete Changes.DeleteDocumentIDs;

    return sendQueueResponse(
      req,
      res,
      "UPDATE_ENGINEERING_EQUIPMENT",
      {
        EquipmentID: req.body.EquipmentID,

        OrganizationID:
          req.body.OrganizationID,

        Changes,

        Documents,

        DeleteDocumentIDs,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================DELETE Equipment
exports.deleteEquipment = async (req, res) => {
  return sendQueueResponse(
    req,
    res,
    "DELETE_ENGINEERING_EQUIPMENT",
    {
      EquipmentID: req.body.EquipmentID,
    },
  );
};
// ============================================================GET Equipment Descriptions(Names)
exports.getEquipmentDescriptions = async (req, res) => {
  try {
    const result =
      await EngineeringService.getEquipmentDescriptions({
        OrganizationID: req.query.OrganizationID,

        // Trusted JWT data
        UserID: req.user.UserID,
        UserType: req.user.UserType,
        DepartmentName: req.user.DepartmentName,
        LoginType: req.user.LoginType,
      });

    return res
      .status(result.statusCode || (result.success ? 200 : 400))
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================GET Serial Number
exports.getEquipmentSerialNumbers = async (req, res) => {
  try {
    const result =
      await EngineeringService.getEquipmentSerialNumbers({
        OrganizationID: req.query.OrganizationID,
      });

    return res
      .status(result.statusCode || (result.success ? 200 : 400))
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================GET Areas
exports.getEquipmentAreas = async (req, res) => {
  try {
    const result =
      await EngineeringService.getEquipmentAreas({
        OrganizationID: req.query.OrganizationID,
      });

    return res
      .status(result.statusCode || (result.success ? 200 : 400))
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================================================Breakdown of Equipment Entries
// ============================================================CREATE Breakdown
exports.createBreakdown = async (req, res) => {
  try {
    const {
      OrganizationID,
      EquipmentID,
      BreakdownDate,
      BreakdownTime,
      BreakdownReason,
      PartsUsed,
      RepairedStatus,
      RepairedDate,
      RepairedByID,
      Amount,
      Parts,
    } = req.body || {};

    if (!OrganizationID) {
      return res.status(400).json({
        success: false,
        message: "OrganizationID is required.",
      });
    }

    if (!EquipmentID) {
      return res.status(400).json({
        success: false,
        message: "EquipmentID is required.",
      });
    }

    return sendQueueResponse(
      req,
      res,
      "CREATE_ENGINEERING_BREAKDOWN",
      {
        OrganizationID,
        EquipmentID,
        BreakdownDate,
        BreakdownTime,
        BreakdownReason,
        PartsUsed,
        RepairedStatus,
        RepairedDate,
        RepairedByID,
        Amount,
        Parts,
      },
      STATUS_CODES.CREATED,
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Breakdown List
exports.getAllBreakdowns = async (req, res) => {
  try {
    const result =
      await EngineeringService.getAllBreakdowns({
        OrganizationID:
          req.query.OrganizationID,

        EquipmentID:
          req.query.EquipmentID || null,

        RepairedStatus:
          req.query.RepairedStatus || null,

        FromDate:
          req.query.FromDate || null,

        ToDate:
          req.query.ToDate || null,

        Search:
          req.query.Search || null,

        page:
          Number(req.query.page) || 1,

        PageSize:
          Number(req.query.PageSize) || 10,
      });

    return res
      .status(
        result.statusCode ||
          (result.success ? 200 : 400),
      )
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================GET Breakdown by Id
exports.getBreakdownById = async (req, res) => {
  try {
    const result =
      await EngineeringService.getBreakdownById({
        BreakdownID: req.params.id,
      });

    return res
      .status(
        result.statusCode ||
          (result.success ? 200 : 400),
      )
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Update Breakdown
exports.updateBreakdown = async (req, res) => {
  try {
    let Parts = req.body?.Parts || [];

    let DeletePartIDs =
      req.body?.DeletePartIDs || [];

    if (typeof Parts === "string") {
      try {
        Parts = JSON.parse(Parts);
      } catch {
        Parts = [];
      }
    }

    if (typeof DeletePartIDs === "string") {
      try {
        DeletePartIDs =
          JSON.parse(DeletePartIDs);
      } catch {
        DeletePartIDs =
          DeletePartIDs
            .split(",")
            .map(Number)
            .filter(Boolean);
      }
    }

    const Changes = {
      ...req.body,
    };

    delete Changes.Remarks;
    delete Changes.BreakdownID;
    delete Changes.OrganizationID;
    delete Changes.Parts;
    delete Changes.DeletePartIDs;

    return sendQueueResponse(
      req,
      res,
      "UPDATE_ENGINEERING_BREAKDOWN",
      {
        BreakdownID:
          req.body.BreakdownID,

        Changes,

        Parts,

        DeletePartIDs,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Delete Breakdown
exports.deleteBreakdown = async (req, res) => {
  return sendQueueResponse(
    req,
    res,
    "DELETE_ENGINEERING_BREAKDOWN",
    {
      BreakdownID:
        req.body.BreakdownID,
    },
  );
};
// ============================================================Update Breakdown Status
exports.updateBreakdownStatus = async (req, res) => {
  try {
    const {
      BreakdownID,
      RepairedStatus,
    } = req.body || {};

    if (!BreakdownID) {
      return res.status(400).json({
        success: false,
        message: "BreakdownID is required.",
      });
    }

    if (
      !RepairedStatus ||
      !String(RepairedStatus).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "RepairedStatus is required.",
      });
    }

    return sendQueueResponse(
      req,
      res,
      "UPDATE_ENGINEERING_BREAKDOWN_STATUS",
      {
        BreakdownID,
        RepairedStatus: String(RepairedStatus).trim(),
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================================================ Vendors of Equipment Entries
// ============================================================CREATE Vendor
exports.createVendor = async (req, res) => {
  try {
    const {
      OrganizationID,
      EquipmentID,
      Name,
    } = req.body || {};

    if (!OrganizationID) {
      return res.status(400).json({
        success: false,
        message: "OrganizationID is required.",
      });
    }

    if (!EquipmentID) {
      return res.status(400).json({
        success: false,
        message: "EquipmentID is required.",
      });
    }

    if (!Name || !String(Name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    return sendQueueResponse(
      req,
      res,
      "CREATE_ENGINEERING_VENDOR",
      {
        OrganizationID,
        EquipmentID,
        Name: String(Name).trim(),

        Address: req.body.Address,
        MobileNumber: req.body.MobileNumber,
        SecondMobileNumber:
          req.body.SecondMobileNumber,
        LandlineNumber:
          req.body.LandlineNumber,
        City: req.body.City,
        Country: req.body.Country,
        PinCode: req.body.PinCode,
        Email: req.body.Email,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Vendor List
exports.getAllVendors = async (req, res) => {
  try {
    const result =
      await EngineeringService.getAllVendors({
        OrganizationID:
          req.query.OrganizationID,
        EquipmentID:
          req.query.EquipmentID,
        Search: req.query.Search,
        page: req.query.page,
        PageSize: req.query.PageSize,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================GET Vendor by ID
exports.getVendorById = async (req, res) => {
  try {
    const result =
      await EngineeringService.getVendorById({
        VendorID: req.params.id,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================UPDATE Vendor
exports.updateVendor = async (req, res) => {
  try {
    const { VendorID } = req.body || {};

    if (!VendorID) {
      return res.status(400).json({
        success: false,
        message: "VendorID is required.",
      });
    }

    const Changes = {
      ...req.body,
    };

    delete Changes.VendorID;

    return sendQueueResponse(
      req,
      res,
      "UPDATE_ENGINEERING_VENDOR",
      {
        VendorID,
        Changes,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================DELETE Vendor
exports.deleteVendor = async (req, res) => {
  try {
    const { VendorID } = req.body || {};

    if (!VendorID) {
      return res.status(400).json({
        success: false,
        message: "VendorID is required.",
      });
    }

    return sendQueueResponse(
      req,
      res,
      "DELETE_ENGINEERING_VENDOR",
      {
        VendorID,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};