const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const controller = require("../../controllers/HLPReportController/HLPReportController");

const router = express.Router();
router.use(authenticateToken);
router.get("/MasterList", controller.masterList);
router.post("/CreateMasterField", controller.createMasterField);
router.put("/MasterField/Reorder", controller.reorderMasterFields);
router.put("/UpdateMasterField", controller.updateMasterField);
router.delete("/DeleteMasterField", controller.deleteMasterField);
router.post("/Create", controller.create);
router.put("/Update", controller.update);
router.get("/MonthlyReport", controller.monthlyReport);
router.get("/LastYearReport", controller.lastYearReport);
router.get("/MonthlyReport/PDF", controller.monthlyReportPdf);
router.get("/LastYearReport/PDF", controller.lastYearReportPdf);
router.get("/:id/PDF", controller.reportPdf);

module.exports = router;
