const express = require("express");
const router = express.Router();

const ProductCategoryController = require("../../controllers/ITAdminController/ProductCategoryController");
const authenticateToken = require("../../middleware/authMiddleware");

router.post("/create", authenticateToken, ProductCategoryController.createProductCategory);

router.get("/ProductCategoryList", authenticateToken, ProductCategoryController.getAllProductCategories);

router.get("/ProductCategoryNames", authenticateToken, ProductCategoryController.getProductCategoryDropdown);

router.put("/update", authenticateToken, ProductCategoryController.updateProductCategory);

router.delete("/delete", authenticateToken, ProductCategoryController.deleteProductCategory);

module.exports = router;
