const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
const { createDTO, updateDTO, listDTO, reportListDTO } = require("../../dto/GuestGlitchDTO");
const validator = require("../../validators/GuestGlitchValidator");
const uploadAttachment = require("../../AzurConfigration/GuestGlitch/AzureUpload");
const GuestGlitchService = require("../../services/GuestGlitchService/GuestGlitchService");

// Build trusted service context exclusively from the authenticated request.
const requestContext = (req) => ({
  UserID: Number(req.user.UserID),
  Username: String(req.user.Username || req.user.UserID),
  IP: req.ip,
});

const assertValid = (errors) => {
  if (errors.length) throw new AppError("Validation failed.", STATUS_CODES.BAD_REQUEST, errors);
};

const assertValidID = (errors) => {
  if (errors.length) throw new AppError(errors[0].message, STATUS_CODES.BAD_REQUEST);
};

// RabbitMQ is intentionally limited to Guest Glitch mutation commands.
const callQueue = async (action, data) => producer.sendMessage(
  QUEUE.GUEST_GLITCH.REQUEST,
  QUEUE.GUEST_GLITCH.RESPONSE,
  { action, data }
);

const sendResponse = (res, response, successStatus = STATUS_CODES.SUCCESS) => {
  if (!response.success) throw new AppError(
    response.message || "Unable to process the request at this time.",
    response.statusCode || STATUS_CODES.BAD_REQUEST,
    response.errors
  );
  return res.status(response.queued ? 202 : successStatus).json(response);
};

// Normalize direct-service and queued-command failures through one error contract.
const execute = async (res, work) => {
  try { return await work(); }
  catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(new AppError("Guest Glitch service is temporarily unavailable. Please try again shortly.", 503), res);
    }
    if (error instanceof AppError) return handleError(error, res);
    console.error("Guest Glitch Controller Error:", error.message);
    return handleError(new AppError("Unable to process Guest Glitch request", 500), res);
  }
};

// Mutation: validate/upload first, then enqueue creation for retry-aware processing.
exports.create = (req, res) => execute(res, async () => {
  const validation = validator.validateCreate(req.body || {});
  assertValid(validation.errors);
  const data = createDTO(validation.data);
  if (req.file) {
    data.Attachment = await uploadAttachment(req.file);
    data.AttachmentTitle = data.AttachmentTitle || req.file.originalname.slice(0, 250);
  }
  const response = await callQueue("CREATE_GUEST_GLITCH", { ...data, ...requestContext(req) });
  return sendResponse(res, response, STATUS_CODES.CREATED);
});

// Read: list and detail calls bypass RabbitMQ and retain service organization scoping.
exports.list = (req, res) => execute(res, async () => {
  const data = listDTO(req.query || {});
  assertValid(validator.validateList(data));
  const response = await GuestGlitchService.list({ ...data, ...requestContext(req) });
  return sendResponse(res, response);
});

exports.get = (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  const response = await GuestGlitchService.get({ ID: Number(req.params.id), ...requestContext(req) });
  return sendResponse(res, response);
});

// Mutations continue through RabbitMQ; audit identity remains server-derived.
exports.update = (req, res) => execute(res, async () => {
  const validation = validator.validateUpdate(req.body || {});
  if (validation.errors[0]?.field === "ID") assertValidID([validation.errors[0]]);
  assertValid(validation.errors);
  const data = updateDTO(validation.data);
  if (req.file) {
    data.Attachment = await uploadAttachment(req.file);
    data.AttachmentTitle = data.AttachmentTitle || req.file.originalname.slice(0, 250);
  }
  const response = await callQueue("UPDATE_GUEST_GLITCH", { ...data, ID: Number(data.ID), ...requestContext(req) });
  return sendResponse(res, response);
});

exports.remove = (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.body || {}));
  const response = await callQueue("DELETE_GUEST_GLITCH", { ID: Number(req.body.ID ?? req.body.id), ...requestContext(req) });
  return sendResponse(res, response);
});

