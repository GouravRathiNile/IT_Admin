const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
const { createDTO, updateDTO, listDTO, reportListDTO } = require("../../dto/GuestGlitchDTO");
const validator = require("../../validators/GuestGlitchValidator");
const uploadAttachment = require("../../AzurConfigration/GuestGlitch/AzureUpload");

const requestContext = (req) => ({
  OrganizationID: req.organizationID,
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

exports.list = (req, res) => execute(res, async () => {
  const data = listDTO(req.query || {});
  assertValid(validator.validateList(data));
  const response = await callQueue("LIST_GUEST_GLITCH", { ...data, ...requestContext(req) });
  return sendResponse(res, response);
});

exports.get = (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  const response = await callQueue("GET_GUEST_GLITCH", { ID: Number(req.params.id), ...requestContext(req) });
  return sendResponse(res, response);
});

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

exports.listOptions = (req, res) => execute(res, async () => {
  const response = await callQueue("LIST_GUEST_GLITCH_OPTIONS", { OptionType: req.query?.OptionType || null, ...requestContext(req) });
  return sendResponse(res, response);
});

exports.upsertOption = (req, res) => execute(res, async () => {
  assertValid(validator.validateOption(req.body || {}));
  const response = await callQueue("UPSERT_GUEST_GLITCH_OPTION", {
    OptionType: req.body.OptionType, OptionValue: String(req.body.OptionValue).trim(),
    DisplayName: req.body.DisplayName, Metadata: req.body.Metadata, SortOrder: req.body.SortOrder,
    IsActive: req.body.IsActive, ...requestContext(req),
  });
  return sendResponse(res, response);
});

const reportListController = (action) => (req, res) => execute(res, async () => {
  const data = reportListDTO(req.query || {});
  assertValid(validator.validateReportList(data));
  const response = await callQueue(action, { ...data, ...requestContext(req) });
  return sendResponse(res, response);
});

const idController = (action) => (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  const response = await callQueue(action, { ID: Number(req.params.id), ...requestContext(req) });
  return sendResponse(res, response);
});

exports.report = reportListController("REPORT_GUEST_GLITCH");
exports.masterReport = reportListController("MASTER_REPORT_GUEST_GLITCH");
exports.reportDetail = idController("REPORT_GUEST_GLITCH_DETAIL");
exports.gmView = idController("GET_GUEST_GLITCH_GM");

exports.masterReportPdf = (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  const response = await callQueue("MASTER_REPORT_GUEST_GLITCH_PDF", { ID: Number(req.params.id), ...requestContext(req) });
  if (!response.success) return sendResponse(res, response);
  const pdf = Buffer.from(response.pdfBase64, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${response.filename || `guest-glitch-${req.params.id}.pdf`}"`);
  res.setHeader("Content-Length", pdf.length);
  return res.status(STATUS_CODES.SUCCESS).send(pdf);
});

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

exports.attachment = (req, res) => execute(res, async () => {
  assertValidID(validator.validateID(req.params.id));
  assertValid(validator.validateDisposition(req.query?.disposition));
  const response = await callQueue("GET_GUEST_GLITCH_ATTACHMENT", {
    ID: Number(req.params.id), disposition: String(req.query?.disposition || "inline").toLowerCase(), ...requestContext(req),
  });
  return sendResponse(res, response);
});
