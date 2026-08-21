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

      case "GET_ALL_GUEST_MEET_DAILY":
        return await GuestMeetService.getAllDailyEntries(message.data);

      case "DELETE_GUEST_MEET_DAILY":
        return await GuestMeetService.deleteDailyEntry(message.data);

      // ====================================================== Guest Detail
      case "CREATE_GUEST_MEET_DETAIL":
        return await GuestMeetService.createGuestDetail(message.data);

      case "UPDATE_GUEST_MEET_DETAIL":
        return await GuestMeetService.updateGuestDetail(message.data);

      case "DELETE_GUEST_MEET_DETAIL":
        return await GuestMeetService.deleteGuestDetail(message.data);

      case "GET_GUEST_MEET_DETAIL":
        return await GuestMeetService.getGuestDetailById(message.data);

      // ====================================================== Reports
      case "REPORT_GUEST_MEET_DATE_RANGE":
        return await GuestMeetService.getDateRangeReport(message.data);

      case "REPORT_GUEST_MEET_FEEDBACK":
        return await GuestMeetService.getFeedbackReport(message.data);

      case "REPORT_GUEST_MEET_SUMMARY":
        return await GuestMeetService.getSummaryReport(message.data);

      case "REPORT_GUEST_MEET_MET_BY":
        return await GuestMeetService.getMetByReport(message.data);

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