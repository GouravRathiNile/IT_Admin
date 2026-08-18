//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/Capex/AzureUpload");

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

    // ================= Status =================

    let Status = null;

    if (
      req.query.Status !== undefined &&
      req.query.Status !== null &&
      String(req.query.Status).trim() !== ""
    ) {
      Status = String(req.query.Status).trim().toUpperCase();

      if (!["PENDING", "APPROVED", "REJECTED"].includes(Status)) {
        throw new AppError(
          "Status must be Pending, Approved, or Rejected",
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

    return await sendQueueResponse(res, "GET_ALL_CAPEX", {
      ...user,
      OrganizationID,
      Status,
      page,
      PageSize,
    });

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
    return await sendQueueResponse(res, "GET_CAPEX_BY_ID", {
      ...user,
      CapexID: Number(req.params.id),
    });
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

    if (!["APPROVE", "REJECT", "RETURN"].includes(action)) {
      throw new AppError(
        "Action must be APPROVE, REJECT, or RETURN",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const remarks =
      typeof req.body?.Remarks === "string"
        ? req.body.Remarks.trim()
        : "";

    if (
      ["REJECT", "RETURN"].includes(action) &&
      !remarks
    ) {
      throw new AppError(
        `Remarks are required when the action is ${action}`,
        STATUS_CODES.BAD_REQUEST
      );
    }

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
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
};

// Validate optional report filters without trusting organization access.
const reportFilters = (req) => {
  const {
    OrganizationID,
    Department,
    Status,
    FromDate,
    ToDate,
  } = req.query || {};

  if (OrganizationID !== undefined && !isPositiveInteger(OrganizationID)) {
    throw new AppError(
      "Organization ID must be a positive integer",
      STATUS_CODES.BAD_REQUEST
    );
  }

  const department = typeof Department === "string" && Department.trim()
    ? Department.trim()
    : null;
  const status = typeof Status === "string" && Status.trim()
    ? Status.trim().toUpperCase()
    : null;
  const allowedStatuses = ["PENDING", "APPROVED", "REJECTED", "RETURNED", "VOID"];

  if (status && !allowedStatuses.includes(status)) {
    throw new AppError(
      "Status must be Pending, Approved, Rejected, Returned, or Void",
      STATUS_CODES.BAD_REQUEST
    );
  }

  for (const [fieldName, value] of [["FromDate", FromDate], ["ToDate", ToDate]]) {
    if (value !== undefined && (!value || !validDate(String(value)))) {
      throw new AppError(
        `${fieldName} must be in YYYY-MM-DD format`,
        STATUS_CODES.BAD_REQUEST
      );
    }
  }

  if (FromDate && ToDate && String(FromDate) > String(ToDate)) {
    throw new AppError(
      "FromDate cannot be later than ToDate",
      STATUS_CODES.BAD_REQUEST
    );
  }

  return {
    OrganizationID: OrganizationID === undefined ? null : Number(OrganizationID),
    Department: department,
    Status: status,
    FromDate: FromDate ? String(FromDate) : null,
    ToDate: ToDate ? String(ToDate) : null,
  };
};

// All reports use the same JWT context and RabbitMQ request flow.
const getReport = async (req, res, action) => {
  try {
    const user = authenticatedUser(req);
    return await sendQueueResponse(res, action, {
      UserID: user.UserID,
      Filters: reportFilters(req),
    });
  } catch (error) {
    return handleControllerError(error, res);
  }
};

// ============================================================ Summary Report
exports.getCapexSummaryReport = (req, res) => getReport(
  req,
  res,
  "GET_CAPEX_SUMMARY_REPORT"
);

// ============================================================ Status Report
exports.getCapexStatusReport = (req, res) => getReport(
  req,
  res,
  "GET_CAPEX_STATUS_REPORT"
);

// ============================================================ Department Report
exports.getCapexDepartmentReport = (req, res) => getReport(
  req,
  res,
  "GET_CAPEX_DEPARTMENT_REPORT"
);

// ============================================================ Organization Report
exports.getCapexOrganizationReport = (req, res) => getReport(
  req,
  res,
  "GET_CAPEX_ORGANIZATION_REPORT"
);
