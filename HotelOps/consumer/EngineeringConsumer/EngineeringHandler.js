const EngineeringService = require("../../services/EngineeringService/EngineeringService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const EngineeringHandler = async (message) => {
  try {
    switch (message.action) {
     
      // ====================================================Equipment
      case "CREATE_ENGINEERING_EQUIPMENT":
        return await EngineeringService.createEquipment(message.data);

      case "GET_ENGINEERING_EQUIPMENT_LIST":
        return await EngineeringService.getAllEquipment(message.data);

      case "GET_ENGINEERING_EQUIPMENT_BY_ID":
        return await EngineeringService.getEquipmentById(message.data);

      case "UPDATE_ENGINEERING_EQUIPMENT":
        return await EngineeringService.updateEquipment(message.data);

      case "DELETE_ENGINEERING_EQUIPMENT":
        return await EngineeringService.deleteEquipment(message.data);

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
