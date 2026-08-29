const service = require("../../services/GuestGlitchService/GuestGlitchService");

// Only mutation commands belong on this consumer. GET/read APIs call the service directly.
const GuestGlitchHandler = async (message) => {
  switch (message.action) {
    case "CREATE_GUEST_GLITCH": return service.create(message.data);
    case "UPDATE_GUEST_GLITCH": return service.update(message.data);
    case "DELETE_GUEST_GLITCH": return service.remove(message.data);
    case "UPDATE_GUEST_GLITCH_STATUS": return service.updateStatus(message.data);
    case "UPSERT_GUEST_GLITCH_OPTION": return service.upsertOption(message.data);
    case "GUEST_GLITCH_GM_ACTION": return service.gmAction(message.data);
    default: return { success: false, statusCode: 400, message: "Invalid Guest Glitch action." };
  }
};

module.exports = GuestGlitchHandler;
