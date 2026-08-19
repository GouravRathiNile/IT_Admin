const CapexService = require("../../services/CapexService/CapexService");
const {retryableDatabaseResponse} = require("../../utils/retryableDatabaseError");

const CapexHandler = async (message) => {
  try {
    switch (message.action) {
      // ====================================================== CRUD
      case "CREATE_CAPEX":
        return await CapexService.createCapex(message.data);

      case "GET_ALL_CAPEX":
        return await CapexService.getAllCapex(message.data);

      case "GET_CAPEX_BY_ID":
        return await CapexService.getCapexById(message.data);

      case "UPDATE_CAPEX":
        return await CapexService.updateCapex(message.data);

      case "DELETE_CAPEX":
        return await CapexService.deleteCapex(message.data);

      // ====================================================== Approval Workflow
      case "PROCESS_CAPEX_APPROVAL":
        return await CapexService.processCapexApproval(message.data);

      // ====================================================== Reports
      case "GET_CAPEX_SUMMARY_REPORT":
        return await CapexService.getCapexSummaryReport(message.data);

      case "GET_CAPEX_DEPARTMENT_REPORT":
        return await CapexService.getCapexDepartmentReport(message.data);

      case "GET_CAPEX_ORGANIZATION_REPORT":
        return await CapexService.getCapexOrganizationReport(message.data);

      // ====================================================== // CAPEX APPROVAL CONFIG CRUD
      case "CREATE_CAPEX_APPROVAL_CONFIG":
        return await CapexService.createApprovalConfig(message.data);

      case "GET_CAPEX_APPROVAL_CONFIG":
        return await CapexService.getApprovalConfig(message.data);

      case "DELETE_CAPEX_APPROVAL_CONFIG":
        return await CapexService.deleteApprovalConfig(message.data);


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
