// ============================================================ Service
const CreditApplicationService = require("../../services/CreditApplicationService/CreditApplicationService");
// ============================================================ Database Error
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

// ============================================================ Credit Application Handler
const CreditApplicationHandler = async (message) => {
  try {
    switch (message.action) {
      // ======================================================== Create
      case "CREATE_CREDIT_APPLICATION":
        return await CreditApplicationService.createCreditApplication(
          message.data,
        );
      // ======================================================== Update
      case "UPDATE_CREDIT_APPLICATION":
        return await CreditApplicationService.updateCreditApplication(
          message.data,
        );
      // ======================================================== delete
      case "DELETE_CREDIT_APPLICATION":
        return await CreditApplicationService.deleteCreditApplication(
          message.data,
        );
      // ======================================================== Approve
      case "PROCESS_CREDIT_APPLICATION_APPROVAL":
        return await CreditApplicationService.processCreditApplicationApproval(
          message.data,
        );
      // ======================================================== Update AR Id
      case "UPDATE_CREDIT_APPLICATION_ARID":
        return await CreditApplicationService.updateCreditApplicationARID(
          message.data,
        );
      // ======================================================== Create Config
      case "CREATE_CREDIT_APPLICATION_APPROVAL_CONFIG":
        return await CreditApplicationService.createCreditApplicationApprovalConfig(
          message.data,
        );
      // ======================================================== Delete Config
      case "DELETE_CREDIT_APPLICATION_APPROVAL_CONFIG":
        return await CreditApplicationService.deleteCreditApplicationApprovalConfig(
          message.data,
        );

      // ========================================================
      // Invalid Action
      // ========================================================

      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid Credit Application action.",
        };
    }
  } catch (error) {
    console.error("Credit Application Handler Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return {
      success: false,
      statusCode: 500,
      message: "Unable to process Credit Application request.",
    };
  }
};

module.exports = CreditApplicationHandler;
