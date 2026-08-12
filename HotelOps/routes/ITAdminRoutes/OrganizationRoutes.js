const express = require("express");
const router = express.Router();
const upload = require("../../middleware/upload");
const authenticateToken = require("../../middleware/authMiddleware");
const {createOrganization, getAllOrganizations, updateOrganization, deleteOrganization, getOrganizationsDropdown} = require("../../controllers/ITAdminController/OrganizationController");

// ====================Create Organization
router.post("/create", authenticateToken, upload.array("LogoName"), createOrganization);
// ==================== Get All Organizations
router.get("/OrganizationsList",authenticateToken,getAllOrganizations);
// ====================Update Organization
router.put("/update", authenticateToken, upload.array("LogoName"), updateOrganization);
// ====================Delete Organization
router.delete("/delete", authenticateToken, deleteOrganization);
// ==================== Get Organizations for Dropdown
router.get("/OrganizationNames",authenticateToken, getOrganizationsDropdown);
module.exports = router;
