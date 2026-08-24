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
router.get("/monthly-report/pdf", controller.monthlyReportPdf);
router.get("/last-year-report/pdf", controller.lastYearReportPdf);
router.get("/:id/pdf", controller.reportPdf);

module.exports = router;
