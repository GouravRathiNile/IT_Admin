const express = require("express");

const authenticateToken = require("../../middleware/authMiddleware");

const {
    createNotification,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    testPushNotification
} = require("../../controllers/NotificationController/NotificationController");

const router = express.Router();

// ============================================================
// Create Notification

router.post(
    "/Create",
    authenticateToken,
    createNotification
);

// ============================================================
// Read Notifications

router.get(
    "/NotificationList",
    authenticateToken,
    getNotifications
);

router.get(
    "/UnreadCount",
    authenticateToken,
    getUnreadCount
);

// ============================================================
// Update Notification Read Status

router.patch(
    "/MarkAsRead/:id",
    authenticateToken,
    markAsRead
);

router.patch(
    "/MarkAllAsRead",
    authenticateToken,
    markAllAsRead
);

router.post(
    "/TestPush",
    authenticateToken,
    testPushNotification
);

module.exports = router;