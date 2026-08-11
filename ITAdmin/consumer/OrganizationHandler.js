const OrganizationService = require("../services/OrganizationService");
const { retryableDatabaseResponse } = require("../utils/retryableDatabaseError");

const OrganizationHandler = async (message) => {
  try {
    switch (message.action) {
      // ======================================= Create Organization
      case "CREATE_ORGANIZATION":
        return await OrganizationService.createOrganization(message.data);
      // ======================================= Update Organization
      case "UPDATE_ORGANIZATION":
        return await OrganizationService.updateOrganization(message.data);
      case "DELETE_ORGANIZATION":
        return await OrganizationService.deleteOrganization(message.data);
      default:
        return {
          success: false,
          message: "Invalid Action",
        };
    }
  } catch (error) {
    console.log(error);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      message: error.message,
    };
  }
};

module.exports = OrganizationHandler;