exports.updateStatus = (req, res) => execute(res, async () => {
  const statusErrors = validator.validateStatus(req.body || {});
  if (statusErrors[0]?.field === "ID") assertValidID([statusErrors[0]]);
  assertValid(statusErrors);
  const response = await callQueue("UPDATE_GUEST_GLITCH_STATUS", {
    ID: Number(req.body.ID ?? req.body.id), Status: String(req.body.Status ?? req.body.status).trim(),
    ResolvedBy: req.body.ResolvedBy ?? req.body.resolvedBy, ...requestContext(req),
  });
  return sendResponse(res, response);
});

// Read-only option lookup calls the existing organization-aware service directly.
exports.listOptions = (req, res) => execute(res, async () => {
  const response = await GuestGlitchService.listOptions({ OptionType: req.query?.OptionType || null, ...requestContext(req) });
  return sendResponse(res, response);
});

// Option configuration changes remain queued as mutation operations.
exports.upsertOption = (req, res) => execute(res, async () => {
  assertValid(validator.validateOption(req.body || {}));
  const response = await callQueue("UPSERT_GUEST_GLITCH_OPTION", {
    OptionType: req.body.OptionType, OptionValue: String(req.body.OptionValue).trim(),
    DisplayName: req.body.DisplayName, Metadata: req.body.Metadata, SortOrder: req.body.SortOrder,
    IsActive: req.body.IsActive, ...requestContext(req),
  });
  return sendResponse(res, response);
});

// Shared direct-read controllers preserve report filter and ID validation behavior.
const reportListController = (operation) => (req, res) => execute(res, async () => {
  const data = reportListDTO(req.query || {});
  assertValid(validator.validateReportList(data));
  const response = await operation({ ...data, ...requestContext(req) });
  return sendResponse(res, response);
});

const idController = (operation) => (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  const response = await operation({ ID: Number(req.params.id), ...requestContext(req) });
  return sendResponse(res, response);
});

exports.report = reportListController(GuestGlitchService.report);
exports.masterReport = reportListController(GuestGlitchService.masterReport);
exports.reportDetail = idController(GuestGlitchService.reportDetail);
exports.gmView = idController(GuestGlitchService.gmView);

// Export data is produced directly by the service and returned as an HTTP download.
const exportController = (format) => (req, res) => execute(res, async () => {
  const data = reportListDTO(req.query || {});
  assertValid(validator.validateReportList(data));
  const response = await GuestGlitchService.exportReport({ ...data, format, ...requestContext(req) });
  if (!response.success) return sendResponse(res, response);
  const file = Buffer.from(response.fileBase64, "base64");
  res.setHeader("Content-Type", response.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${response.filename}"`);
  res.setHeader("Content-Length", file.length);
  return res.status(STATUS_CODES.SUCCESS).send(file);
});

exports.exportCSV = exportController("csv");
exports.exportExcel = exportController("excel");

// PDF base64 is an internal service representation; the public response is binary.
exports.masterReportPdf = (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  const response = await GuestGlitchService.masterReportPdf({ ID: Number(req.params.id), ...requestContext(req) });
  if (!response.success) return sendResponse(res, response);
  const pdf = Buffer.from(response.pdfBase64, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${response.filename || `guest-glitch-${req.params.id}.pdf`}"`);
  res.setHeader("Content-Length", pdf.length);
  return res.status(STATUS_CODES.SUCCESS).send(pdf);
});

// GM action changes state and therefore remains on the mutation queue.
exports.gmAction = (req, res) => execute(res, async () => {
  const errors = validator.validateGMAction(req.body || {});
  if (errors[0]?.field === "ID") assertValidID([errors[0]]);
  assertValid(errors);
  const response = await callQueue("GUEST_GLITCH_GM_ACTION", {
    ID: Number(req.body.ID ?? req.body.id), GMComment: String(req.body.GMComment).trim(),
    Status: req.body.Status, ResolvedBy: req.body.ResolvedBy, ...requestContext(req),
  });
  return sendResponse(res, response);
});

// Attachment reads return the service-generated, organization-scoped SAS URL.
exports.attachment = (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  assertValid(validator.validateDisposition(req.query?.disposition));
  const response = await GuestGlitchService.attachment({
    ID: Number(req.params.id), disposition: String(req.query?.disposition || "inline").toLowerCase(), ...requestContext(req),
  });
  return sendResponse(res, response);
});
