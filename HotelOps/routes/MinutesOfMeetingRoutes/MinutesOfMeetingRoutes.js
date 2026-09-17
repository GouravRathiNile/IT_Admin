const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const { createMOM,getMOMById,updateMOM } = require("../../controllers/MinutesOfMeetingController/MinutesOfMeetingController");
const router = express.Router();

// ============================================================ CRUD Operations
router.post("/createMOM",authenticateToken,createMOM);
router.get("/GetMOMById/:MeetingID",authenticateToken,getMOMById);
router.put("/updateMOM",authenticateToken,updateMOM,);
module.exports = router;
