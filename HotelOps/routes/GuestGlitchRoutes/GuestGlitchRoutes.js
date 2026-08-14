const express = require("express");
const controller = require("../../controllers/GuestGlitchController/GuestGlitchController");
const authenticateToken = require("../../middleware/authMiddleware");
const organizationContext = require("../../middleware/organizationContextMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const guestGlitchUpload = require("../../middleware/guestGlitchUpload");
const { PERMISSIONS } = require("../../config/guestGlitchConstants");

const router = express.Router();
router.use(authenticateToken, organizationContext);

router.post("/create", requirePermission(PERMISSIONS.CREATE), guestGlitchUpload, controller.create);
router.post("/list", requirePermission(PERMISSIONS.VIEW), controller.list);
router.post("/get", requirePermission(PERMISSIONS.VIEW), controller.get);
router.post("/update", requirePermission(PERMISSIONS.UPDATE), guestGlitchUpload, controller.update);
router.post("/delete", requirePermission(PERMISSIONS.DELETE), controller.remove);
router.post("/status-update", requirePermission(PERMISSIONS.STATUS_UPDATE), controller.updateStatus);
router.post("/options/list", requirePermission(PERMISSIONS.VIEW), controller.listOptions);
router.post("/options/upsert", requirePermission(PERMISSIONS.OPTION_MANAGE), controller.upsertOption);

module.exports = router;
