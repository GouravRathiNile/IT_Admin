const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const { getMOMById,saveMOM,deleteMOM,getAllMOM,updateMOMStatus,getMOMTitles,getMOMActions,getMOMSummaryReport,getMOMResponsiblePersonReport,getMOMActionDetailReport,getMOMListPdf,getMOMResponsiblePersonReportPdf,getMOMActionDetailReportPdf,generateMOMDetailPdf,getMOMResponsiblePersonDetailReport,getMOMResponsiblePersonDetailReportPdf } = require("../../controllers/MinutesOfMeetingController/MinutesOfMeetingController");
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
router.get("/ResponsiblePersonDetailReport",authenticateToken,getMOMResponsiblePersonDetailReport,);
// ============================================================ Pdfs
router.get("/MOMListPdf",authenticateToken,getMOMListPdf,);
router.get("/ResponsiblePersonReportPdf",authenticateToken,getMOMResponsiblePersonReportPdf,);
router.get("/ActionDetailsReportPdf",authenticateToken,getMOMActionDetailReportPdf,);
router.get("/MOMDetailPdf/:MeetingID",authenticateToken,generateMOMDetailPdf,);
router.get("/ResponsiblePersonDetailReportPdf",authenticateToken,getMOMResponsiblePersonDetailReportPdf,);

module.exports = router;
