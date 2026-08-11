const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authMiddleware");
const {createDivision,getAllDivisions,updateDivision,deleteDivision,getDivisionsDropdown} = require("../controllers/DivisionController");

// ========================== Create
router.post("/create", authenticateToken, createDivision);
// ========================== Get All
router.get("/DivisionList",authenticateToken, getAllDivisions);
// ========================== Get Dropdown
router.get("/DivisionNames", authenticateToken, getDivisionsDropdown);
// ========================== Update
router.put("/update", authenticateToken, updateDivision);
// ========================== Delete
router.delete("/delete", authenticateToken, deleteDivision);

module.exports = router;
