const service = require("../../services/HLPReportService/HLPReportService");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

module.exports = async (message) => {
  try {
    // Translate each queue action into one explicit HLP service operation.
    switch (message.action) {
      case "GET_HLP_MASTER_LIST": return await service.getMasterList(message.data);
      case "GET_HLP_LIST": return await service.getHLPList(message.data);
      case "CREATE_HLP_MASTER_FIELD": return await service.createMasterField(message.data);
      case "REORDER_HLP_MASTER_FIELDS": return await service.reorderMasterFields(message.data);
      case "UPDATE_HLP_MASTER_FIELD": return await service.updateMasterField(message.data);
      case "DELETE_HLP_MASTER_FIELD": return await service.deleteMasterField(message.data);
      case "CREATE_HLP_REPORT": return await service.createReport(message.data);
      case "UPDATE_HLP_REPORT": return await service.updateReport(message.data);
      case "GET_HLP_MONTHLY_REPORT": return await service.getMonthlyReport(message.data);
      case "GET_HLP_LAST_YEAR_REPORT": return await service.getLastYearReport(message.data);
      case "GENERATE_HLP_REPORT_PDF": return await service.generateReportPdf(message.data);
      case "GENERATE_HLP_MONTHLY_REPORT_PDF": return await service.generateMonthlyReportPdf(message.data);
      case "GENERATE_HLP_LAST_YEAR_REPORT_PDF": return await service.generateLastYearReportPdf(message.data);
      default: return { success: false, statusCode: 400, message: "Invalid HLP Report action." };
    }
  } catch (error) {
    // Technical details stay in server logs; callers receive a safe shared response.
    console.error("HLP Report Handler Error:", error.message);
    return retryableDatabaseResponse(error) || { success: false, statusCode: 500, message: "Unable to process HLP Report request." };
  }
};
