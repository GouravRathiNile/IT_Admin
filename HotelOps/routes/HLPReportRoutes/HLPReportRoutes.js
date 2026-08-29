const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const controller = require("../../controllers/HLPReportController/HLPReportController");

const router = express.Router();
// Every HLP endpoint requires the application's existing Bearer authentication.
router.use(authenticateToken);
// Configurable HLP master-field maintenance endpoints.
router.get("/MasterList", controller.masterList);
// Entry-page list overlays the selected report's YOD/LYOD values.
router.get("/HLPList", controller.hlpList);
router.post("/CreateMasterField", controller.createMasterField);
router.put("/MasterField/Reorder", controller.reorderMasterFields);
router.put("/UpdateMasterField", controller.updateMasterField);
router.delete("/DeleteMasterField", controller.deleteMasterField);
// Daily report entry and update endpoints.
router.post("/Create", controller.create);
router.put("/Update", controller.update);
// Screen reports and their matching PDF representations.
router.get("/MonthlyReport", controller.monthlyReport);
router.get("/LastYearReport", controller.lastYearReport);
router.get("/MonthlyReport/PDF", controller.monthlyReportPdf);
router.get("/LastYearReport/PDF", controller.lastYearReportPdf);
// Keep the parameterized route last so named report routes are matched first.
router.get("/:id/PDF", controller.reportPdf);

module.exports = router;
