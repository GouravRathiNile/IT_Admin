const EngineeringService = require("../../services/EngineeringService/EngineeringService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const EngineeringHandler = async (message) => {
  try {
    switch (message.action) {
      // ============================================================Equipment Entry
      case "CREATE_ENGINEERING_EQUIPMENT":
        return await EngineeringService.createEquipment(message.data);

      case "UPDATE_ENGINEERING_EQUIPMENT":
        return await EngineeringService.updateEquipment(message.data);

      case "DELETE_ENGINEERING_EQUIPMENT":
        return await EngineeringService.deleteEquipment(message.data);

      // ================================================================Breakdown of Equipment
      case "CREATE_ENGINEERING_BREAKDOWN":
        return await EngineeringService.createBreakdown(message.data);

      case "UPDATE_ENGINEERING_BREAKDOWN":
        return await EngineeringService.updateBreakdown(message.data);

      case "DELETE_ENGINEERING_BREAKDOWN":
        return await EngineeringService.deleteBreakdown(message.data);

      case "UPDATE_ENGINEERING_BREAKDOWN_STATUS":
        return await EngineeringService.updateBreakdownStatus(message.data);

      // ================================================================Vendor of Equipment Entries
      case "CREATE_ENGINEERING_VENDOR":
        return await EngineeringService.createVendor(message.data);

      case "UPDATE_ENGINEERING_VENDOR":
        return await EngineeringService.updateVendor(message.data);

      case "DELETE_ENGINEERING_VENDOR":
        return await EngineeringService.deleteVendor(message.data);

      default:
        return {
          success: false,
          statusCode: 400,
          message: "Invalid Engineering action.",
        };
    }
  } catch (error) {
    console.error("Engineering Handler Error:", error.message);

    const retryResponse = retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return {
      success: false,
      statusCode: 500,
      message: "Unable to process Engineering request.",
    };
  }
};

module.exports = EngineeringHandler;
