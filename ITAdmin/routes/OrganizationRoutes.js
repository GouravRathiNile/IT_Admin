const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const {createOrganization} = require("../controllers/OrganizationController");

router.post("/create",upload.array("LogoName"),createOrganization);

module.exports = router;