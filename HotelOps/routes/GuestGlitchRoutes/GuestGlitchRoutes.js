const express = require("express");
const controller = require("../../controllers/GuestGlitchController/GuestGlitchController");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");

const router = express.Router();
router.use(authenticateToken);

router.post("/create", upload.guestGlitchUpload, controller.create);
router.get("/list", controller.list);
router.get("/get/:id", controller.get);
router.put("/update", upload.guestGlitchUpload, controller.update);
router.delete("/delete", controller.remove);
router.patch("/status-update", controller.updateStatus);
router.get("/options/list", controller.listOptions);
router.post("/options/upsert", controller.upsertOption);
router.get("/report", controller.report);
router.get("/report/export/csv", controller.exportCSV);
router.get("/report/export/excel", controller.exportExcel);
router.get("/report/:id/pdf", controller.masterReportPdf);
router.get("/report/:id", controller.reportDetail);
router.get("/master-report", controller.masterReport);
router.get("/master-report/:id/pdf", controller.masterReportPdf);
router.get("/gm/:id", controller.gmView);
router.patch("/gm-action", controller.gmAction);
router.get("/attachment/:id", controller.attachment);
router.get("/:id", controller.get);

module.exports = router;
