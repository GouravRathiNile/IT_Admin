const service = require("../../services/ReportBuilderService/ReportBuilderService");

// Metadata GETs call the service directly; this consumer handles queued run/export work.
const ReportBuilderHandler = async (message) => {
  switch (message.action) {
    case "RUN_REGISTERED_REPORT": return service.run(message.data);
    case "EXPORT_REGISTERED_REPORT": return service.exportReport(message.data);
    default: return { success: false, statusCode: 400, message: "Invalid Report action." };
  }
};

module.exports = ReportBuilderHandler;
