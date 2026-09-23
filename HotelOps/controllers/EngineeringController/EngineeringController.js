//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/Engineering/AzureUpload");
const uploadMaintenanceToAzure = require("../../AzurConfigration/Engineering/AzureMaintenanceUpload");
const uploadAMCToAzure = require("../../AzurConfigration/Engineering/AzureAMCUpload");
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
// ============================================================Breakdown Details Pdf (single Record)
exports.generateBreakdownDetailPdf = async (req, res) => {
  try {
    const result =
      await EngineeringService.generateBreakdownDetailPdf({
        OrganizationID:
          req.query.OrganizationID,

        BreakdownID:
          req.query.BreakdownID,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json(result);
    }

    res.setHeader(
      "Content-Type",
      result.contentType ||
        "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`,
    );

    return res.send(result.data);
  } catch (error) {
    return handleError(
      error,
      res,
    );
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
// ============================================================================================Maintenance of Equipment
// =========================================================================Maintenance Checklist Master
// ============================================================Create Maintenance Checklist
exports.createMaintenanceChecklist = async (
  req,
  res,
) => {
  try {
    const { Title, IsActive } =
      req.body || {};

    if (
      !Title ||
      !String(Title).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Title is required.",
      });
    }

    return sendQueueResponse(
      req,
      res,
      "CREATE_ENGINEERING_MAINTENANCE_CHECKLIST",
      {
        Title: String(Title).trim(),
        IsActive,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Maintenance Checklist List
exports.getAllMaintenanceChecklists = async (req, res) => {
    try {
      const result =
        await EngineeringService.getAllMaintenanceChecklists(
          {
            Search: req.query.Search,
            IsActive: req.query.IsActive,
            page: req.query.page,
            PageSize: req.query.PageSize,
          },
        );

      return res
        .status(result.statusCode || 200)
        .json(result);
    } catch (error) {
      return handleError(error, res);
    }
};
// ============================================================Update Maintenance Checklist
exports.updateMaintenanceChecklist = async (
  req,
  res,
) => {
  try {
    const { ChecklistID } =
      req.body || {};

    if (!ChecklistID) {
      return res.status(400).json({
        success: false,
        message:
          "ChecklistID is required.",
      });
    }

    const Changes = {
      ...req.body,
    };

    delete Changes.ChecklistID;

    return sendQueueResponse(
      req,
      res,
      "UPDATE_ENGINEERING_MAINTENANCE_CHECKLIST",
      {
        ChecklistID,
        Changes,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Delete Maintenance Checklist
exports.deleteMaintenanceChecklist = async (
  req,
  res,
) => {
  try {
    const { ChecklistID } =
      req.body || {};

    if (!ChecklistID) {
      return res.status(400).json({
        success: false,
        message:
          "ChecklistID is required.",
      });
    }

    return sendQueueResponse(
      req,
      res,
      "DELETE_ENGINEERING_MAINTENANCE_CHECKLIST",
      {
        ChecklistID,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ==========================================================================Maintenance Details
// ============================================================Create + Update Maintenance Details
exports.saveMaintenance = async (req, res) => {
  try {
    const maintenanceID = Number(
      req.body.MaintenanceID,
    );

    const isUpdate =
      Number.isInteger(maintenanceID) &&
      maintenanceID > 0;

    // =====================================================
    // CREATE VALIDATION
    // =====================================================

    if (!isUpdate) {
      if (!req.body.OrganizationID) {
        return res.status(400).json({
          success: false,
          message: "OrganizationID is required.",
        });
      }

      if (!req.body.EquipmentID) {
        return res.status(400).json({
          success: false,
          message: "EquipmentID is required.",
        });
      }
    }

    // =====================================================
    // CHECKLISTS
    // =====================================================

    let Checklists =
      req.body.Checklists || [];

    if (typeof Checklists === "string") {
      try {
        Checklists = JSON.parse(Checklists);
      } catch {
        Checklists = [];
      }
    }

    // =====================================================
    // DELETE CHECKLIST IDS
    // =====================================================

    let DeleteChecklistEntryIDs =
      req.body.DeleteChecklistEntryIDs || [];

    if (
      typeof DeleteChecklistEntryIDs ===
      "string"
    ) {
      try {
        DeleteChecklistEntryIDs =
          JSON.parse(DeleteChecklistEntryIDs);
      } catch {
        DeleteChecklistEntryIDs =
          DeleteChecklistEntryIDs
            .split(",")
            .map(Number)
            .filter(Boolean);
      }
    }

    // =====================================================
    // DELETE DOCUMENT IDS
    // =====================================================

    let DeleteDocumentIDs =
      req.body.DeleteDocumentIDs || [];

    if (
      typeof DeleteDocumentIDs === "string"
    ) {
      try {
        DeleteDocumentIDs =
          JSON.parse(DeleteDocumentIDs);
      } catch {
        DeleteDocumentIDs =
          DeleteDocumentIDs
            .split(",")
            .map(Number)
            .filter(Boolean);
      }
    }

    // =====================================================
    // NEW DOCUMENTS
    // =====================================================

    const Documents = [];

    if (Array.isArray(req.files)) {
      for (const file of req.files) {
        const blobName =
          await uploadMaintenanceToAzure(
            file,
          );

        Documents.push({
          FileName: file.originalname,
          FilePath: blobName,
          FileType: file.mimetype,
          FileSize: file.size,
        });
      }
    }

    // =====================================================
    // CREATE
    // =====================================================

    if (!isUpdate) {
      return sendQueueResponse(
        req,
        res,
        "SAVE_ENGINEERING_MAINTENANCE",
        {
          MaintenanceID: null,

          OrganizationID:
            req.body.OrganizationID,

          EquipmentID:
            req.body.EquipmentID,

          Maintenance:
            req.body.Maintenance,

          MaintenanceDay:
            req.body.MaintenanceDay,

          MaintenanceDate: req.body.MaintenanceDate,

          MaintenanceBy:
            req.body.MaintenanceBy,

          ServicedBy:
            req.body.ServicedBy,

          EngineerAssigned:
            req.body.EngineerAssigned,

          Status:
            req.body.Status,

          

          Checklists,
          Documents,
        },
      );
    }

    // =====================================================
    // UPDATE
    // =====================================================

    const Changes = {
      ...req.body,
    };

    delete Changes.MaintenanceID;
    delete Changes.Checklists;
    delete Changes.Documents;
    delete Changes.DeleteDocumentIDs;
    delete Changes.DeleteChecklistEntryIDs;

    return sendQueueResponse(
      req,
      res,
      "SAVE_ENGINEERING_MAINTENANCE",
      {
        MaintenanceID: maintenanceID,
        Changes,
        Checklists,
        DeleteChecklistEntryIDs,
        Documents,
        DeleteDocumentIDs,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Maintenance Details List
exports.getAllMaintenance = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService
        .getAllMaintenance({
          OrganizationID:
            req.query.OrganizationID,

          EquipmentID:
            req.query.EquipmentID,

          Status:
            req.query.Status,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,

          Search:
            req.query.Search,

          page:
            req.query.page,

          PageSize:
            req.query.PageSize,
        });

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Get Maintenance Details By ID
exports.getMaintenanceById = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService
        .getMaintenanceById({
          MaintenanceID:
            req.params.id,
        });

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Delete Maintenance Details
exports.deleteMaintenance = async (
  req,
  res,
) => {
  try {
    const {
      MaintenanceID,
    } = req.body || {};

    if (!MaintenanceID) {
      return res.status(400).json({
        success: false,
        message:
          "MaintenanceID is required.",
      });
    }

    return sendQueueResponse(
      req,
      res,
      "DELETE_ENGINEERING_MAINTENANCE",
      {
        MaintenanceID,
      },
    );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================================================Reports of Equipment
// =============================================================1.Total Number of Machine Reports
exports.getTotalEquipmentReports = async (req, res) => {
  try {
    const result = await EngineeringService.getTotalEquipmentReports({
      OrganizationID: req.query.OrganizationID || null,

      DepartmentID: req.query.DepartmentID || req.query.Department || null,
      Status: req.query.Status || null,

      WarrantyStatus: req.query.WarrantyStatus || null,
      AMCStatus: req.query.AMCStatus || null,
      AMCType: req.query.AMCType || null,
      AMCStartDate: req.query.AMCStartDate || null,
      WarrantyStartDate: req.query.WarrantyStartDate || null,
      AMCEndDate: req.query.AMCEndDate || null,
      WarrantyEndDate: req.query.WarrantyEndDate || null,

      SerialNo: req.query.SerialNo || null,
      Area: req.query.Area || null,
      EquipmentID: req.query.EquipmentID || null,

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
// =============================================================2.Breakdown Reports 
exports.getAllBreakdownsReport = async (req, res) => {
  try {
    const result =
      await EngineeringService.getAllBreakdownsReport({
        OrganizationID:
          req.query.OrganizationID,

        EquipmentID:
          req.query.EquipmentID || null,

        RepairedStatus:
          req.query.RepairedStatus || null,

        BreakdownDate:
          req.query.BreakdownDate || null,

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
// =============================================================3. Daily Maintenance Reports
exports.getDailyMaintenanceReports = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService
        .getDailyMaintenanceReports({
          OrganizationID:
            req.query.OrganizationID,

          EquipmentID:
            req.query.EquipmentID,

          Status:
            req.query.Status,

          MaintenanceDate:
            req.query.MaintenanceDate,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,

          Search:
            req.query.Search,

          page:
            req.query.page,

          PageSize:
            req.query.PageSize,
        });

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// =============================================================4. Monthly Maintenance Reports
exports.getMonthlyMaintenanceReports = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService
        .getMonthlyMaintenanceReports({
          OrganizationID:
            req.query.OrganizationID,

          EquipmentID:
            req.query.EquipmentID,

          Month:
            req.query.Month,

          Year:
            req.query.Year,

          Status:
            req.query.Status,

          FromDate:
            req.query.FromDate,

          ToDate:
            req.query.ToDate,

          Search:
            req.query.Search,

          page:
            req.query.page,

          PageSize:
            req.query.PageSize,
        });

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// =============================================================5. Scheduled Missing Reports
exports.getScheduledMissingReports = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService
        .getScheduledMissingReports({
          OrganizationID:
            req.query.OrganizationID,

          page:
            req.query.page,

          PageSize:
            req.query.PageSize,
        });

    return res
      .status(
        result.statusCode || 200,
      )
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================================================Report Pdfs of Equipment
// =============================================================1.Total Number of Machine Reports PDF
exports.getTotalEquipmentReportsPdf = async (
  req,
  res,
) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID ||
        null,

      DepartmentID:
        req.query.DepartmentID ||
        null,

      WarrantyStatus:
        req.query.WarrantyStatus ||
        null,

      AMCStatus:
        req.query.AMCStatus ||
        null,

      AMCType:
        req.query.AMCType ||
        null,

      AMCStartDate:
        req.query.AMCStartDate ||
        null,

      WarrantyStartDate:
        req.query.WarrantyStartDate ||
        null,

      AMCEndDate:
        req.query.AMCEndDate ||
        null,

      WarrantyEndDate:
        req.query.WarrantyEndDate ||
        null,

      SerialNo:
        req.query.SerialNo ||
        null,

      Area:
        req.query.Area ||
        null,

      EquipmentID:
        req.query.EquipmentID ||
        null,

      Search:
        req.query.Search ||
        null,
    };

    const response =
      await EngineeringService
        .generateTotalEquipmentReportsPdf(
          data,
        );

    if (!response.success) {
      return res
        .status(
          response.statusCode ||
            400,
        )
        .json(response);
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(response.data);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// =============================================================2.Breakdown Reports Pdf
exports.getBreakdownReportPdf = async (
  req,
  res,
) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID ||
        null,

      EquipmentID:
        req.query.EquipmentID ||
        null,

      RepairedStatus:
        req.query.RepairedStatus ||
        null,

      BreakdownDate:
        req.query.BreakdownDate ||
        null,

      FromDate:
        req.query.FromDate ||
        null,

      ToDate:
        req.query.ToDate ||
        null,

      Search:
        req.query.Search ||
        null,
    };

    const response =
      await EngineeringService
        .generateBreakdownReportPdf(
          data,
        );

    if (!response.success) {
      return res
        .status(
          response.statusCode ||
            400,
        )
        .json(
          response,
        );
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(
        response.data,
      );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// =============================================================3. Daily Maintenance Reports Pdf
exports.getDailyMaintenanceReportPdf = async (
  req,
  res,
) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID ||
        null,

      EquipmentID:
        req.query.EquipmentID ||
        null,

      Status:
        req.query.Status ||
        null,

      MaintenanceDate:
        req.query.MaintenanceDate ||
        null,

      FromDate:
        req.query.FromDate ||
        null,

      ToDate:
        req.query.ToDate ||
        null,

      Search:
        req.query.Search ||
        null,
    };

    const response =
      await EngineeringService
        .generateDailyMaintenanceReportPdf(
          data,
        );

    if (!response.success) {
      return res
        .status(
          response.statusCode ||
            400,
        )
        .json(
          response,
        );
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(
        response.data,
      );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// =============================================================4. Monthly Maintenance Reports Pdf
exports.getMonthlyMaintenanceReportPdf = async (
  req,
  res,
) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID ||
        null,

      EquipmentID:
        req.query.EquipmentID ||
        null,

      Month:
        req.query.Month ||
        null,

      Year:
        req.query.Year ||
        null,

      Status:
        req.query.Status ||
        null,

      FromDate:
        req.query.FromDate ||
        null,

      ToDate:
        req.query.ToDate ||
        null,

      Search:
        req.query.Search ||
        null,
    };

    const response =
      await EngineeringService
        .generateMonthlyMaintenanceReportPdf(
          data,
        );

    if (!response.success) {
      return res
        .status(
          response.statusCode ||
            400,
        )
        .json(response);
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(
        response.data,
      );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// =============================================================5. Scheduled Missing Reports Pdf
exports.getScheduledMissingReportPdf = async (
  req,
  res,
) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID ||
        null,
    };

    const response =
      await EngineeringService
        .generateScheduledMissingReportPdf(
          data,
        );

    if (!response.success) {
      return res
        .status(
          response.statusCode ||
            400,
        )
        .json(
          response,
        );
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(
        response.data,
      );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================================================AMC of Equipment
// ============================================================Create AMC
exports.createAMC = async (req, res) => {
  try {
    const body = req.body || {};

    // ============================================================
    // OrganizationID
    // ============================================================

    const OrganizationID = Number(body.OrganizationID);

    if (
      !Number.isSafeInteger(OrganizationID) ||
      OrganizationID <= 0
    ) {
      throw new AppError(
        "Organization ID is required and must be a positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // EquipmentID
    // ============================================================

    const EquipmentID = Number(body.EquipmentID);

    if (
      !Number.isSafeInteger(EquipmentID) ||
      EquipmentID <= 0
    ) {
      throw new AppError(
        "Equipment ID is required and must be a positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // Date Helper
    // ============================================================

    const normalizeDate = (value, fieldName) => {
      const normalized = String(value ?? "").trim();

      if (!normalized) {
        return null;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        throw new AppError(
          `${fieldName} must be in YYYY-MM-DD format`,
          STATUS_CODES.BAD_REQUEST,
        );
      }

      const parsed = new Date(
        `${normalized}T00:00:00.000Z`,
      );

      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== normalized
      ) {
        throw new AppError(
          `${fieldName} must be a valid date`,
          STATUS_CODES.BAD_REQUEST,
        );
      }

      return normalized;
    };

    const AMCStartDate = normalizeDate(
      body.AMCStartDate,
      "AMCStartDate",
    );

    const AMCEndDate = normalizeDate(
      body.AMCEndDate,
      "AMCEndDate",
    );

    if (
      AMCStartDate &&
      AMCEndDate &&
      AMCStartDate > AMCEndDate
    ) {
      throw new AppError(
        "AMCStartDate cannot be greater than AMCEndDate",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================
    // AMC Amount
    // ============================================================

    let AMCAmount = null;

    if (
      body.AMCAmount !== undefined &&
      body.AMCAmount !== null &&
      String(body.AMCAmount).trim() !== ""
    ) {
      AMCAmount = Number(body.AMCAmount);

      if (
        !Number.isFinite(AMCAmount) ||
        AMCAmount < 0
      ) {
        throw new AppError(
          "AMCAmount must be a valid non-negative number",
          STATUS_CODES.BAD_REQUEST,
        );
      }
    }

    // ============================================================
    // Text Helper
    // ============================================================

    const textOrNull = (value) => {
      if (
        value === undefined ||
        value === null
      ) {
        return null;
      }

      const normalized = String(value).trim();

      return normalized || null;
    };

    // ============================================================
    // Upload Documents To Azure
    // ============================================================

    const Documents = [];

    for (const file of req.files || []) {
      const filePath = await uploadAMCToAzure(file);

      Documents.push({
        FileName: file.originalname,
        FilePath: filePath,
        FileType: file.mimetype,
        FileSize: file.size,
      });
    }

    // ============================================================
    // RabbitMQ Payload
    //
    // UserID body se nahi bhejna.
    // sendQueueResponse req.user se verified UserID inject karega.
    // ============================================================

    const data = {
      OrganizationID,
      EquipmentID,

      AMCStartDate,
      AMCEndDate,

      AMCType: textOrNull(body.AMCType),

      AMCAmount,

      VendorName:
        textOrNull(body.VendorName),

      VendorEmailAddress:
        textOrNull(body.VendorEmailAddress),

      VendorMobileNumber:
        textOrNull(body.VendorMobileNumber),

      VendorSecondMobileNumber:
        textOrNull(
          body.VendorSecondMobileNumber,
        ),

      VendorLandlineNumber:
        textOrNull(
          body.VendorLandlineNumber,
        ),

      VendorAddress:
        textOrNull(body.VendorAddress),

      VendorCity:
        textOrNull(body.VendorCity),

      VendorState:
        textOrNull(body.VendorState),

      VendorPincode:
        textOrNull(body.VendorPincode),

      Documents,
    };

    // ============================================================
    // RabbitMQ
    // Controller -> Consumer -> Service
    // ============================================================

    return await sendQueueResponse(
      req,
      res,
      "CREATE_ENGINEERING_AMC",
      data,
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================AMC List
 exports.getAllAMC = async (req, res) => {
  try {
    const result =
      await EngineeringService.getAllAMC({
        OrganizationID:
          req.query.OrganizationID,

        EquipmentID:
          req.query.EquipmentID,

        Status:
          req.query.Status,

        Search:
          req.query.Search,

        page:
          req.query.page,

        PageSize:
          req.query.PageSize,

        // ======================================================
        // Trusted JWT Fields
        // ======================================================

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Get AMC by ID
exports.getAMCById = async (req, res) => {
  try {
    const result =
      await EngineeringService.getAMCById({
        AMCID:
          req.params.id,

        EquipmentID:
          req.query.EquipmentID,

        // Trusted JWT fields
        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Update AMC
exports.updateAMC = async (req, res) => {
  try {
    const Changes =
      req.body.Changes
        ? typeof req.body.Changes === "string"
          ? JSON.parse(req.body.Changes)
          : req.body.Changes
        : {};

    const DeleteDocumentIDs =
      req.body.DeleteDocumentIDs
        ? typeof req.body.DeleteDocumentIDs === "string"
          ? JSON.parse(
              req.body.DeleteDocumentIDs,
            )
          : req.body.DeleteDocumentIDs
        : [];

    // ============================================================
    // Yahan req.files ko existing Engineering Azure upload
    // helper se upload karke Documents array banao.
    // ============================================================

    const Documents =
      req.uploadedDocuments || [];

    return sendQueueResponse(
      req,
      res,
      "UPDATE_ENGINEERING_AMC",
      {
        AMCID:
          req.body.AMCID,

        OrganizationID:
          req.body.OrganizationID,

        Changes,

        DeleteDocumentIDs,

        Documents,
      },
    );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Delete AMC
exports.deleteAMC = async (req, res) => {
  try {
    return sendQueueResponse(
      req,
      res,
      "DELETE_ENGINEERING_AMC",
      {
        AMCID: req.body.AMCID,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Approve AMC
exports.processAMCApproval = async (
  req,
  res,
) => {
  try {
    return sendQueueResponse(
      req,
      res,
      "PROCESS_ENGINEERING_AMC_APPROVAL",
      {
        AMCID:
          req.body.AMCID,

        Action:
          req.body.Action,

        Remarks:
          req.body.Remarks,

        // Trusted JWT values
        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      },
    );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Create AMC Approval Config
exports.createAMCApprovalConfig = async (
  req,
  res,
) => {
  try {
    return sendQueueResponse(
      req,
      res,
      "CREATE_ENGINEERING_AMC_APPROVAL_CONFIG",
      {
        OrganizationID:
          req.body.OrganizationID,

        Approvals:
          req.body.Approvals,
      },
    );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================AMC Approval Config List
exports.getAllAMCApprovalConfig = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService.getAllAMCApprovalConfig(
        {
          OrganizationID:
            req.query.OrganizationID,
        },
      );

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================Delete AMC Approval Config
exports.deleteAMCApprovalConfig = async (
  req,
  res,
) => {
  try {
    return sendQueueResponse(
      req,
      res,
      "DELETE_ENGINEERING_AMC_APPROVAL_CONFIG",
      {
        AMCApprovalConfigID:
          req.body.AMCApprovalConfigID,
      },
    );
  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================AMC DETAIL PDF
exports.generateAMCDetailPdf = async (req, res) => {
  try {
    const result =
      await EngineeringService.generateAMCDetailPdf({
        OrganizationID:
          req.query.OrganizationID,

        AMCID:
          req.query.AMCID,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json(result);
    }

    res.setHeader(
      "Content-Type",
      result.contentType ||
        "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`,
    );

    return res.send(
      result.data,
    );
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================================================OR Code of Equipment Entries
// ============================================================Equipment QR Code
exports.generateEquipmentQRCode = async (req, res) => {
  try {
    const result =
      await EngineeringService.generateEquipmentQRCode({
        OrganizationID:
          req.query.OrganizationID,

        EquipmentID:
          req.query.EquipmentID,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    if (result.success && String(req.query.format || "").toLowerCase() !== "json") {
      const base64 = result.data.QRCode.replace(/^data:image\/png;base64,/, "");
      res.set("Cache-Control", "no-store");
      res.set("Content-Disposition", 'inline; filename="equipment-' + Number(req.query.EquipmentID) + '-qr.png"');
      return res.type("png").send(Buffer.from(base64, "base64"));
    }

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Generate All Equipment QR Codes By Organization
exports.downloadAllEquipmentQRCodes = async (req, res) => {
  try {
    const result =
      await EngineeringService.generateAllEquipmentQRCodes({
        OrganizationID: req.query.OrganizationID,

        UserID: req.user?.UserID,
        UserType: req.user?.UserType,
        DepartmentName: req.user?.DepartmentName,
        LoginType: req.user?.LoginType,
      });

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json(result);
    }

    const {
      OrganizationID,
      QRCodes,
    } = result.data;

    // ESM package ko CommonJS project me load karo
    const { ZipArchive } =
      await import("archiver");

    const zipFileName =
      `Equipment-QR-Organization-${OrganizationID}.zip`;

    res.setHeader(
      "Content-Type",
      "application/zip",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipFileName}"`,
    );

    res.setHeader(
      "Cache-Control",
      "no-store",
    );

    const archive = new ZipArchive({
      zlib: {
        level: 9,
      },
    });

    archive.on("error", (error) => {
      console.error(
        "Equipment QR ZIP Error:",
        error.message,
      );

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to generate equipment QR ZIP.",
        });
      }

      res.destroy(error);
    });

    archive.pipe(res);

    for (const qr of QRCodes) {
      archive.append(
        qr.QRBuffer,
        {
          name:
            `Equipment-${qr.EquipmentID}-QR.png`,
        },
      );
    }

    await archive.finalize();

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================================================Dashboard Equipment
// ============================================================Engineering Dashboard Summary
exports.getEngineeringDashboardSummary = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService.getEngineeringDashboardSummary({
        OrganizationID:
          req.query.OrganizationID,

        FromDate:
          req.query.FromDate,

        ToDate:
          req.query.ToDate,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Maintenance Trend Chart
exports.getEngineeringMaintenanceChart = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService.getEngineeringMaintenanceChart({
        OrganizationID:
          req.query.OrganizationID,

        FromDate:
          req.query.FromDate,

        ToDate:
          req.query.ToDate,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Maintenance Distribution
exports.getEngineeringMaintenanceDistribution = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService.getEngineeringMaintenanceDistribution({
        OrganizationID:
          req.query.OrganizationID,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Breakdown Trend Chart
exports.getEngineeringBreakdownChart = async (
  req,
  res,
) => {
  try {
    const result =
      await EngineeringService.getEngineeringBreakdownChart({
        OrganizationID:
          req.query.OrganizationID,

        FromDate:
          req.query.FromDate,

        ToDate:
          req.query.ToDate,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(result.statusCode || 200)
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Upcoming Maintenance (7 days)
exports.getEngineeringUpcomingMaintenance = async (req, res) => {
  try {
    const result =
      await EngineeringService.getEngineeringUpcomingMaintenance({
        OrganizationID:
          req.query.OrganizationID,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(
        result.statusCode ||
        (result.success ? 200 : 400),
      )
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ Recently Expired(In Last 30 Days)
exports.getEngineeringRecentlyExpired = async (req, res) => {
  try {
    const result =
      await EngineeringService.getEngineeringRecentlyExpired({
        OrganizationID:
          req.query.OrganizationID,

        UserID:
          req.user?.UserID,

        UserType:
          req.user?.UserType,

        DepartmentName:
          req.user?.DepartmentName,

        LoginType:
          req.user?.LoginType,
      });

    return res
      .status(
        result.statusCode ||
        (result.success ? 200 : 400),
      )
      .json(result);
  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};