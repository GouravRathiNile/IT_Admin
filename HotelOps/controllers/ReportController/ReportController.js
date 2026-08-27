const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");

const context = (req) => ({
  module: req.params.module,
  reportType: req.params.reportType,
  UserID: Number(req.user.UserID),
});
const callQueue = (action, data) => producer.sendMessage(
  QUEUE.REPORT_BUILDER.REQUEST, QUEUE.REPORT_BUILDER.RESPONSE, { action, data }
);
const sendResponse = (res, response) => {
  if (!response.success) throw new AppError(
    response.message || "Unable to process report request.",
    response.statusCode || STATUS_CODES.BAD_REQUEST,
    response.errors
  );
  return res.status(STATUS_CODES.SUCCESS).json(response);
};
const execute = async (res, work) => {
  try { return await work(); }
  catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(new AppError("Report service is temporarily unavailable. Please try again shortly.", 503), res);
    }
    if (error instanceof AppError) return handleError(error, res);
    console.error("Report Controller Error:", error.message);
    return handleError(new AppError("Unable to process report request", 500), res);
  }
};

exports.config = (req, res) => execute(res, async () => sendResponse(
  res, await callQueue("GET_REPORT_CONFIG", context(req))
));
exports.types = (req, res) => execute(res, async () => sendResponse(
  res, await callQueue("GET_REPORT_TYPES", {
    module: req.params.module, UserID: Number(req.user.UserID),
  })
));
exports.options = (req, res) => execute(res, async () => sendResponse(
  res, await callQueue("GET_REPORT_OPTIONS", {
    ...context(req), field: req.params.field, organizationId: req.query.organizationId,
  })
));
exports.run = (req, res) => execute(res, async () => sendResponse(
  res, await callQueue("RUN_REGISTERED_REPORT", { ...context(req), body: req.body || {} })
));

exports.exportReport = (req, res) => execute(res, async () => {
  const response = await callQueue("EXPORT_REGISTERED_REPORT", {
    ...context(req), body: req.body,
  });
  if (!response.success) return sendResponse(res, response);
  const file = Buffer.from(response.fileBase64, "base64");
  res.setHeader("Content-Type", response.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${response.filename}"`);
  res.setHeader("Content-Length", file.length);
  return res.status(STATUS_CODES.SUCCESS).send(file);
});
