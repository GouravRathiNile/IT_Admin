const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const { createMOM } = require("../../controllers/MinutesOfMeetingController/MinutesOfMeetingController");
const router = express.Router();

// ============================================================ Create MOM
router.post("/createMOM",authenticateToken,createMOM);


module.exports = router;