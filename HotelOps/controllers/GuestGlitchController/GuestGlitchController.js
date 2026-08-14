const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
const { createDTO, updateDTO, listDTO } = require("../../dto/GuestGlitchDTO");
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
    return handleError(new AppError("Unable to process the request at this time.", 500), res);
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
  const data = listDTO(req.body || {});
  assertValid(validator.validateList(data));
  const response = await callQueue("LIST_GUEST_GLITCH", { ...data, ...requestContext(req) });
  return sendResponse(res, response);
});

exports.get = (req, res) => execute(res, async () => {
  assertValid(validator.validateID(req.body || {}));
  const response = await callQueue("GET_GUEST_GLITCH", { ID: Number(req.body.ID ?? req.body.id), ...requestContext(req) });
  return sendResponse(res, response);
});

exports.update = (req, res) => execute(res, async () => {
  const validation = validator.validateUpdate(req.body || {});
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
  assertValid(validator.validateID(req.body || {}));
  const response = await callQueue("DELETE_GUEST_GLITCH", { ID: Number(req.body.ID ?? req.body.id), ...requestContext(req) });
  return sendResponse(res, response);
});

exports.updateStatus = (req, res) => execute(res, async () => {
  assertValid(validator.validateStatus(req.body || {}));
  const response = await callQueue("UPDATE_GUEST_GLITCH_STATUS", {
    ID: Number(req.body.ID ?? req.body.id), Status: String(req.body.Status ?? req.body.status).trim(),
    ResolvedBy: req.body.ResolvedBy ?? req.body.resolvedBy, ...requestContext(req),
  });
  return sendResponse(res, response);
});

exports.listOptions = (req, res) => execute(res, async () => {
  const response = await callQueue("LIST_GUEST_GLITCH_OPTIONS", { OptionType: req.body?.OptionType || null, ...requestContext(req) });
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
