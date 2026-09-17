const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const { getMOMById,saveMOM,deleteMOM,getAllMOM,updateMOMStatus } = require("../../controllers/MinutesOfMeetingController/MinutesOfMeetingController");
const router = express.Router();

// ============================================================ CRUD Operations
router.post("/Save",authenticateToken,saveMOM,);
router.get("/MOMById/:MeetingID",authenticateToken,getMOMById);
router.delete("/Delete",authenticateToken,deleteMOM,);
// ============================================================ MOM List
router.get("/MOMList",authenticateToken,getAllMOM,);
router.put("/UpdateMOMStatus",authenticateToken,updateMOMStatus,);
module.exports = router;
