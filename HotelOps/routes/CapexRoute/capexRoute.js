const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const capexUpload = require("../../middleware/capexUpload");
const CapexController = require("../../controllers/CapexController/CapexController");

const router = express.Router();

router.post(
  "/create",
  authenticateToken,
  capexUpload,
  CapexController.createCapex
);

router.get("/getall", authenticateToken, CapexController.getAllCapex);
router.get("/getbyid/:id", authenticateToken, CapexController.getCapexById);
router.put(
  "/update/:id",
  authenticateToken,
  capexUpload,
  CapexController.updateCapex
);
router.delete("/delete/:id", authenticateToken, CapexController.deleteCapex);
router.put("/approve/:id", authenticateToken, CapexController.approveCapex);
router.get("/reports/summary", authenticateToken, CapexController.getCapexSummaryReport);
router.get("/reports/status", authenticateToken, CapexController.getCapexStatusReport);
router.get("/reports/department", authenticateToken, CapexController.getCapexDepartmentReport);
router.get("/reports/organization", authenticateToken, CapexController.getCapexOrganizationReport);

module.exports = router;
