//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/Capex/AzureUpload");
// =========================================================Get Data From service
const CapexService = require("../../services/CapexService/CapexService");

// ============================================================ Validation Helpers
const isPositiveInteger = (value) => {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized)
    && Number.isSafeInteger(Number(normalized))
    && Number(normalized) > 0;
};
const positiveNumber = (value, fieldName) => {
  const normalized = String(value ?? "").trim();
  const number = Number(normalized);

  if (!normalized || !Number.isFinite(number) || number <= 0) {
    throw new AppError(
      `${fieldName} must be a number greater than zero`,
      STATUS_CODES.BAD_REQUEST
    );
  }

  return number;
};
const requiredText = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(
      `${fieldName} is required`,
      STATUS_CODES.BAD_REQUEST
    );
  }

  return value.trim();
};
// Read identity and role data only from the verified JWT payload.
const authenticatedUser = (req) => {
  const userID = Number(req.user?.UserID);

  if (!Number.isSafeInteger(userID) || userID < 1) {
    throw new AppError(
      "Authenticated user is invalid",
      STATUS_CODES.UNAUTHORIZED
    );
  }

  return {
    UserID: userID,
    UserType: String(req.user?.UserType || "").trim(),
    LoginType: String(req.user?.LoginType || "").trim(),
  };
};
// Send CAPEX commands/queries through the shared RabbitMQ RPC producer.
const sendQueueResponse = async (res, action, data) => {
  const response = await producer.sendMessage(
    QUEUE.CAPEX.REQUEST,
    QUEUE.CAPEX.RESPONSE,
    { action, data }
  );

  if (!response.success) {
    throw new AppError(
      response.message || "Unable to fetch CAPEX data",
      response.statusCode || STATUS_CODES.BAD_REQUEST,
      response.errors
    );
  }

  return res.status(STATUS_CODES.SUCCESS).json(response);
};
// Normalize RabbitMQ availability failures into the shared error format.
const handleControllerError = (error, res) => {
  if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
    return handleError(
      new AppError(
        "CAPEX service is temporarily unavailable. Please try again shortly.",
        STATUS_CODES.SERVICE_UNAVAILABLE
      ),
      res
    );
  }

  return handleError(error, res);
};

