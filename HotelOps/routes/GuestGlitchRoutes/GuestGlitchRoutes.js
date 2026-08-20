const express = require("express");
const controller = require("../../controllers/GuestGlitchController/GuestGlitchController");
const authenticateToken = require("../../middleware/authMiddleware");
const organizationContext = require("../../middleware/organizationContextMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const upload = require("../../middleware/upload");
const { PERMISSIONS } = require("../../config/guestGlitchConstants");

const router = express.Router();
router.use(authenticateToken, organizationContext);

router.post("/create", requirePermission(PERMISSIONS.CREATE), upload.guestGlitchUpload, controller.create);
router.get("/list", requirePermission(PERMISSIONS.VIEW), controller.list);
router.get("/get/:id", requirePermission(PERMISSIONS.VIEW), controller.get);
router.put("/update", requirePermission(PERMISSIONS.UPDATE), upload.guestGlitchUpload, controller.update);
router.delete("/delete", requirePermission(PERMISSIONS.DELETE), controller.remove);
router.patch("/status-update", requirePermission(PERMISSIONS.STATUS_UPDATE), controller.updateStatus);
router.get("/options/list", requirePermission(PERMISSIONS.VIEW), controller.listOptions);
router.post("/options/upsert", requirePermission(PERMISSIONS.OPTION_MANAGE), controller.upsertOption);
router.get("/report", requirePermission(PERMISSIONS.REPORT), controller.report);
router.get("/report/:id", requirePermission(PERMISSIONS.REPORT), controller.reportDetail);
router.get("/master-report", requirePermission(PERMISSIONS.MASTER_REPORT), controller.masterReport);
router.get("/master-report/:id/pdf", requirePermission(PERMISSIONS.MASTER_REPORT), controller.masterReportPdf);
router.get("/gm/:id", requirePermission(PERMISSIONS.GM_ACTION), controller.gmView);
router.patch("/gm-action", requirePermission(PERMISSIONS.GM_ACTION), controller.gmAction);
router.get("/attachment/:id", requirePermission(PERMISSIONS.ATTACHMENT_VIEW), controller.attachment);

module.exports = router;
