const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const {createOrganization, getAllOrganizations, updateOrganization, deleteOrganization, getOrganizationsDropdown} = require("../controllers/OrganizationController");

// ====================Create Organization
router.post("/create",upload.array("LogoName"),createOrganization);
// ==================== Get All Organizations
router.get("/getdata",getAllOrganizations);
// ====================Update Organization
router.put("/update/:id",upload.array("LogoName"),updateOrganization);
// ====================Delete Organization
router.delete("/delete/:id", deleteOrganization);
// ==================== Get Organizations for Dropdown
router.get("/getDropdownData", getOrganizationsDropdown);
module.exports = router;