const GuestMeetService = require("../../services/GuestMeetService/GuestMeetService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const GuestMeetHandler = async (message) => {
  try {
    switch (message.action) {
      // ====================================================== Daily Entry
      case "CREATE_GUEST_MEET_DAILY":
        return await GuestMeetService.createDailyEntry(message.data);

      case "DELETE_GUEST_MEET_DAILY":
        return await GuestMeetService.deleteDailyEntry(message.data);

      // ====================================================== Guest Detail
      case "CREATE_GUEST_MEET_DETAIL":
        return await GuestMeetService.createGuestDetail(message.data);

      case "UPDATE_GUEST_MEET_DETAIL":
        return await GuestMeetService.updateGuestDetail(message.data);

      case "DELETE_GUEST_MEET_DETAIL":
        return await GuestMeetService.deleteGuestDetail(message.data);

      
      // ====================================================== Reject unknown actions
      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid Guest Meet action.",
        };
    }
  } catch (error) {
    // Retry only transient database failures handled by the shared consumer.
    console.error("Guest Meet Handler Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      statusCode: 500,
      message: "Unable to process Guest Meet request.",
    };
  }
};

module.exports = GuestMeetHandler;