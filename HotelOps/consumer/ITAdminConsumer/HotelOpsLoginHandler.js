const HotelOpsLoginService = require("../../services/ITAdminService/HotelOpsLoginService");

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

      case "FORGOT_PASSWORD":
        return await HotelOpsLoginService.forgotPassword(data);

      case "VERIFY_FORGOT_PASSWORD_OTP":
        return await HotelOpsLoginService.verifyForgotPasswordOTP(data);

      case "RESET_PASSWORD":
        return await HotelOpsLoginService.resetPassword(data);

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
