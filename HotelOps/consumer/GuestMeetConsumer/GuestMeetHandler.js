const service = require("../../services/GuestMeetService/GuestMeetService");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

// Map every RabbitMQ command to exactly one GuestMeet service operation.
const actions = {
  // Daily entry actions
  CREATE_GUEST_MEET_DAILY: service.createDailyEntry,
  GET_ALL_GUEST_MEET_DAILY: service.getAllDailyEntries,
  DELETE_GUEST_MEET_DAILY: service.deleteDailyEntry,

  // Guest detail actions
  CREATE_GUEST_MEET_DETAIL: service.createGuestDetail,
  UPDATE_GUEST_MEET_DETAIL: service.updateGuestDetail,
  DELETE_GUEST_MEET_DETAIL: service.deleteGuestDetail,
  GET_GUEST_MEET_DETAIL: service.getGuestDetailById,

  // Report actions
  REPORT_GUEST_MEET_DATE_RANGE: service.getDateRangeReport,
  REPORT_GUEST_MEET_FEEDBACK: service.getFeedbackReport,
  REPORT_GUEST_MEET_SUMMARY: service.getSummaryReport,
  REPORT_GUEST_MEET_MET_BY: service.getMetByReport,
};

// Consumer entrypoint used by the shared request/response RabbitMQ consumer.
module.exports = async (message) => {
  try {
    const handler = actions[message.action];
    if (!handler) {
      return { success: false, statusCode: 400, message: "Invalid Guest Meet action." };
    }
    return await handler(message.data);
  } catch (error) {
    console.error("Guest Meet Handler Error:", error.message);

    // Transient database failures are returned using the existing retry contract.
    return retryableDatabaseResponse(error) || {
      success: false,
      statusCode: 500,
      message: "Unable to process Guest Meet request.",
    };
  }
};
