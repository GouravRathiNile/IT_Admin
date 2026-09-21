const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const {
  createDailyBreakage,
  updateDailyBreakage,
  getDailyBreakageById,
  getDailyBreakageList,
  deleteDailyBreakage,
} = require("../../controllers/DailyBreakageController/DailyBreakageController");
const router = express.Router();

// ============================================================ Crud Operations
router.post("/Create",authenticateToken,createDailyBreakage,);
router.put("/Update",authenticateToken,updateDailyBreakage,);
router.get("/DailyBreakageById/:DailyBreakageID",authenticateToken,getDailyBreakageById,);
router.get("/DailyBreakageList", authenticateToken, getDailyBreakageList);
router.delete("/Delete", authenticateToken, deleteDailyBreakage);

module.exports = router;
