const express = require("express");
const { createProduct, getAllProducts, getProductDropdown, updateProduct, deleteProduct, getProductsByCategory } = require("../../controllers/ITAdminController/ProductController");
const authenticateToken = require("../../middleware/authMiddleware");
const router = express.Router();

// ===================================== Create Product
router.post("/create", authenticateToken, createProduct);
// ===================================== Get All Products
router.get("/ProductList",getAllProducts);
// ===================================== Product Dropdown
router.get("/ProductNames",getProductDropdown);
// ===================================== Update Product
router.put("/update", authenticateToken, updateProduct);
// ===================================== Delete Product
router.delete("/delete", authenticateToken, deleteProduct);
// ===================================== Get Products By Category
router.get("/CategoryWiseProducts", getProductsByCategory);

module.exports = router;
