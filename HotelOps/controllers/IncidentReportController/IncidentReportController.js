const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
const { createDTO, updateDTO, listDTO } = require("../../dto/IncidentReportDTO");
const validator = require("../../validators/IncidentReportValidator");
const IncidentReportService = require("../../services/IncidentReportService/IncidentReportService");

// Authentication and request metadata are trusted server-side service inputs.
const context = (req) => ({ UserID: Number(req.user.UserID), Username: req.user.Username, IP: req.ip });
// RabbitMQ remains available only for create/update/delete mutations.
const callQueue = (action, data) => producer.sendMessage(
  QUEUE.INCIDENT_REPORT.REQUEST, QUEUE.INCIDENT_REPORT.RESPONSE, { action, data }
);
const assertValid = (errors) => {
  if (errors.length) throw new AppError(errors.length === 1 ? errors[0].message : "Validation failed.", STATUS_CODES.BAD_REQUEST, errors);
};
const sendResponse = (res, response, status = STATUS_CODES.SUCCESS) => {
  if (!response.success) throw new AppError(response.message, response.statusCode || STATUS_CODES.BAD_REQUEST, response.errors);
  return res.status(response.queued ? 202 : status).json(response);
};
// Keep direct reads and queued mutations on the same public error contract.
const execute = async (res, work) => {
  try { return await work(); }
  catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(new AppError("Incident Report service is temporarily unavailable. Please try again shortly.", 503), res);
    }
    if (error instanceof AppError) return handleError(error, res);
    console.error("Incident Report Controller Error:", error.message);
    return handleError(new AppError("Unable to process Incident Report request", 500), res);
  }
};

// Mutation commands remain queued for the existing retry/consumer behavior.
exports.create = (req, res) => execute(res, async () => {
  assertValid(validator.validateCreate(req.body || {}));
  const response = await callQueue("CREATE_INCIDENT_REPORT", { Payload: createDTO(req.body), ...context(req) });
  return sendResponse(res, response, STATUS_CODES.CREATED);
});

// Read APIs validate request data in the controller and invoke the service directly.
exports.list = (req, res) => execute(res, async () => {
  const query = { ...listDTO(req.query || {}), organizationId: req.query?.organizationId ?? null };
  assertValid(validator.validateList(query));
  const response = await IncidentReportService.list({ Query: query, ...context(req) });
  return sendResponse(res, response);
});

exports.get = (req, res) => execute(res, async () => {
  assertValid(validator.validateID(req.params.id));
  const response = await IncidentReportService.get({ ID: String(req.params.id).trim(), ...context(req) });
  return sendResponse(res, response);
});

exports.update = (req, res) => execute(res, async () => {
  assertValid(validator.validateUpdate(req.body || {}));
  const dto = updateDTO(req.body);
  const { ID, ...Payload } = dto;
  const response = await callQueue("UPDATE_INCIDENT_REPORT", { ID: String(ID).trim(), Payload, ...context(req) });
  return sendResponse(res, response);
});

exports.remove = (req, res) => execute(res, async () => {
  const id = req.body?.ID ?? req.body?.id;
  assertValid(validator.validateID(id));
  const response = await callQueue("DELETE_INCIDENT_REPORT", { ID: String(id).trim(), ...context(req) });
  return sendResponse(res, response);
});

exports.report = (req, res) => execute(res, async () => {
  const query = { ...listDTO(req.query || {}), organizationId: req.query?.organizationId ?? null };
  assertValid(validator.validateList(query));
  const response = await IncidentReportService.report({ Query: query, ...context(req) });
  return sendResponse(res, response);
});

// CSV/Excel generation is read-only and returns service bytes as a download.
const exportController = (format) => (req, res) => execute(res, async () => {
  const query = { ...listDTO(req.query || {}), organizationId: req.query?.organizationId ?? null };
  assertValid(validator.validateList(query));
  const response = await IncidentReportService.exportReport({ Query: query, format, ...context(req) });
  if (!response.success) return sendResponse(res, response);
  const file = Buffer.from(response.fileBase64, "base64");
  res.setHeader("Content-Type", response.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${response.filename}"`);
  res.setHeader("Content-Length", file.length);
  return res.status(STATUS_CODES.SUCCESS).send(file);
});

exports.exportCSV = exportController("csv");
exports.exportExcel = exportController("excel");

// PDF is generated through the existing service/repository flow without RabbitMQ.
exports.reportPdf = (req, res) => execute(res, async () => {
  assertValid(validator.validateID(req.params.id));
  const response = await IncidentReportService.reportPdf({ ID: String(req.params.id).trim(), ...context(req) });
  if (!response.success) return sendResponse(res, response);
  const pdf = Buffer.from(response.pdfBase64, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${response.filename}"`);
  res.setHeader("Content-Length", pdf.length);
  return res.status(STATUS_CODES.SUCCESS).send(pdf);
});
