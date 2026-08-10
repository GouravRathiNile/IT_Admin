const HotelOpsLoginService = require("../services/HotelOpsLoginService");

const HotelOpsLoginHandler = async (message) => {
  try {
    const {
      action,
      data,
    } = message;

    switch (action) {

      // ======================================================
      // LOGIN
      // ======================================================

      case "LOGIN":
        return await HotelOpsLoginService.login(data);

      // ======================================================
      // CHANGE PASSWORD
      // ======================================================

      case "CHANGE_PASSWORD":
        return await HotelOpsLoginService.changePassword(data);

      // ======================================================
      // DEFAULT
      // ======================================================

      default:
        return {
          success: false,
          message: `Unknown Login Action: ${action}`,
        };
    }

  } catch (error) {

    console.log(
      "Login Consumer Error:",
      error.message
    );

    return {
      success: false,
      message: error.message,
    };
  }
};

module.exports = HotelOpsLoginHandler;