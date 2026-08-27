const service = require("../../services/GuestGlitchService/GuestGlitchService");

const GuestGlitchHandler = async (message) => {
  switch (message.action) {
    case "CREATE_GUEST_GLITCH": return service.create(message.data);
    case "LIST_GUEST_GLITCH": return service.list(message.data);
    case "GET_GUEST_GLITCH": return service.get(message.data);
    case "UPDATE_GUEST_GLITCH": return service.update(message.data);
    case "DELETE_GUEST_GLITCH": return service.remove(message.data);
    case "UPDATE_GUEST_GLITCH_STATUS": return service.updateStatus(message.data);
    case "LIST_GUEST_GLITCH_OPTIONS": return service.listOptions(message.data);
    case "UPSERT_GUEST_GLITCH_OPTION": return service.upsertOption(message.data);
    case "REPORT_GUEST_GLITCH": return service.report(message.data);
    case "EXPORT_GUEST_GLITCH_REPORT": return service.exportReport(message.data);
    case "REPORT_GUEST_GLITCH_DETAIL": return service.reportDetail(message.data);
    case "MASTER_REPORT_GUEST_GLITCH": return service.masterReport(message.data);
    case "MASTER_REPORT_GUEST_GLITCH_PDF": return service.masterReportPdf(message.data);
    case "GET_GUEST_GLITCH_GM": return service.gmView(message.data);
    case "GUEST_GLITCH_GM_ACTION": return service.gmAction(message.data);
    case "GET_GUEST_GLITCH_ATTACHMENT": return service.attachment(message.data);
    default: return { success: false, statusCode: 400, message: "Invalid Guest Glitch action." };
  }
};

module.exports = GuestGlitchHandler;
