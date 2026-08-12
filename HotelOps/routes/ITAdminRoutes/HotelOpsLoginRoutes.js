const express = require("express");
const HotelOpsLoginController = require("../../controllers/ITAdminController/HotelOpsLoginController");
const router = express.Router();

// ============================================================// Auth Middleware
const authenticateToken = require("../../middleware/authMiddleware");

// ============================================================// LOGIN
router.post("/login", HotelOpsLoginController.login);

// ============================================================// CHANGE PASSWORD
router.put("/change-password", authenticateToken, HotelOpsLoginController.changePassword);

// ============================================================// LOGOUT
router.post("/logout", authenticateToken, HotelOpsLoginController.logout);


module.exports = router;

