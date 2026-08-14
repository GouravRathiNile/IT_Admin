const CapexService = require("../../services/CapexService/CapexService");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

const CapexHandler = async (message) => {
  try {
    switch (message.action) {
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

      case "PROCESS_CAPEX_APPROVAL":
        return await CapexService.processCapexApproval(message.data);

      case "GET_CAPEX_SUMMARY_REPORT":
        return await CapexService.getCapexSummaryReport(message.data);

      case "GET_CAPEX_STATUS_REPORT":
        return await CapexService.getCapexStatusReport(message.data);

      case "GET_CAPEX_DEPARTMENT_REPORT":
        return await CapexService.getCapexDepartmentReport(message.data);

      case "GET_CAPEX_ORGANIZATION_REPORT":
        return await CapexService.getCapexOrganizationReport(message.data);

      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid CAPEX action.",
        };
    }
  } catch (error) {
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
