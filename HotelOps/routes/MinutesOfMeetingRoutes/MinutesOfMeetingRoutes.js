const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const { getMOMById,saveMOM,deleteMOM,getAllMOM,updateMOMStatus,getMOMTitles,getMOMActions,getMOMSummaryReport,getMOMResponsiblePersonReport,getMOMActionDetailReport,getMOMListPdf } = require("../../controllers/MinutesOfMeetingController/MinutesOfMeetingController");
const router = express.Router();

// ============================================================ CRUD Operations
router.post("/Save",authenticateToken,saveMOM,);
router.get("/MOMById/:MeetingID",authenticateToken,getMOMById);
router.delete("/Delete",authenticateToken,deleteMOM,);
// ============================================================ MOM List
router.get("/MOMList",authenticateToken,getAllMOM,);
// ============================================================ Update MOM Status
router.put("/UpdateMOMStatus",authenticateToken,updateMOMStatus,);
// ============================================================ Title And Action 
router.get("/MOMTitles",authenticateToken,getMOMTitles,);
router.get("/MOMActions",authenticateToken,getMOMActions,);
// ============================================================ Reports
router.get("/MOMSummaryReport",authenticateToken,getMOMSummaryReport,);
router.get("/ResponsiblePersonReport",authenticateToken,getMOMResponsiblePersonReport,);
router.get("/ActionDetailsReport",authenticateToken,getMOMActionDetailReport,);
// ============================================================ Pdfs
router.get("/MOMListPdf",authenticateToken,getMOMListPdf,);


module.exports = router;
