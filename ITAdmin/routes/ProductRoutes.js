const express = require("express");
const { createProduct, getAllProducts, getProductDropdown, updateProduct, deleteProduct, getProductsByCategory } = require("../controllers/ProductController");
const router = express.Router();

// ===================================== Create Product
router.post("/create",createProduct);
// ===================================== Get All Products
router.get("/getdata",getAllProducts);
// ===================================== Product Dropdown
router.get("/getdropdowndata",getProductDropdown);
// ===================================== Update Product
router.put("/update/:id",updateProduct);
// ===================================== Delete Product
router.delete("/delete/:id",deleteProduct);
// ===================================== Get Products By Category
router.get("/getbycategory/{*id}", getProductsByCategory);

module.exports = router;