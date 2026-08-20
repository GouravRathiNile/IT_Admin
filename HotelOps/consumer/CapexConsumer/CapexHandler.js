const CapexService = require("../../services/CapexService/CapexService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const CapexHandler = async (message) => {
  try {
    switch (message.action) {
      // ====================================================== CRUD
      case "CREATE_CAPEX":
        return await CapexService.createCapex(message.data);

      case "UPDATE_CAPEX":
        return await CapexService.updateCapex(message.data);

      case "DELETE_CAPEX":
        return await CapexService.deleteCapex(message.data);

      // ====================================================== Approval Workflow
      case "PROCESS_CAPEX_APPROVAL":
        return await CapexService.processCapexApproval(message.data);

      // ====================================================== // CAPEX APPROVAL CONFIG CRUD
      case "CREATE_CAPEX_APPROVAL_CONFIG":
        return await CapexService.createApprovalConfig(message.data);

      case "GET_CAPEX_APPROVAL_CONFIG":
        return await CapexService.getApprovalConfig(message.data);

      case "DELETE_CAPEX_APPROVAL_CONFIG":
        return await CapexService.deleteApprovalConfig(message.data);

      // ====================================================== // CAPEX Pdf Apis
      case "GENERATE_CAPEX_LIST_PDF":
        return await CapexService.generateCapexListPdf(message.data);

      // Reject unknown queue actions instead of calling any service.
      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid CAPEX action.",
        };
    }
  } catch (error) {
    // Retry only transient database failures handled by the shared consumer.
    console.error("CAPEX Handler Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      statusCode: 500,
      message: "Unable to process CAPEX request.",
    };
  }
};

module.exports = CapexHandler;
