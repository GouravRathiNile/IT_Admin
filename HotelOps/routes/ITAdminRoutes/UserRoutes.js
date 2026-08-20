const express = require("express");
const router = express.Router();
const upload = require("../../middleware/upload");
const authenticateToken = require("../../middleware/authMiddleware");
const { createUser,getAllUsers,getUserById,getUserDropdown,updateUser,deleteUser,getUserOrganizations, getUserProducts,getUserPersonalDetails,getAllUsersTabel,updateUserPersonalDetails,updateUserOrganizations,updateUserProducts,getUserProductsList } = require("../../controllers/ITAdminController/UserController");

// ========================================= Create User
router.post("/Create", authenticateToken, upload.single("ProfilePhoto"), createUser);
// ========================================= Delete User
router.delete("/Delete", authenticateToken, deleteUser);
// ========================================= Get All Users
router.get("/GetUserList", authenticateToken, getAllUsers);
// ========================================= Get User By ID
router.get("/GetUserDetail/:id", authenticateToken, getUserById);
// ========================================= User Dropdown
router.get("/GetUserNames", authenticateToken, getUserDropdown);
// ===========================================User Organizations
router.get("/GetUserOrganizations",authenticateToken,getUserOrganizations);
// ===========================================User Products
router.get("/GetUserProducts",authenticateToken,getUserProducts);
// ===========================================User Products
router.get("/GetUserProductsList",authenticateToken,getUserProductsList);
// ===========================================User Personal Details
router.get("/GetUserPersonalDetails",authenticateToken, getUserPersonalDetails);
// ========================================= User Tabel
router.get("/GetAllUserInfo", authenticateToken, getAllUsersTabel);
// ========================================= Update User
router.put("/Update", authenticateToken, upload.single("ProfilePhoto"),updateUser);
// ============================================================UPDATE Personal Details
router.put("/UpdateUserDetails",authenticateToken,upload.single("ProfilePhoto"),updateUserPersonalDetails);
// ============================================================ UPDATE USER ORGANIZATIONS
router.put("/UpdateUserOrganizations",authenticateToken,updateUserOrganizations);
// ============================================================UPDATE USER PRODUCTS
router.put("/UpdateUserProducts",authenticateToken,updateUserProducts);
module.exports = router;
