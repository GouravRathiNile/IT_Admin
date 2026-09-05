const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
const HLPReportService = require("../../services/HLPReportService/HLPReportService");

// Audit identity always comes from the authenticated JWT, never request input.
const userID = (req) => {
  const id = Number(req.user?.UserID);
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError("Authenticated user is invalid", STATUS_CODES.UNAUTHORIZED);
  return id;
};
// Browsers may serialize an unselected dropdown as "undefined"/"null".
// Treat those placeholders as absent and continue to the next trusted source.
const normalizeOrganizationID = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return !normalized || normalized === "0" || ["undefined", "null"].includes(normalized.toLowerCase())
    ? undefined
    : normalized;
};
const firstOrganizationID = (...values) => {
  for (const value of values) {
    const normalized = normalizeOrganizationID(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
};
const queryOrganizationID = (req) => firstOrganizationID(
  req.query?.organizationId,
  req.query?.OrganizationID,
  req.query?.organizationid
);
const selectedOrganizationID = (req) => firstOrganizationID(
  queryOrganizationID(req),
  req.body?.OrganizationID,
  req.body?.organizationId,
  req.body?.organizationid,
  req.get("OrganizationID"),
  req.get("X-Organization-ID"),
  req.user?.OrganizationID
);
// Normalize organization aliases before service validation so lowercase client
// fields are not treated as unexpected input and the public service contract stays stable.
const bodyWithOrganizationID = (req) => {
  const body = req.body || {};
  const { OrganizationID: _upper, organizationId: _camel, organizationid: _lower, ...rest } = body;
  return { ...rest, OrganizationID: selectedOrganizationID(req) };
};
const bodyWithoutOrganizationID = (req) => {
  const body = req.body || {};
  const { OrganizationID: _upper, organizationId: _camel, organizationid: _lower, ...rest } = body;
  return rest;
};
// Shared JSON bridge for HLP controller-to-RabbitMQ communication.
const send = async (req, res, action, data, successStatus = STATUS_CODES.SUCCESS) => {
  try {
    const response = await producer.sendMessage(QUEUE.HLP_REPORT.REQUEST, QUEUE.HLP_REPORT.RESPONSE, {
      action, data: { ...data, UserID: userID(req) },
    });
    if (!response.success) throw new AppError(response.message || "Unable to process HLP Report request", response.statusCode || STATUS_CODES.BAD_REQUEST, response.errors);
    const responseStatus = response._httpStatus || successStatus;
    const publicResponse = { ...response };
    delete publicResponse._httpStatus;
    return res.status(response.queued ? 202 : responseStatus).json(publicResponse);
  } catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(new AppError("HLP Report service is temporarily unavailable. Please try again shortly.", STATUS_CODES.SERVICE_UNAVAILABLE), res);
    }
    return handleError(error, res);
  }
};

