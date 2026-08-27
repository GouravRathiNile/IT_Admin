const service = require("../../services/ReportBuilderService/ReportBuilderService");

const ReportBuilderHandler = async (message) => {
  switch (message.action) {
    case "GET_REPORT_TYPES": return service.getTypes(message.data);
    case "GET_REPORT_CONFIG": return service.getConfig(message.data);
    case "GET_REPORT_OPTIONS": return service.getOptions(message.data);
    case "RUN_REGISTERED_REPORT": return service.run(message.data);
    case "EXPORT_REGISTERED_REPORT": return service.exportReport(message.data);
    default: return { success: false, statusCode: 400, message: "Invalid Report action." };
  }
};

module.exports = ReportBuilderHandler;
