//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/Opex/AzureUpload");
// =========================================================Get Data From service
const OpexService = require("../../services/OpexService/OpexService");

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
    DepartmentName: String(req.user?.DepartmentName || "").trim(),
    LoginType: String(req.user?.LoginType || "").trim(),
  };
};
// Send Opex commands/queries through the shared RabbitMQ RPC producer.
const sendQueueResponse = async (res, action, data) => {
  const response = await producer.sendMessage(
    QUEUE.OPEX.REQUEST,
    QUEUE.OPEX.RESPONSE,
    { action, data }
  );

  if (!response.success) {
    throw new AppError(
      response.message || "Unable to fetch Opex data",
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
        "Opex service is temporarily unavailable. Please try again shortly.",
        STATUS_CODES.SERVICE_UNAVAILABLE
      ),
      res
    );
  }

  return handleError(error, res);
};

// ============================================================ Create Opex
exports.createOpex = async (req, res) => {
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
      QUEUE.OPEX.REQUEST,
      QUEUE.OPEX.RESPONSE,
      {
        action: "CREATE_Opex",
        data,
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to create Opex",
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
          "Opex service is temporarily unavailable. Please try again shortly.",
          STATUS_CODES.SERVICE_UNAVAILABLE
        ),
        res
      );
    }

    return handleError(error, res);
  }
};
// ============================================================ Get All Opex
exports.getAllOpex = async (req, res) => {
  try {
    const user = authenticatedUser(req);

    if (user.UserType.toUpperCase() === "HOD" && !user.DepartmentName) {
      throw new AppError(
        "Department information is required for HOD OPEX access",
        STATUS_CODES.FORBIDDEN
      );
    }

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

  const response = await OpexService.getAllOpex({
  ...user,
  OrganizationID,
  Status,
  page,
  PageSize,
});

if (!response.success) {
  throw new AppError(
    response.message || "Unable to fetch Opex records",
    response.statusCode || STATUS_CODES.BAD_REQUEST,
    response.errors
  );
}

return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================ Get Opex By ID
exports.getOpexById = async (req, res) => {
  try {
    if (!isPositiveInteger(req.params.id)) {
      throw new AppError(
        "Opex ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = authenticatedUser(req);
    
    const response = await OpexService.getOpexById({
      ...user,
      OpexID: Number(req.params.id),
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch Opex",
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
// ============================================================ Update Opex
exports.updateOpex = async (req, res) => {
  let uploadedDocuments = [];

  try {
    const body = req.body || {};

    // ============================================================
    // Opex ID FROM BODY
    // ============================================================

   

    const OpexID = body.OpexID;

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
    // BASIC Opex FIELDS
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
      "OpexApprovalID",
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
        "Approval fields cannot be changed through the Opex update API",
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
        "No Opex changes were provided",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ============================================================
    // SEND TO Opex QUEUE
    // ============================================================

    const response =
      await producer.sendMessage(
        QUEUE.OPEX.REQUEST,
        QUEUE.OPEX.RESPONSE,
        {
          action: "UPDATE_Opex",

          data: {
            OpexID,

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
          "Unable to update Opex",

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

// ============================================================ Soft Delete Opex
exports.deleteOpex = async (req, res) => {
  try {
    const OpexID = req.body.OpexID;

    if (!isPositiveInteger(OpexID)) {
      throw new AppError(
        "Opex ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.OPEX.REQUEST,
      QUEUE.OPEX.RESPONSE,
      {
        action: "DELETE_Opex",
        data: {
          OpexID: Number(OpexID),
          ...authenticatedUser(req),
        },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to delete Opex",
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
exports.approveOpex = async (req, res) => {
  try {
    const OpexID = req.body?.OpexID;

    if (!isPositiveInteger(Number(OpexID))) {
      throw new AppError(
        "Opex ID must be a positive integer",
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

    const user = authenticatedUser(req);

    const response = await producer.sendMessage(
      QUEUE.OPEX.REQUEST,
      QUEUE.OPEX.RESPONSE,
      {
        action: "PROCESS_Opex_APPROVAL",

        data: {
          OpexID: Number(OpexID),
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
          "Unable to process Opex approval",
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
exports.getOpexSummaryReport = async (req, res) => {
  try {
    if (!isPositiveInteger(req.query.OrganizationID)) {
      throw new AppError(
        "Organization ID is required and must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = authenticatedUser(req);
    const UserType = user.UserType.toUpperCase();

    if (UserType === "HOD" && !user.DepartmentName) {
      throw new AppError(
        "Department information is required for HOD OPEX access",
        STATUS_CODES.FORBIDDEN
      );
    }

    const response = await OpexService.getOpexSummaryReport({
      Filters: {
        OrganizationID: Number(req.query.OrganizationID),
      },
      UserType,
      DepartmentName: user.DepartmentName,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch Opex summary report",
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
exports.getOpexDepartmentReport = async (req, res) => {
  try {
    const response = await OpexService.getOpexDepartmentReport({
      Filters: reportFilters(req),
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch Opex department report",
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
exports.getOpexOrganizationReport = async (req, res) => {
  try {
    const response = await OpexService.getOpexOrganizationReport({
      Filters: reportFilters(req),
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch Opex organization report",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================CREATE Opex APPROVAL CONFIG
exports.createOpexApprovalConfig = async (req, res) => {
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
      "CREATE_Opex_APPROVAL_CONFIG",
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
// ============================================================GET ALL Opex APPROVAL CONFIG
exports.getOpexApprovalConfig = async (req, res) => {
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

    const response = await OpexService.getApprovalConfig({
      OrganizationID,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch Opex approval configuration",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleControllerError(error, res);
  }
};
// ============================================================DELETE Opex APPROVAL CONFIG
exports.deleteOpexApprovalConfig = async (req, res) => {
  try {
    const { OpexApprovalConfigID } = req.body || {};

    if (!isPositiveInteger(OpexApprovalConfigID)) {
      throw new AppError(
        "Opex Approval Config ID must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const user = authenticatedUser(req);

    return await sendQueueResponse(
      res,
      "DELETE_Opex_APPROVAL_CONFIG",
      {
        ...user,
        OpexApprovalConfigID: Number(OpexApprovalConfigID),
      }
    );
  } catch (error) {
    return handleControllerError(error, res);
  }
};

// ============================================================PDF Apis
// ============================================================Generate Opex List PDF
exports.generateOpexListPdf = async (req, res) => {
  try {
    // ================= OrganizationID =================

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

    // ================= Send To Queue =================

    const user = authenticatedUser(req);

    return await sendQueueResponse(res, "GENERATE_Opex_LIST_PDF", {
      ...user,
      OrganizationID,
      Status,
    });
  } catch (error) {
    return handleControllerError(error, res);
  }
};
