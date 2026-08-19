const express = require("express");
const { createDepartment,getAllDepartments,getDepartmentsDropdown,updateDepartment,deleteDepartment,getDepartmentWiseProducts } = require("../../controllers/ITAdminController/DepartmentController");

const authenticateToken = require("../../middleware/authMiddleware");
const router = express.Router();


// ================================= Create Department
router.post("/create", authenticateToken, createDepartment);
// ================================= Get All Department
router.get("/DepartmentList",authenticateToken, getAllDepartments);
// ================================= Department Dropdown
router.get("/DepartmentNames", authenticateToken,getDepartmentsDropdown);
// ================================= Update Department
router.put("/update", authenticateToken, updateDepartment);
// ================================= Delete Department
router.delete("/delete", authenticateToken, deleteDepartment);
// ============================================================
// GET DEPARTMENT WISE PRODUCTS
// ============================================================
router.get("/DepartmentWiseProducts", authenticateToken, getDepartmentWiseProducts);

module.exports = router;
