const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const authenticateToken = require("../middleware/authMiddleware");
const { createBrand,getAllBrands,updateBrand,deleteBrand, getBrandsDropdown} = require("../controllers/BrandController");

// ====================Create Brand
router.post("/create", authenticateToken, upload.single("BrandLogo"), createBrand);
// ====================Get All Brands
router.get("/BrandList", authenticateToken, getAllBrands);
// ====================Update Brand
router.put("/update", authenticateToken, upload.single("BrandLogo"), updateBrand);
//===================== Delete Brand (Soft Delete)
router.delete("/delete", authenticateToken, deleteBrand);
//===================== Get Brand for Dropdown
router.get("/BrandNames", authenticateToken, getBrandsDropdown);

module.exports = router;
