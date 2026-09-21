const DailyBreakageService = require("../../services/DailyBreakageService/DailyBreakageService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const DailyBreakageHandler = async (message) => {
  try {
    switch (message.action) {
      // ====================================================== Create
      case "CREATE_DAILY_BREAKAGE":
        return await DailyBreakageService.createDailyBreakage(message.data);
      // ====================================================== Update
      case "UPDATE_DAILY_BREAKAGE":
        return await DailyBreakageService.updateDailyBreakage(message.data);
      // ====================================================== Delete
      case "DELETE_DAILY_BREAKAGE":
        return await DailyBreakageService.deleteDailyBreakage(message.data);
      // ====================================================== Invalid

      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid Daily Breakage action.",
        };
    }
  } catch (error) {
    console.error("Daily Breakage Handler Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return {
      success: false,
      statusCode: 500,
      message: "Unable to process Daily Breakage request.",
    };
  }
};

module.exports = DailyBreakageHandler;
