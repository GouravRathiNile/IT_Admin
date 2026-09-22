const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const {
  createDailyBreakage,
  updateDailyBreakage,
  getDailyBreakageById,
  getDailyBreakageList,
  deleteDailyBreakage,
  getDailyBreakageOutlets,
  getDailyBreakageSummaryReport,
  getDailyBreakageOutletWiseReport,
  getDailyBreakagePersonResponsibleReport,
  getDailyBreakagePersonResponsible,
} = require("../../controllers/DailyBreakageController/DailyBreakageController");
const router = express.Router();

// ============================================================ Crud Operations
router.post("/Create",authenticateToken,createDailyBreakage,);
router.put("/Update",authenticateToken,updateDailyBreakage,);
router.get("/DailyBreakageById/:DailyBreakageID",authenticateToken,getDailyBreakageById,);
router.get("/DailyBreakageList", authenticateToken, getDailyBreakageList);
router.delete("/Delete", authenticateToken, deleteDailyBreakage);
// ============================================================ Dropdowns
router.get("/Outlets",authenticateToken,getDailyBreakageOutlets,);
router.get("/PersonResponsible",authenticateToken,getDailyBreakagePersonResponsible,);
// ============================================================ Reports
router.get("/SummaryReport",authenticateToken,getDailyBreakageSummaryReport,);
router.get("/OutletWiseReport",authenticateToken,getDailyBreakageOutletWiseReport,);
router.get("/PersonResponsibleReport",authenticateToken,getDailyBreakagePersonResponsibleReport,);

module.exports = router;
