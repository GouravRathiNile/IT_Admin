const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const { createDailyEntry,getAllDailyEntries,deleteDailyEntry,createGuestDetail,updateGuestDetail,deleteGuestDetail,getGuestDetailById,getDateRangeReport,getFeedbackReport,getMetByReport } = require("../../controllers/GuestMeetController/GuestMeetController");

const router = express.Router();

// ============================================================ Daily Entry APIs
// A daily entry is unique in application logic by OrganizationID + EntryDate.
router.post("/DailyEntry/Create", authenticateToken, createDailyEntry);
router.get("/DailyEntry/EntryList", authenticateToken, getAllDailyEntries);
router.delete("/DailyEntry/Delete", authenticateToken, deleteDailyEntry);

// ============================================================ Guest Detail APIs
// Guest details belong to one active daily-entry master record.
router.post("/GuestEntry/Create", authenticateToken, createGuestDetail);
router.put("/GuestEntry/Update", authenticateToken, updateGuestDetail);
router.delete("/GuestEntry/Delete", authenticateToken, deleteGuestDetail);
router.get("/GuestEntry/GuestDetails/:id", authenticateToken, getGuestDetailById);

// ============================================================ Report APIs
// Reports use query-string organization/date filters and exclude deleted rows.
router.get("/GuestsDetailsReport", authenticateToken, getDateRangeReport);
router.get("/GuestsFeedbackReport", authenticateToken, getFeedbackReport);
router.get("/GuestMetByReport", authenticateToken, getMetByReport);

module.exports = router;
