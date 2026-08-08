const express = require("express");
const { login } = require("../controllers/HotelOpsLoginController");
const router = express.Router();

// ============================================================// LOGI
router.post("/login",login);


module.exports = router;

