const express = require("express");
const router = express.Router();

const DepartmentController = require("../controllers/DepartmentController");

// ================================= Create Department
router.post("/create", DepartmentController.createDepartment);
// ================================= Get All Department
router.get("/getall", DepartmentController.getAllDepartments);
// ================================= Department Dropdown
router.get("/dropdown", DepartmentController.getDepartmentsDropdown);
// ================================= Update Department
router.put("/update/:id", DepartmentController.updateDepartment);
// ================================= Delete Department
router.delete("/delete/:id", DepartmentController.deleteDepartment);

module.exports = router;