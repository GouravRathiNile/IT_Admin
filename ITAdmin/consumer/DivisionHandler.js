const DivisionService = require("../services/DivisionService");

const DivisionHandler = async (message) => {

  try {

    switch (message.action) {

      // ============================= Create
      case "CREATE_DIVISION":
        return await DivisionService.createDivision(
          message.data
        );

      // ============================= Update
      case "UPDATE_DIVISION":
        return await DivisionService.updateDivision(
          message.data
        );

      // ============================= Delete
      case "DELETE_DIVISION":
        return await DivisionService.deleteDivision(
          message.data
        );

      default:
        return {
          success: false,
          message: "Invalid Action",
        };
    }

  } catch (error) {

    console.log(error);

    return {
      success: false,
      message: error.message,
    };

  }

};

module.exports = DivisionHandler;