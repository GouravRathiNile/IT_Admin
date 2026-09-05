const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const controller = require("../../controllers/IncidentReportController/IncidentReportController");

const router = express.Router();
router.use(authenticateToken);

router.post("/Create", controller.create);
router.get("/List", controller.list);
router.get("/Report", controller.report);
router.get("/Report/export/csv", controller.exportCSV);
router.get("/Report/export/excel", controller.exportExcel);
router.get("/Report/pdf", controller.reportListPdf);
router.get("/Report/:id", controller.reportPdf);
router.put("/Update", controller.update);
router.delete("/Delete", controller.remove);
router.get("/:id", controller.get);

module.exports = router;
