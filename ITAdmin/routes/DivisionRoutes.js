const express = require("express");
const router = express.Router();
const {createDivision,getAllDivisions,updateDivision,deleteDivision,getDivisionsDropdown} = require("../controllers/DivisionController");

// ========================== Create
router.post("/create", createDivision);
// ========================== Get All
router.get("/getdata", getAllDivisions);
// ========================== Get Dropdown
router.get("/dropdown", getDivisionsDropdown);
// ========================== Update
router.put("/update/:id", updateDivision);
// ========================== Delete
router.delete("/delete/:id", deleteDivision);

module.exports = router;