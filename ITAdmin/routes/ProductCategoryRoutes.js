const express = require("express");
const router = express.Router();

const ProductCategoryController = require("../controllers/ProductCategoryController");

router.post("/create", ProductCategoryController.createProductCategory);

router.get("/getall", ProductCategoryController.getAllProductCategories);

router.get("/dropdown", ProductCategoryController.getProductCategoryDropdown);

router.put("/update/:id", ProductCategoryController.updateProductCategory);

router.delete("/delete/:id", ProductCategoryController.deleteProductCategory);

module.exports = router;