const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const controller = require("../../controllers/ReportController/ReportController");

const router = express.Router();
router.use(authenticateToken);

router.get("/:module/types", controller.types);
router.get("/:module/:reportType/config", controller.config);
router.get("/:module/:reportType/options/:field", controller.options);
router.post("/:module/:reportType/run", controller.run);
router.post("/:module/:reportType/export", controller.exportReport);

module.exports = router;
