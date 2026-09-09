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
// ================================================================Breakdown of Equipment

module.exports = router;
