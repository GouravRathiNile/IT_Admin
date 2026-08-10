const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const authenticateToken = require("../middleware/authMiddleware");
const { createUser,getAllUsers,getUserById,getUserDropdown,updateUser,deleteUser,getUserOrganizations } = require("../controllers/UserController");

// ========================================= Create User
router.post("/create",upload.single("ProfilePhoto"),createUser);
// ========================================= Delete User
router.delete("/delete/:id",deleteUser);
// ========================================= Update User
router.put("/update/:id",upload.single("ProfilePhoto"),updateUser);
// ========================================= Get All Users
router.get("/getdata",getAllUsers);
// ========================================= Get User By ID
router.get("/getsingleuser/:id",getUserById);
// ========================================= User Dropdown
router.get("/getdropdowndata",getUserDropdown);
// ===========================================User Organizations
router.get("/getuserorganizations",authenticateToken,getUserOrganizations);



module.exports = router;