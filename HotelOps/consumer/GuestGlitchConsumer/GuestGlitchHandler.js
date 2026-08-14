const service = require("../../services/GuestGlitchService/GuestGlitchService");

const GuestGlitchHandler = async (message) => {
  switch (message.action) {
    case "CREATE_GUEST_GLITCH": return service.create(message.data);
    case "LIST_GUEST_GLITCH": return service.list(message.data);
    case "GET_GUEST_GLITCH": return service.get(message.data);
    case "UPDATE_GUEST_GLITCH": return service.update(message.data);
    case "DELETE_GUEST_GLITCH": return service.remove(message.data);
    case "UPDATE_GUEST_GLITCH_STATUS": return service.updateStatus(message.data);
    case "LIST_GUEST_GLITCH_OPTIONS": return service.listOptions(message.data);
    case "UPSERT_GUEST_GLITCH_OPTION": return service.upsertOption(message.data);
    default: return { success: false, statusCode: 400, message: "Invalid Guest Glitch action." };
  }
};

module.exports = GuestGlitchHandler;
