const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
const ReportBuilderService = require("../../services/ReportBuilderService/ReportBuilderService");

// Construct the trusted registry lookup context from route parameters and JWT identity.
const context = (req) => ({
  module: req.params.module,
  reportType: req.params.reportType,
  UserID: Number(req.user.UserID),
});
// POST run/export operations intentionally retain the existing RabbitMQ flow.
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
// Provide one safe error boundary for direct metadata reads and queued report jobs.
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

// Registry metadata/options are read-only and therefore call the service directly.
exports.config = (req, res) => execute(res, async () => sendResponse(
  res, await ReportBuilderService.getConfig(context(req))
));
exports.types = (req, res) => execute(res, async () => sendResponse(
  res, await ReportBuilderService.getTypes({
    module: req.params.module, UserID: Number(req.user.UserID),
  })
));
exports.options = (req, res) => execute(res, async () => sendResponse(
  res, await ReportBuilderService.getOptions({
    ...context(req), field: req.params.field, organizationId: req.query.organizationId,
  })
));
// Report execution remains queued in this phase by design.
exports.run = (req, res) => execute(res, async () => sendResponse(
  res, await callQueue("RUN_REGISTERED_REPORT", { ...context(req), body: req.body || {} })
));

// Export remains queued; base64 is converted back to bytes before the HTTP response.
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
