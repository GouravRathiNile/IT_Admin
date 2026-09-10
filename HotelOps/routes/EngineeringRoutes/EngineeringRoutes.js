const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");
const {
  createEquipment,
  getAllEquipment,
  getEquipmentById,
  updateEquipment,
  deleteEquipment,
  getEquipmentDescriptions,
  getEquipmentSerialNumbers,
  getEquipmentAreas,
  createBreakdown,
  getAllBreakdowns,
  getBreakdownById,
  updateBreakdown,
  deleteBreakdown,
  updateBreakdownStatus,
  createVendor,
  getAllVendors,
  getVendorById,
  updateVendor,
  deleteVendor,
} = require("../../controllers/EngineeringController/EngineeringController");
const router = express.Router();

// ============================================================Equipment Entry
router.post("/CreateEquipment",authenticateToken,upload.array("Documents", 10),createEquipment,);
router.get("/EquipmentList", authenticateToken, getAllEquipment);
router.get("/EquipmentById/:id", authenticateToken, getEquipmentById);
router.put( "/UpdateEquipment",authenticateToken,upload.array("Documents", 10),updateEquipment,);
router.delete("/DeleteEquipment", authenticateToken, deleteEquipment);
router.get("/EquipmentNames", authenticateToken, getEquipmentDescriptions);
router.get("/EquipmentSerialNo",authenticateToken,getEquipmentSerialNumbers,);
router.get("/EquipmentAreas",authenticateToken,getEquipmentAreas,);
// =============================================================Breakdown of Equipment
router.post("/CreateBreakdown",authenticateToken,createBreakdown,);
router.put("/UpdateBreakdown",authenticateToken,updateBreakdown,);
router.delete("/DeleteBreakdown",authenticateToken,deleteBreakdown,);
router.get("/BreakdownList",authenticateToken,getAllBreakdowns,);
router.get("/BreakdownById/:id",authenticateToken,getBreakdownById,);
router.put("/BreakdownStatus",authenticateToken,updateBreakdownStatus,);
// =============================================================Vendor of Equipment
router.post("/CreateVendor",authenticateToken,createVendor,);
router.put("/UpdateVendor",authenticateToken,updateVendor,);
router.delete("/DeleteVendor",authenticateToken,deleteVendor,);
router.get("/VendorsList",authenticateToken,getAllVendors,);
router.get("/VendorById/:id",authenticateToken,getVendorById,);
// ==================================================================
module.exports = router;
