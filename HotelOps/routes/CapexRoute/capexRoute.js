const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");
const { createCapex,getAllCapex,getCapexById,updateCapex,deleteCapex,approveCapex,getCapexSummaryReport,getCapexStatusReport,getCapexDepartmentReport,getCapexOrganizationReport } = require("../../controllers/CapexController/CapexController");

const router = express.Router();

// ============================================================ Create CAPEX
router.post("/Create",authenticateToken,upload.array("Documents", 10),createCapex);
// ============================================================ Read CAPEX
router.get("/getall", authenticateToken, getAllCapex);
router.get("/getbyid/:id", authenticateToken, getCapexById);
// ============================================================ Update CAPEX
router.put("/update/:id",authenticateToken,upload.array("Documents", 10),updateCapex);
// ============================================================ Soft Delete CAPEX
router.delete("/delete/:id", authenticateToken, deleteCapex);
// ============================================================ Approval Action
router.put("/approve/:id", authenticateToken, approveCapex);
// ============================================================ CAPEX Reports
router.get("/reports/summary",authenticateToken,getCapexSummaryReport,);
router.get("/reports/status",authenticateToken,getCapexStatusReport,);
router.get("/reports/department",authenticateToken,getCapexDepartmentReport,);
router.get("/reports/organization",authenticateToken,getCapexOrganizationReport,);

module.exports = router;
