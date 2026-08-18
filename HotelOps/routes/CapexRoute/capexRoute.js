const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");
const { createCapex,getAllCapex,getCapexById,updateCapex,deleteCapex,approveCapex,getCapexSummaryReport,getCapexStatusReport,getCapexDepartmentReport,getCapexOrganizationReport } = require("../../controllers/CapexController/CapexController");

const router = express.Router();

// ============================================================ Create CAPEX
router.post("/Create",authenticateToken,upload.array("Documents", 10),createCapex);
// ============================================================ Read CAPEX
router.get("/CapexList", authenticateToken, getAllCapex);
router.get("/CapexById/:id", authenticateToken, getCapexById);
// ============================================================ Update CAPEX
router.put("/Update",authenticateToken,upload.array("Documents", 10),updateCapex);
// ============================================================ Soft Delete CAPEX
router.delete("/Delete", authenticateToken, deleteCapex);
// ============================================================ Approval Action
router.put("/CapexApprovalSystem", authenticateToken, approveCapex);
// ============================================================ CAPEX Reports
router.get("/reports/summary",authenticateToken,getCapexSummaryReport,);
router.get("/reports/status",authenticateToken,getCapexStatusReport,);
router.get("/reports/department",authenticateToken,getCapexDepartmentReport,);
router.get("/reports/organization",authenticateToken,getCapexOrganizationReport,);

module.exports = router;