// GET/read operations call the service directly; mutation commands continue through RabbitMQ.
const sendDirect = async (req, res, operation, data = {}) => {
  try {
    const response = await operation({ ...data, UserID: userID(req) });
    if (!response.success) throw new AppError(response.message || "Unable to process HLP Report request", response.statusCode || STATUS_CODES.BAD_REQUEST, response.errors);
    return res.status(STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleError(error, res);
  }
};

// Master-page list returns configuration fields only.
exports.masterList = (req, res) => sendDirect(req, res, HLPReportService.getMasterList, {
  OrganizationID: selectedOrganizationID(req),
});

// Entry-page list resolves stored values for one organization and entry date.
exports.hlpList = (req, res) => sendDirect(req, res, HLPReportService.getHLPList, {
  OrganizationID: selectedOrganizationID(req),
  EntryDate: req.query?.entryDate ?? req.query?.EntryDate ?? req.query?.entrydate,
});
exports.createMasterField = (req, res) => send(req, res, "CREATE_HLP_MASTER_FIELD", {
  ...bodyWithOrganizationID(req),
}, STATUS_CODES.CREATED);
exports.importMasterFields = (req, res) => send(req, res, "IMPORT_HLP_MASTER_FIELDS", {
  ...bodyWithOrganizationID(req),
  File: req.file ? {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    bufferBase64: req.file.buffer.toString("base64"),
  } : null,
}, STATUS_CODES.CREATED);
exports.exportMasterFields = async (req, res) => {
  try {
    const response = await HLPReportService.exportMasterFields({
      UserID: userID(req),
      OrganizationID: selectedOrganizationID(req),
      // The master-page Export button downloads Excel unless CSV is explicitly requested.
      Format: req.query?.format ?? "excel",
    });
    if (!response.success) throw new AppError(response.message, response.statusCode || STATUS_CODES.BAD_REQUEST);
    const file = Buffer.from(response.fileBase64, "base64");
    res.setHeader("Content-Type", response.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${response.filename}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
    res.setHeader("Content-Length", file.length);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    return res.status(STATUS_CODES.SUCCESS).send(file);
  } catch (error) { return handleError(error, res); }
};
exports.reorderMasterFields = (req, res) => send(req, res, "REORDER_HLP_MASTER_FIELDS", {
  ...bodyWithOrganizationID(req),
});
exports.updateMasterField = (req, res) => send(req, res, "UPDATE_HLP_MASTER_FIELD", {
  ...bodyWithoutOrganizationID(req),
});
exports.deleteMasterField = (req, res) => send(req, res, "DELETE_HLP_MASTER_FIELD", {
  ...bodyWithoutOrganizationID(req),
});
// Create performs create-or-update using OrganizationID + EntryDate.
exports.create = (req, res) => {
  const body = bodyWithOrganizationID(req);
  return send(req, res, "CREATE_HLP_REPORT", body, STATUS_CODES.CREATED);
};
exports.update = (req, res) => send(req, res, "UPDATE_HLP_REPORT", bodyWithoutOrganizationID(req));
exports.monthlyReport = (req, res) => sendDirect(req, res, HLPReportService.getMonthlyReport, {
  OrganizationID: queryOrganizationID(req),
  Year: req.query?.year ?? req.query?.Year,
  Month: req.query?.month ?? req.query?.Month,
});
exports.lastYearReport = (req, res) => sendDirect(req, res, HLPReportService.getLastYearMonthlyReport, {
  OrganizationID: queryOrganizationID(req),
  Year: req.query?.year ?? req.query?.Year,
  Month: req.query?.month ?? req.query?.Month,
});

// PDF bytes travel through RabbitMQ as base64 and are restored before HTTP output.
const sendPdf = async (req, res, operation, data) => {
  try {
    const response = await operation({ ...data, UserID: userID(req) });
    if (!response.success) {
      throw new AppError(response.message || "Unable to generate HLP report PDF", response.statusCode || STATUS_CODES.BAD_REQUEST, response.errors);
    }
    const pdf = Buffer.from(response.pdfBase64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${response.filename}"`);
    res.setHeader("Content-Length", pdf.length);
    return res.status(STATUS_CODES.SUCCESS).send(pdf);
  } catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(new AppError("HLP Report service is temporarily unavailable. Please try again shortly.", STATUS_CODES.SERVICE_UNAVAILABLE), res);
    }
    return handleError(error, res);
  }
};

exports.monthlyReportPdf = (req, res) => sendPdf(req, res, HLPReportService.generateMonthlyReportPdf, {
  OrganizationID: queryOrganizationID(req),
  Year: req.query?.year ?? req.query?.Year,
  Month: req.query?.month ?? req.query?.Month,
});

exports.lastYearReportPdf = (req, res) => sendPdf(req, res, HLPReportService.generateLastYearReportPdf, {
  OrganizationID: queryOrganizationID(req),
  Year: req.query?.year ?? req.query?.Year,
  Month: req.query?.month ?? req.query?.Month,
});

// Validate the public route ID before dispatching individual PDF generation.
exports.reportPdf = async (req, res) => {
  try {
    const normalizedID = String(req.params?.id ?? "").trim();
    if (!/^\d+$/.test(normalizedID) || !Number.isSafeInteger(Number(normalizedID)) || Number(normalizedID) < 1) {
      throw new AppError("HLP report ID must be a positive integer", STATUS_CODES.BAD_REQUEST);
    }
    return sendPdf(req, res, HLPReportService.generateReportPdf, { ID: Number(normalizedID) });
  } catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(new AppError("HLP Report service is temporarily unavailable. Please try again shortly.", STATUS_CODES.SERVICE_UNAVAILABLE), res);
    }
    return handleError(error, res);
  }
};
