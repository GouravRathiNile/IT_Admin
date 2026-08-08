const express = require("express");
const { createProduct, getAllProducts, getProductDropdown, updateProduct, deleteProduct } = require("../controllers/ProductController");
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

module.exports = router;