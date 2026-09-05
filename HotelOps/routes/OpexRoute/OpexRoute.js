const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");
const {
  createOpex,
  getAllOpex,
  getOpexById,
  updateOpex,
  deleteOpex,
  approveOpex,
  getOpexSummaryReport,
  getOpexDepartmentReport,
  getOpexOrganizationReport,
  createOpexApprovalConfig,
  getOpexApprovalConfig,
  updateOpexApprovalConfig,
  deleteOpexApprovalConfig,
  generateOpexListPdf,
  getOpexDepartmentReportPdf,
  getOpexOrganizationReportPdf
} = require("../../controllers/OpexController/OpexController");

const router = express.Router();

// ============================================================ Create Opex
router.post("/Create",authenticateToken,upload.array("Documents", 10),createOpex,);
// ============================================================ Read Opex
router.get("/OpexList", authenticateToken, getAllOpex);
router.get("/OpexById/:id", authenticateToken, getOpexById);
// ============================================================ Update Opex
router.put( "/Update", authenticateToken, upload.array("Documents", 10),updateOpex,);
// ============================================================ Soft Delete Opex
router.delete("/Delete", authenticateToken, deleteOpex);
// ============================================================ Approval Action
router.put("/OpexApprovalSystem", authenticateToken, approveOpex);
// ============================================================ Opex Reports
router.get("/OpexSummaryReport", authenticateToken, getOpexSummaryReport);
router.get( "/OpexDepartmentReport",authenticateToken,getOpexDepartmentReport,);
router.get("/OpexOrganizationReport",authenticateToken,getOpexOrganizationReport,);
// ============================================================Get Approval Config
router.post("/CreateApprovalFlow", authenticateToken, createOpexApprovalConfig);
router.get("/GetApprovalFlow",authenticateToken, getOpexApprovalConfig);
router.delete("/DeleteApprovalFlow", authenticateToken, deleteOpexApprovalConfig);
// ============================================================Opex PDfs
router.get("/OpexListPdf", authenticateToken, generateOpexListPdf);
router.get("/OpexDepartmentReportPdf",authenticateToken,getOpexDepartmentReportPdf,);
router.get("/OpexOrganizationReportPdf",authenticateToken,getOpexOrganizationReportPdf,);



module.exports = router;
