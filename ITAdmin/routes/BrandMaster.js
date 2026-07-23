const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const { createBrand,getAllBrands,updateBrand,deleteBrand, getBrandsDropdown} = require("../controllers/BrandController");

// ====================Create Brand
router.post("/create", upload.single("BrandLogo"), createBrand);
// ====================Get All Brands
router.get("/getdata", getAllBrands);
// ====================Update Brand
router.put("/update/:id",upload.single("BrandLogo"), updateBrand);
//===================== Delete Brand (Soft Delete)
router.delete("/delete/:id", deleteBrand);
//===================== Get Brand for Dropdown
router.get("/GetBrandsDropdownData", getBrandsDropdown);

module.exports = router;