const express = require("express");
// const { login } = require("../controllers/HotelOpsLoginController");
const HotelOpsLoginController = require("../controllers/HotelOpsLoginController");
const router = express.Router();

// ============================================================// Auth Middleware
const authenticateToken = require("../middleware/authMiddleware");

// ============================================================// LOGIN
router.post("/login", HotelOpsLoginController.login);

// ============================================================// CHANGE PASSWORD
router.put("/change-password", authenticateToken, HotelOpsLoginController.changePassword);

// ============================================================// LOGOUT
router.post("/logout", authenticateToken, HotelOpsLoginController.logout);


module.exports = router;

