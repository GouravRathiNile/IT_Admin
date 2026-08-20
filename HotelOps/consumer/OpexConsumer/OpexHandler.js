const OpexService = require("../../services/OpexService/OpexService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const OpexHandler = async (message) => {
  try {
    switch (message.action) {
      // ====================================================== CRUD
      case "CREATE_Opex":
        return await OpexService.createOpex(message.data);

      case "UPDATE_Opex":
        return await OpexService.updateOpex(message.data);

      case "DELETE_Opex":
        return await OpexService.deleteOpex(message.data);

      // ====================================================== Approval Workflow
      case "PROCESS_Opex_APPROVAL":
        return await OpexService.processOpexApproval(message.data);

      // ====================================================== // Opex APPROVAL CONFIG CRUD
      case "CREATE_Opex_APPROVAL_CONFIG":
        return await OpexService.createApprovalConfig(message.data);

      case "GET_Opex_APPROVAL_CONFIG":
        return await OpexService.getApprovalConfig(message.data);

      case "DELETE_Opex_APPROVAL_CONFIG":
        return await OpexService.deleteApprovalConfig(message.data);

      // ====================================================== // Opex Pdf Apis
      case "GENERATE_Opex_LIST_PDF":
        return await OpexService.generateOpexListPdf(message.data);

      // Reject unknown queue actions instead of calling any service.
      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid Opex action.",
        };
    }
  } catch (error) {
    // Retry only transient database failures handled by the shared consumer.
    console.error("Opex Handler Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      statusCode: 500,
      message: "Unable to process Opex request.",
    };
  }
};

module.exports = OpexHandler;
