const DepartmentService = require("../services/DepartmentService");

const DepartmentHandler = async (message) => {
  try {

    switch (message.action) {

      case "CREATE_DEPARTMENT":
        return await DepartmentService.createDepartment(message.data);

      case "UPDATE_DEPARTMENT":
        return await DepartmentService.updateDepartment(message.data);

      case "DELETE_DEPARTMENT":
        return await DepartmentService.deleteDepartment(message.data);

      default:
        return {
          success: false,
          message: "Invalid Action",
        };
    }

  } catch (error) {

    return {
      success: false,
      message: error.message,
    };

  }
};

module.exports = DepartmentHandler;