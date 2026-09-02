const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");
const {
  createCapex,
  getAllCapex,
  getCapexById,
  updateCapex,
  deleteCapex,
  approveCapex,
  getCapexSummaryReport,
  getCapexDepartmentReport,
  getCapexOrganizationReport,
  createCapexApprovalConfig,
  getCapexApprovalConfig,
  updateCapexApprovalConfig,
  deleteCapexApprovalConfig,
  generateCapexListPdf,
  getCapexDepartmentReportPdf,
  getCapexOrganizationReportPdf,
  generateCapexByIdPdf
} = require("../../controllers/CapexController/CapexController");

const router = express.Router();

// ============================================================ Create CAPEX
router.post("/Create",authenticateToken,upload.array("Documents", 10),createCapex,);
// ============================================================ Read CAPEX
router.get("/CapexList", authenticateToken, getAllCapex);
router.get("/CapexById/:id", authenticateToken, getCapexById);
// ============================================================ Update CAPEX
router.put( "/Update", authenticateToken, upload.array("Documents", 10),updateCapex,);
// ============================================================ Soft Delete CAPEX
router.delete("/Delete", authenticateToken, deleteCapex);
// ============================================================ Approval Action
router.put("/CapexApprovalSystem", authenticateToken, approveCapex);
// ============================================================ CAPEX Reports
router.get("/CapexSummaryReport", authenticateToken, getCapexSummaryReport);
router.get( "/CapexDepartmentReport",authenticateToken,getCapexDepartmentReport,);
router.get("/CapexOrganizationReport",authenticateToken,getCapexOrganizationReport,);
// ============================================================Get Approval Config
router.post("/CreateApprovalFlow", authenticateToken, createCapexApprovalConfig);
router.get("/GetApprovalFlow",authenticateToken, getCapexApprovalConfig);
router.delete("/DeleteApprovalFlow", authenticateToken, deleteCapexApprovalConfig);
// ============================================================Capex PDfs
router.get("/CapexListPdf", authenticateToken, generateCapexListPdf);
router.get("/CapexDepartmentReportPdf",authenticateToken,getCapexDepartmentReportPdf);
router.get("/CapexOrganizationReportPdf",authenticateToken,getCapexOrganizationReportPdf);
router.get("/CapexDetailsPdf/:id",authenticateToken,generateCapexByIdPdf,);
module.exports = router;
