const express = require("express");
const HotelOpsLoginController = require("../../controllers/ITAdminController/HotelOpsLoginController");
const router = express.Router();

// ============================================================// Auth Middleware
const authenticateToken = require("../../middleware/authMiddleware");
const {verifyForgotPasswordToken, verifyPasswordResetToken,} = require("../../middleware/OtpVerifyMiddleware");

// ============================================================// LOGIN
router.post("/login", HotelOpsLoginController.login);

// ============================================================// FORGOT PASSWORD
router.post("/forgot-password", HotelOpsLoginController.forgotPassword);

// ============================================================// VARIFY OTP
router.post("/verify-forgot-password-otp", verifyForgotPasswordToken, HotelOpsLoginController.verifyForgotPasswordOTP);

// ============================================================// RESET PASSWORD
router.post("/reset-password", verifyPasswordResetToken, HotelOpsLoginController.resetPassword);

// ============================================================// CHANGE PASSWORD
router.put("/change-password", authenticateToken, HotelOpsLoginController.changePassword);

// ============================================================// LOGOUT
router.post("/logout", authenticateToken, HotelOpsLoginController.logout);


module.exports = router;

