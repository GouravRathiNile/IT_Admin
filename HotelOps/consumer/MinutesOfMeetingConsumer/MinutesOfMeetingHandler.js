const MinutesOfMeetingService = require("../../services/MinutesOfMeetingService/MinutesOfMeetingService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const MOMHandler = async (message) => {
  try {
    switch (message.action) {
      // ====================================================== Create
      case "CREATE_MOM":
        return await MinutesOfMeetingService.createMOM(message.data);
      // ====================================================== Update
      case "UPDATE_MOM":
        return await MinutesOfMeetingService.updateMOM(message.data);
      // ====================================================== Delete
      case "DELETE_MOM":
        return await MinutesOfMeetingService.deleteMOM(message.data);
      // ====================================================== Update Status
      case "UPDATE_MOM_STATUS":
        return await MinutesOfMeetingService.updateMOMStatus(message.data);
      // ====================================================== Invalid Action
      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid MOM action.",
        };
    }
  } catch (error) {
    console.error("MOM Handler Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return {
      success: false,
      statusCode: 500,
      message: "Unable to process MOM request.",
    };
  }
};

module.exports = MOMHandler;
