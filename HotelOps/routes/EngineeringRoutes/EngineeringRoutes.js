const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const upload = require("../../middleware/upload");
const {
  createEquipment,
  getAllEquipment,
  getEquipmentById,
  updateEquipment,
  deleteEquipment,
} = require("../../controllers/EngineeringController/EngineeringController");
const router = express.Router();

// ============================================================Equipment Entry
router.post("/CreateEquipment",authenticateToken,upload.array("Documents", 10),createEquipment,);
router.get("/EquipmentList", authenticateToken, getAllEquipment);
router.get("/EquipmentById/:id", authenticateToken, getEquipmentById);
router.put( "/UpdateEquipment/:id",authenticateToken,upload.array("Documents", 10),updateEquipment,);
router.delete("/DeleteEquipment/:id", authenticateToken, deleteEquipment);

module.exports = router;
