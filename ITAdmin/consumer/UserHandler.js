const UserService = require("../services/UserService");

const UserHandler = async (message) => {
  try {

    switch (message.action) {
      // =========================================CREATE USER
      case "CREATE_USER":
        return await UserService.createUser(
          message.data
        ); 
      // =========================================UPDATE USER
      case "UPDATE_USER":
        return await UserService.updateUser(
          message.data
        );
      // =========================================DELETE USER
      case "DELETE_USER":
        return await UserService.deleteUser(
          message.data
        );
     
      // =========================================
      // INVALID ACTION
      // =========================================

      default:

        return {
          success: false,
          message: "Invalid Action",
        };

    }

  } catch (error) {

    console.log(
      "User Handler Error :",
      error.message
    );

    return {
      success: false,
      message: error.message,
    };

  }
};


module.exports = UserHandler;