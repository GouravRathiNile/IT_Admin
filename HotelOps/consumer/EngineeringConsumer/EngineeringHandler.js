const EngineeringService = require("../../services/EngineeringService/EngineeringService");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const EngineeringHandler = async (message) => {
  try {
    switch (message.action) {
      // ===============================================================Equipment Entry
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
      // ================================================================Vendor of Equipment
      case "CREATE_ENGINEERING_VENDOR":
        return await EngineeringService.createVendor(message.data);

      case "UPDATE_ENGINEERING_VENDOR":
        return await EngineeringService.updateVendor(message.data);

      case "DELETE_ENGINEERING_VENDOR":
        return await EngineeringService.deleteVendor(message.data);
      // ================================================================Maintenance of Equipment
      // ===================================================Maintenance Checklist
      case "CREATE_ENGINEERING_MAINTENANCE_CHECKLIST":
        return await EngineeringService.createMaintenanceChecklist(
          message.data,
        );

      case "UPDATE_ENGINEERING_MAINTENANCE_CHECKLIST":
        return await EngineeringService.updateMaintenanceChecklist(
          message.data,
        );

      case "DELETE_ENGINEERING_MAINTENANCE_CHECKLIST":
        return await EngineeringService.deleteMaintenanceChecklist(
          message.data,
        );
      // ===================================================Maintenance Details
      case "SAVE_ENGINEERING_MAINTENANCE":
        return await EngineeringService.saveMaintenance(message.data);

      case "DELETE_ENGINEERING_MAINTENANCE":
        return await EngineeringService.deleteMaintenance(message.data);
      // ===================================================Maintenance Details
      case "CREATE_ENGINEERING_AMC":
        return await EngineeringService.createAMC(message.data);

      case "UPDATE_ENGINEERING_AMC":
        return await EngineeringService.updateAMC(message.data);

      case "DELETE_ENGINEERING_AMC":
        return await EngineeringService.deleteAMC(message.data);

      case "PROCESS_ENGINEERING_AMC_APPROVAL":
        return await EngineeringService.processAMCApproval(message.data);

      case "CREATE_ENGINEERING_AMC_APPROVAL_CONFIG":
        return await EngineeringService.createAMCApprovalConfig(message.data);

      case "DELETE_ENGINEERING_AMC_APPROVAL_CONFIG":
        return await EngineeringService.deleteAMCApprovalConfig(message.data);

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
