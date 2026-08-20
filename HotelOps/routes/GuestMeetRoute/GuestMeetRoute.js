const express = require("express");
const authenticateToken = require("../../middleware/authMiddleware");
const controller = require("../../controllers/GuestMeetController/GuestMeetController");

const router = express.Router();

// ============================================================ Daily Entry APIs
// A daily entry is unique in application logic by OrganizationID + EntryDate.
router.post("/create", authenticateToken, controller.createDailyEntry);
router.get("/getall", authenticateToken, controller.getAllDailyEntries);
router.delete("/delete/:id", authenticateToken, controller.deleteDailyEntry);

// ============================================================ Guest Detail APIs
// Guest details belong to one active daily-entry master record.
router.post("/guest/create", authenticateToken, controller.createGuestDetail);
router.put("/guest/update/:id", authenticateToken, controller.updateGuestDetail);
router.delete("/guest/delete/:id", authenticateToken, controller.deleteGuestDetail);
router.get("/guest/getbyid/:id", authenticateToken, controller.getGuestDetailById);

// ============================================================ Report APIs
// Reports use query-string organization/date filters and exclude deleted rows.
router.get("/reports/daterange", authenticateToken, controller.getDateRangeReport);
router.get("/reports/feedback", authenticateToken, controller.getFeedbackReport);
router.get("/reports/summary", authenticateToken, controller.getSummaryReport);
router.get("/reports/met-by", authenticateToken, controller.getMetByReport);

module.exports = router;
