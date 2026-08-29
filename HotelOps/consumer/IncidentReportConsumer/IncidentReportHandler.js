const service = require("../../services/IncidentReportService/IncidentReportService");

// GET/report/export operations bypass this consumer; only mutations are dispatched here.
const IncidentReportHandler = async (message) => {
  switch (message.action) {
    case "CREATE_INCIDENT_REPORT": return service.create(message.data);
    case "UPDATE_INCIDENT_REPORT": return service.update(message.data);
    case "DELETE_INCIDENT_REPORT": return service.remove(message.data);
    default: return { success: false, statusCode: 400, message: "Invalid Incident Report action." };
  }
};

module.exports = IncidentReportHandler;
