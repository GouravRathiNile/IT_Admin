const service = require("../../services/IncidentReportService/IncidentReportService");

const IncidentReportHandler = async (message) => {
  switch (message.action) {
    case "CREATE_INCIDENT_REPORT": return service.create(message.data);
    case "LIST_INCIDENT_REPORTS": return service.list(message.data);
    case "GET_INCIDENT_REPORT": return service.get(message.data);
    case "UPDATE_INCIDENT_REPORT": return service.update(message.data);
    case "DELETE_INCIDENT_REPORT": return service.remove(message.data);
    case "REPORT_INCIDENT_REPORTS": return service.report(message.data);
    case "EXPORT_INCIDENT_REPORTS": return service.exportReport(message.data);
    case "INCIDENT_REPORT_PDF": return service.reportPdf(message.data);
    default: return { success: false, statusCode: 400, message: "Invalid Incident Report action." };
  }
};

module.exports = IncidentReportHandler;
