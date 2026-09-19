const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");
const {
  createCreditApplication,
  getCreditApplicationList,
  getCreditApplicationById,
  updateCreditApplication,
  deleteCreditApplication,
  processCreditApplicationApproval,
  updateCreditApplicationARID,
  createCreditApplicationApprovalConfig,
  getCreditApplicationApprovalConfigList,
  deleteCreditApplicationApprovalConfig,
  getCompanyWiseReport,
  getOrganizationWiseReport,
} = require("../../controllers/CreditApplicationController/CreditApplicationController");
const router = express.Router();

// ============================================================ CRUD Operations
router.post("/Create",authenticateToken,upload.array("Documents", 10),createCreditApplication,);
router.get("/CreditApplicationList",authenticateToken, getCreditApplicationList,);
router.get("/CreditApplicationById/:id",authenticateToken,getCreditApplicationById,);
router.put("/Update",authenticateToken,upload.array("Documents", 10),updateCreditApplication,);
router.delete("/Delete",authenticateToken,deleteCreditApplication,);
// ============================================================ Approve
router.put("/ApproveApplication",authenticateToken,processCreditApplicationApproval,);
// ============================================================ Update AR Id
router.put("/UpdateARId",authenticateToken,updateCreditApplicationARID,);
// ============================================================ Approval Config CRUD Operations
router.post("/CreateApprovalConfig",authenticateToken, createCreditApplicationApprovalConfig,);
router.get("/ApprovalConfigList",authenticateToken,getCreditApplicationApprovalConfigList,);
router.delete("/DeleteApprovalConfig",authenticateToken,deleteCreditApplicationApprovalConfig,);
// ============================================================ Reports
router.get("/CompanyWiseReport",authenticateToken,getCompanyWiseReport,);
router.get("/OrganizationWiseReport",authenticateToken,getOrganizationWiseReport,);


module.exports = router;