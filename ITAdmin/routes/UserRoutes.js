const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const authenticateToken = require("../middleware/authMiddleware");
const { createUser,getAllUsers,getUserById,getUserDropdown,updateUser,deleteUser,getUserOrganizations, getUserProducts,getUserPersonalDetails,getAllUsersTabel,updateUserPersonalDetails,updateUserOrganizations,updateUserProducts } = require("../controllers/UserController");

// ========================================= Create User
router.post("/create",upload.single("ProfilePhoto"),createUser);
// ========================================= Delete User
router.delete("/delete/:id",deleteUser);
// ========================================= Get All Users
router.get("/getdata",getAllUsers);
// ========================================= Get User By ID
router.get("/getsingleuser/:id",getUserById);
// ========================================= User Dropdown
router.get("/getdropdowndata",getUserDropdown);
// ===========================================User Organizations
router.get("/getuserorganizations",authenticateToken,getUserOrganizations);
// ===========================================User Products
router.get("/getuserproducts",authenticateToken,getUserProducts);
// ===========================================User Personal Details
router.get("/getuserpersonaldetails",authenticateToken,getUserPersonalDetails);
// ========================================= User Tabel
router.get("/getusersdatatable",getAllUsersTabel);
// ========================================= Update User
router.put("/update/:id",upload.single("ProfilePhoto"),updateUser);
// ============================================================UPDATE Personal Details
router.put("/updateuserdetails",authenticateToken,upload.single("ProfilePhoto"),updateUserPersonalDetails);
// ============================================================ UPDATE USER ORGANIZATIONS
router.put("/updateuserorganizations",authenticateToken,updateUserOrganizations);
// ============================================================UPDATE USER PRODUCTS
router.put("/updateuserproducts",authenticateToken,updateUserProducts);
module.exports = router;