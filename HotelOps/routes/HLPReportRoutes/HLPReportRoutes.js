const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const controller = require("../../controllers/HLPReportController/HLPReportController");

const router = express.Router();
router.use(authenticateToken);
router.get("/master-list", controller.masterList);
router.post("/master-list", controller.createMasterField);
router.put("/master-list", controller.updateMasterField);
router.delete("/master-list", controller.deleteMasterField);
router.post("/create", controller.create);
router.put("/update", controller.update);
router.get("/monthly-report", controller.monthlyReport);
router.get("/last-year-report", controller.lastYearReport);

module.exports = router;
