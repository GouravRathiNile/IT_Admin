const UserService = require("../../services/ITAdminService/UserService");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

const UserHandler = async (message) => {
  try {

    switch (message.action) {
      // =========================================CREATE USER
      case "CREATE_USER":
        return await UserService.createUser(
          message.data
        ); 
         // =========================================DELETE USER
      case "DELETE_USER":
        return await UserService.deleteUser(
          message.data
        );
      // =========================================UPDATE USER
      case "UPDATE_USER":
        return await UserService.updateUser(
          message.data
        );
      // =========================================UPDATE USER PERSONAL DETAILS
      case "UPDATE_USER_PERSONAL_DETAILS":
        return await UserService.updateUserPersonalDetails(
          message.data
        );
      // =====================================================UPDATE USER PRODUCTS
      case "UPDATE_USER_PRODUCTS":
        return await UserService.updateUserProducts(
          message.data.UserID,
          message.data.Products,
          message.data.ModifiedBy
        );
      // ===================================================== UPDATE USER ORGANIZATIONS
      case "UPDATE_USER_ORGANIZATIONS":
        return await UserService.updateUserOrganizations(
          message.data.UserID,
          message.data.Organizations,
          message.data.ModifiedBy
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

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      message: error.message,
    };

  }
};


module.exports = UserHandler;