// ============================================================ Create CAPEX
exports.createCapex = async (req, res) => {
  let uploadedDocuments = [];

  try {
    const {
      OrganizationID,
      Department,
      Item,
      Description,
      Make,
      Qty,
      Rate,
      Total,
    } = req.body || {};
if (!OrganizationID) {
  throw new AppError(
    "Organization ID is required",
    STATUS_CODES.BAD_REQUEST
  );
}

if (!Department) {
  throw new AppError(
    "Department is required",
    STATUS_CODES.BAD_REQUEST
  );
}
    const userID = req.user.UserID;
    const data = {
      OrganizationID,
      Department,
      Item,
      Description,
      Make,
      Qty,
      Rate,
      Total,
      UserID: userID,
      CreatedBy: userID,
      Documents: [],
    };

    for (const file of req.files || []) {
      const filePath = await uploadToAzure(file);
      uploadedDocuments.push({
        FileName: file.originalname,
        FilePath: filePath,
        FileType: file.mimetype,
        FileSize: file.size,
      });
    }
    data.Documents = uploadedDocuments;

    const response = await producer.sendMessage(
      QUEUE.CAPEX.REQUEST,
      QUEUE.CAPEX.RESPONSE,
      {
        action: "CREATE_CAPEX",
        data,
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to create CAPEX",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res
      .status(response.queued ? 202 : STATUS_CODES.CREATED)
      .json(response);
  } catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(
        new AppError(
          "CAPEX service is temporarily unavailable. Please try again shortly.",
          STATUS_CODES.SERVICE_UNAVAILABLE
        ),
        res
      );
    }

    return handleError(error, res);
  }
};
// ============================================================ Get All CAPEX
exports.getAllCapex = async (req, res) => {
  try {
    const user = authenticatedUser(req);

    let OrganizationID = null;

    // ================= OrganizationID =================

    if (
      req.query.OrganizationID !== undefined &&
      req.query.OrganizationID !== null &&
      String(req.query.OrganizationID).trim() !== ""
    ) {
      if (!isPositiveInteger(req.query.OrganizationID)) {
        throw new AppError(
          "Organization ID must be a positive integer",
          STATUS_CODES.BAD_REQUEST
        );
      }

      OrganizationID = Number(req.query.OrganizationID);
    }

    // ================= Department =================

    const Department = req.query.Department
      ? String(req.query.Department).trim()
      : null;

    // ================= Created Date Range =================

    const FromDate = req.query.FromDate
      ? String(req.query.FromDate).trim()
      : null;
    const ToDate = req.query.ToDate
      ? String(req.query.ToDate).trim()
      : null;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    for (const [fieldName, value] of [
      ["FromDate", FromDate],
      ["ToDate", ToDate],
    ]) {
      const parsedDate = value
        ? new Date(`${value}T00:00:00.000Z`)
        : null;

      if (
        value &&
        (!datePattern.test(value) ||
          Number.isNaN(parsedDate.getTime()) ||
          parsedDate.toISOString().slice(0, 10) !== value)
      ) {
        throw new AppError(
          `${fieldName} must be a valid date in YYYY-MM-DD format`,
          STATUS_CODES.BAD_REQUEST
        );
      }
    }

    if (FromDate && ToDate && FromDate > ToDate) {
      throw new AppError(
        "FromDate cannot be greater than ToDate",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ================= Status =================

    let Status = null;

    if (
      req.query.Status !== undefined &&
      req.query.Status !== null &&
      String(req.query.Status).trim() !== ""
    ) {
      Status = String(req.query.Status).trim().toUpperCase();

      if (
        !["PENDING", "APPROVED", "REJECTED", "HOLD", "RETURNED"].includes(
          Status
        )
      ) {
        throw new AppError(
          "Status must be Pending, Approved, Rejected, Hold, or Returned",
          STATUS_CODES.BAD_REQUEST
        );
      }
    }

    // ================= Pagination =================

    const page = Number(req.query.page) || 1;
    const PageSize = Number(req.query.PageSize) || 10;

    if (!Number.isInteger(page) || page < 1) {
      throw new AppError(
        "Page must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!Number.isInteger(PageSize) || PageSize < 1) {
      throw new AppError(
        "PageSize must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ================= Send To Queue =================

  const response = await CapexService.getAllCapex({
  ...user,
  OrganizationID,
  Department,
  FromDate,
  ToDate,
  Status,
  page,
  PageSize,
});

if (!response.success) {
  throw new AppError(
    response.message || "Unable to fetch CAPEX records",
    response.statusCode || STATUS_CODES.BAD_REQUEST,
    response.errors
  );
}

return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Get CAPEX By ID
exports.getCapexById = async (req, res) => {
  try {
    if (!isPositiveInteger(req.params.id)) {
      throw new AppError(
        "CAPEX ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = authenticatedUser(req);
    
    const response = await CapexService.getCapexById({
      ...user,
      CapexID: Number(req.params.id),
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch CAPEX",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleControllerError(error, res);
  }
};

// ============================================================ Partial Update Helpers
const optionalText = (body, fieldName) => {
  if (!Object.prototype.hasOwnProperty.call(body, fieldName)) return undefined;
  const value = body[fieldName];
  if (value === null || String(value).trim() === "") return null;
  return String(value).trim();
};
const optionalBoolean = (body, fieldName) => {
  if (!Object.prototype.hasOwnProperty.call(body, fieldName)) return undefined;
  const value = body[fieldName];

  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;

  throw new AppError(
    `${fieldName} must be true or false`,
    STATUS_CODES.BAD_REQUEST
  );
};
// Parse selected document IDs from JSON arrays or comma-separated form data.
const parseDocumentIDs = (value) => {
  if (value === undefined || value === null || value === "") return [];

  let values = value;
  if (typeof value === "string") {
    try {
      values = value.trim().startsWith("[")
        ? JSON.parse(value)
        : value.split(",");
    } catch (_error) {
      throw new AppError(
        "DeleteDocumentIDs must be an array of positive integers",
        STATUS_CODES.BAD_REQUEST
      );
    }
  }

  if (!Array.isArray(values)) {
    throw new AppError(
      "DeleteDocumentIDs must be an array of positive integers",
      STATUS_CODES.BAD_REQUEST
    );
  }

  const documentIDs = values.map((item) => Number(String(item).trim()));
  if (documentIDs.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new AppError(
      "DeleteDocumentIDs must contain only positive integers",
      STATUS_CODES.BAD_REQUEST
    );
  }

  return [...new Set(documentIDs)];
};
// ============================================================ Update CAPEX
exports.updateCapex = async (req, res) => {
  let uploadedDocuments = [];

  try {
    const body = req.body || {};

    // ============================================================
    // CAPEX ID FROM BODY
    // ============================================================

   

    const CapexID = body.CapexID;

    // ============================================================
    // USER
    // ============================================================

    const user = authenticatedUser(req);

    const changes = {};

    // ============================================================
    // ORGANIZATION ID
    // ============================================================
    // Organization update is NOT allowed.
    // So we do not take OrganizationID from frontend.

    // ============================================================
    // BASIC CAPEX FIELDS
    // ============================================================

    if (
      Object.prototype.hasOwnProperty.call(
        body,
        "Department"
      )
    ) {
      changes.Department = requiredText(
        body.Department,
        "Department"
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        body,
        "Item"
      )
    ) {
      changes.Item = requiredText(
        body.Item,
        "Item"
      );
    }

    // ============================================================
    // OPTIONAL TEXT FIELDS
    // ============================================================

    for (
      const field of [
        "Description",
        "Make",
        "VoidRemarks"
      ]
    ) {
      const value = optionalText(body, field);

      if (value !== undefined) {
        changes[field] = value;
      }
    }

    // ============================================================
    // QTY / RATE
    // ============================================================

    for (
      const field of ["Qty", "Rate", "Total"]
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          body,
          field
        )
      ) {
        changes[field] = positiveNumber(
          body[field],
          field
        );
      }
    }

    // ============================================================
    // IS VOID
    // ============================================================

    const isVoid = optionalBoolean(
      body,
      "IsVoid"
    );

    if (isVoid !== undefined) {
      changes.IsVoid = isVoid;
    }

    // ============================================================
    // APPROVAL FIELDS NOT ALLOWED
    // ============================================================

    const forbiddenApprovalFields = [
      "CapexApprovalID",
      "LevelNo",
      "ApprovalRole",
      "Status",
      "StatusDateTime",
      "StatusApprovedBy",
      "Remarks",
      "Approvals",
    ];

    if (
      forbiddenApprovalFields.some(
        (field) =>
          Object.prototype.hasOwnProperty.call(
            body,
            field
          )
      )
    ) {
      throw new AppError(
        "Approval fields cannot be changed through the CAPEX update API",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ============================================================
    // UPLOAD NEW DOCUMENTS
    // ============================================================

    for (const file of req.files || []) {
      const filePath = await uploadToAzure(file);

      uploadedDocuments.push({
        FileName: file.originalname,
        FilePath: filePath,
        FileType: file.mimetype,
        FileSize: file.size,
      });
    }

    // ============================================================
    // DELETE OLD DOCUMENTS
    // ============================================================

    const deleteDocumentIDs =
      parseDocumentIDs(
        body.DeleteDocumentIDs
      );

    // ============================================================
    // AT LEAST ONE CHANGE REQUIRED
    // ============================================================

    if (
      Object.keys(changes).length === 0 &&
      uploadedDocuments.length === 0 &&
      deleteDocumentIDs.length === 0
    ) {
      throw new AppError(
        "No CAPEX changes were provided",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ============================================================
    // SEND TO CAPEX QUEUE
    // ============================================================

    const response =
      await producer.sendMessage(
        QUEUE.CAPEX.REQUEST,
        QUEUE.CAPEX.RESPONSE,
        {
          action: "UPDATE_CAPEX",

          data: {
            CapexID,

            ...user,

            Changes: changes,

            Documents: uploadedDocuments,

            DeleteDocumentIDs:
              deleteDocumentIDs,
          },
        }
      );

    // ============================================================
    // RESPONSE
    // ============================================================

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to update CAPEX",

        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,

        response.errors
      );
    }

    return res
      .status(
        response.queued
          ? 202
          : STATUS_CODES.SUCCESS
      )
      .json(response);

  } catch (error) {
    return handleControllerError(
      error,
      res
    );
  }
};

// ============================================================ Soft Delete CAPEX
exports.deleteCapex = async (req, res) => {
  try {
    const CapexID = req.body.CapexID;

    if (!isPositiveInteger(CapexID)) {
      throw new AppError(
        "CAPEX ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.CAPEX.REQUEST,
      QUEUE.CAPEX.RESPONSE,
      {
        action: "DELETE_CAPEX",
        data: {
          CapexID: Number(CapexID),
          ...authenticatedUser(req),
        },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to delete CAPEX",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Approval Action
exports.approveCapex = async (req, res) => {
  try {
    const CapexID = req.body?.CapexID;

    if (!isPositiveInteger(Number(CapexID))) {
      throw new AppError(
        "CAPEX ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const action = String(req.body?.Action || "")
      .trim()
      .toUpperCase();

    if (!["APPROVE", "REJECT", "RETURN", "HOLD"].includes(action)) {
      throw new AppError(
        "Action must be APPROVE, REJECT, RETURN, or HOLD",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const remarks =
      typeof req.body?.Remarks === "string"
        ? req.body.Remarks.trim()
        : "";

    if (
      ["REJECT", "RETURN", "HOLD"].includes(action) &&
      !remarks
    ) {
      throw new AppError(
        `Remarks are required when the action is ${action}`,
        STATUS_CODES.BAD_REQUEST
      );
    }

    const Quantity =
      req.body?.Quantity === undefined || req.body?.Quantity === null
        ? null
        : positiveNumber(req.body.Quantity, "Quantity");

    const user = authenticatedUser(req);

    const response = await producer.sendMessage(
      QUEUE.CAPEX.REQUEST,
      QUEUE.CAPEX.RESPONSE,
      {
        action: "PROCESS_CAPEX_APPROVAL",

        data: {
          CapexID: Number(CapexID),
          Action: action,
          Remarks: remarks || null,
          Quantity,
          UserID: user.UserID,
          UserType: user.UserType,
        },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to process CAPEX approval",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleControllerError(error, res);
  }
};

// ============================================================ Report Helpers
// Validate report filters
const reportFilters = (req) => {
  const rawOrganizationID = req.query?.OrganizationID;

  // ------------------------------------------------------------
  // Missing OR empty OrganizationID
  // => ALL accessible organizations
  // ------------------------------------------------------------

  if (
    rawOrganizationID === undefined ||
    rawOrganizationID === null ||
    String(rawOrganizationID).trim() === ""
  ) {
    return {
      OrganizationID: null,
    };
  }

  // ------------------------------------------------------------
  // OrganizationID provided
  // => Must be a positive integer
  // ------------------------------------------------------------

  if (!isPositiveInteger(rawOrganizationID)) {
    throw new AppError(
      "Organization ID must be a positive integer",
      STATUS_CODES.BAD_REQUEST
    );
  }

  return {
    OrganizationID: Number(rawOrganizationID),
  };
};

// Validate the optional CAPEX creation-date range used by report endpoints.
const reportDateFilters = (req) => {
  const FromDate = req.query.FromDate
    ? String(req.query.FromDate).trim()
    : null;
  const ToDate = req.query.ToDate
    ? String(req.query.ToDate).trim()
    : null;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  for (const [fieldName, value] of [
    ["FromDate", FromDate],
    ["ToDate", ToDate],
  ]) {
    const parsedDate = value
      ? new Date(`${value}T00:00:00.000Z`)
      : null;

    if (
      value &&
      (!datePattern.test(value) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== value)
    ) {
      throw new AppError(
        `${fieldName} must be a valid date in YYYY-MM-DD format`,
        STATUS_CODES.BAD_REQUEST
      );
    }
  }

  if (FromDate && ToDate && FromDate > ToDate) {
    throw new AppError(
      "FromDate cannot be greater than ToDate",
      STATUS_CODES.BAD_REQUEST
    );
  }

  return { FromDate, ToDate };
};

// Department report supports department and CAPEX creation-date filters.
const departmentReportFilters = (req) => {
  const Department = req.query.Department
    ? String(req.query.Department).trim()
    : null;

  return {
    ...reportFilters(req),
    Department,
    ...reportDateFilters(req),
  };
};
// All reports use the same JWT context and RabbitMQ request flow.
const getReport = async (req, res, action) => {
  try {
    const user = authenticatedUser(req);

   return await sendQueueResponse(res, action, {
  Filters: reportFilters(req),
});

  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Summary Report
exports.getCapexSummaryReport = async (req, res) => {
  try {
    if (!isPositiveInteger(req.query.OrganizationID)) {
      throw new AppError(
        "Organization ID is required and must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = authenticatedUser(req);
    const UserType = user.UserType.toUpperCase();

    const response = await CapexService.getCapexSummaryReport({
      Filters: {
        OrganizationID: Number(req.query.OrganizationID),
      },
      UserType,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch CAPEX summary report",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Department Report
exports.getCapexDepartmentReport = async (req, res) => {
  try {
    const response = await CapexService.getCapexDepartmentReport({
      Filters: departmentReportFilters(req),
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch CAPEX department report",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Organization Report
exports.getCapexOrganizationReport = async (req, res) => {
  try {
    const response = await CapexService.getCapexOrganizationReport({
      Filters: {
        ...reportFilters(req),
        ...reportDateFilters(req),
      },
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch CAPEX organization report",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================CREATE CAPEX APPROVAL CONFIG
exports.createCapexApprovalConfig = async (req, res) => {
  try {
    const {
      OrganizationID,
      Approvals,
    } = req.body || {};

    if (!OrganizationID) {
      throw new AppError(
        "OrganizationID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!Array.isArray(Approvals) || Approvals.length === 0) {
      throw new AppError(
        "Approvals must be a non-empty array",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const formattedApprovals = Approvals.map((approval) => ({
      ApprovalLevel: Number(approval.ApprovalLevel),

      ApprovalRole: String(
        approval.ApprovalRole || ""
      )
        .trim()
        .toUpperCase(),

      ApprovalOrder: Number(
        approval.ApprovalOrder
      ),

      IsMandatory:
        approval.IsMandatory === undefined
          ? true
          : Boolean(approval.IsMandatory),
    }));

    const user = authenticatedUser(req);

    return await sendQueueResponse(
      res,
      "CREATE_CAPEX_APPROVAL_CONFIG",
      {
        ...user,
        OrganizationID: Number(OrganizationID),
        Approvals: formattedApprovals,
      }
    );

  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================GET ALL CAPEX APPROVAL CONFIG
exports.getCapexApprovalConfig = async (req, res) => {
  try {
    let OrganizationID = null;

    if (
      req.query.OrganizationID !== undefined &&
      req.query.OrganizationID !== null &&
      String(req.query.OrganizationID).trim() !== ""
    ) {
      if (!isPositiveInteger(req.query.OrganizationID)) {
        throw new AppError(
          "Organization ID must be a positive integer",
          STATUS_CODES.BAD_REQUEST
        );
      }

      OrganizationID = Number(req.query.OrganizationID);
    }

    const response = await CapexService.getApprovalConfig({
      OrganizationID,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch CAPEX approval configuration",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================DELETE CAPEX APPROVAL CONFIG
exports.deleteCapexApprovalConfig = async (req, res) => {
  try {
    const { CapexApprovalConfigID } = req.body || {};

    if (!isPositiveInteger(CapexApprovalConfigID)) {
      throw new AppError(
        "CAPEX Approval Config ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = authenticatedUser(req);

    return await sendQueueResponse(
      res,
      "DELETE_CAPEX_APPROVAL_CONFIG",
      {
        ...user,
        CapexApprovalConfigID: Number(CapexApprovalConfigID),
      }
    );
  } catch (error) {
    return handleControllerError(error, res);
  }
};

// ============================================================PDF Apis
// ============================================================Generate CAPEX List PDF
exports.generateCapexListPdf = async (req, res) => {
  try {
    const user = authenticatedUser(req);
    const Department = req.query.Department
      ? String(req.query.Department).trim()
      : null;
    const FromDate = req.query.FromDate
      ? String(req.query.FromDate).trim()
      : null;
    const ToDate = req.query.ToDate
      ? String(req.query.ToDate).trim()
      : null;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    for (const [fieldName, value] of [
      ["FromDate", FromDate],
      ["ToDate", ToDate],
    ]) {
      const parsedDate = value
        ? new Date(`${value}T00:00:00.000Z`)
        : null;

      if (
        value &&
        (!datePattern.test(value) ||
          Number.isNaN(parsedDate.getTime()) ||
          parsedDate.toISOString().slice(0, 10) !== value)
      ) {
        throw new AppError(
          `${fieldName} must be a valid date in YYYY-MM-DD format`,
          STATUS_CODES.BAD_REQUEST
        );
      }
    }

    if (FromDate && ToDate && FromDate > ToDate) {
      throw new AppError(
        "FromDate cannot be greater than ToDate",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await CapexService.generateCapexListPdf({
      OrganizationID: req.query.OrganizationID
        ? Number(req.query.OrganizationID)
        : null,

      UserType: user.UserType,

      Status: req.query.Status || null,

      Department,
      FromDate,
      ToDate,

      logoUrl: req.query.logoUrl || null,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to generate CAPEX PDF",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${response.fileName}"`
    );

    return res.status(STATUS_CODES.SUCCESS).send(response.data);

  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================Department Report PDF
exports.getCapexDepartmentReportPdf = async (req, res) => {
  try {
    const response = await CapexService.getCapexDepartmentReportPdf({
      Filters: departmentReportFilters(req),
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to generate CAPEX department report PDF",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${response.fileName}"`
    );
    res.setHeader("Content-Length", response.pdfBuffer.length);

    return res.status(STATUS_CODES.SUCCESS).send(response.pdfBuffer);
  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Organization Report PDF
exports.getCapexOrganizationReportPdf = async (req, res) => {
  try {
    const response =
      await CapexService.getCapexOrganizationReportPdf({
        Filters: {
          ...reportFilters(req),
          ...reportDateFilters(req),
        },
      });

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to generate CAPEX organization report PDF",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${response.fileName}"`
    );

    res.setHeader(
      "Content-Length",
      response.pdfBuffer.length
    );

    return res
      .status(STATUS_CODES.SUCCESS)
      .send(response.pdfBuffer);

  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Single Capex Report PDF
exports.generateCapexByIdPdf = async (req, res) => {
  try {
    const capexID = Number(req.params.id);

    if (!Number.isInteger(capexID) || capexID <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid CAPEX ID is required.",
      });
    }

    const result =
      await CapexService.generateCapexByIdPdf({
        CapexID: capexID,
        UserID:
          req.user?.UserID ||
          req.user?.userid ||
          null,
      });

    if (!result.success) {
      return res
        .status(
          result.statusCode ||
            result.StatusCode ||
            result.status ||
            500,
        )
        .json({
          success: false,
          message:
            result.message ||
            "Unable to generate CAPEX PDF.",
        });
    }

    if (!Buffer.isBuffer(result.PdfBuffer)) {
      return res.status(500).json({
        success: false,
        message: "Invalid PDF response generated.",
      });
    }

    res.setHeader(
      "Content-Type",
      result.ContentType || "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${result.FileName}"`,
    );

    res.setHeader(
      "Content-Length",
      result.PdfBuffer.length,
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate",
    );

    return res.end(result.PdfBuffer);
  } catch (error) {
    console.error(
      "Generate CAPEX PDF Controller Error:",
      error.message,
    );

    return res.status(500).json({
      success: false,
      message: "Unable to generate CAPEX PDF.",
    });
  }
};
