const { sendMessage } = require("../../producer/producer");

const NotificationService = require("../../services/NotificationService/NotificationService");
const { sendPushNotification } = require("../../utils/sendPushNotification");
// ============================================================
// Create Notification
// POST /api/Notifications/Create
// ============================================================

const createNotification = async (req, res) => {
    try {

        const {
            organizationId,
            title,
            message,
            type,
            moduleName,
            action,
            entityType,
            entityId,
            userType,
            department,
            designation,
            priority,
            userIds
        } = req.body;

        if (!organizationId) {
            return res.status(400).json({
                success: false,
                message: "OrganizationID is required"
            });
        }

        if (!title) {
            return res.status(400).json({
                success: false,
                message: "Title is required"
            });
        }

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Message is required"
            });
        }

        if (!moduleName) {
            return res.status(400).json({
                success: false,
                message: "ModuleName is required"
            });
        }

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "UserIds must be a non-empty array"
            });
        }

        const notificationData = {
            action: "CREATE_NOTIFICATION",

            data: {
                organizationId,
                title,
                message,
                type: type || "info",
                moduleName,
                action,
                entityType,
                entityId,
                userType,
                department,
                designation,
                priority: priority || "normal",
                userIds
            }
        };

        /*
         * Existing RabbitMQ Producer
         *
         * The actual requestQueue and responseQueue names
         * should match the queues configured for your
         * Notification Consumer.
         */

        const response = await sendMessage(
            "notification_request",
            "notification_response",
            notificationData
        );

        return res.status(200).json({
            success: true,
            message: "Notification created successfully",
            // data: response
        });

    } catch (error) {

        console.error(
            "❌ Create Notification Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Failed to create notification",
            error: error.message
        });
    }
};


// ============================================================
// Get Notifications
// GET /api/Notifications/NotificationList
// ============================================================

const getNotifications = async (req, res) => {
    try {

        const userId = req.user?.UserID;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User information not found"
            });
        }

        const {
            page = 1,
            limit = 20,
            moduleName,
            isRead
        } = req.query;

        const result = await NotificationService.getNotifications({
            userId: Number(userId),
            page: Number(page),
            limit: Number(limit),
            moduleName,
            isRead
        });

        return res.status(200).json({
            success: true,
            message: "Notifications fetched successfully",
            data: result.data,
            pagination: result.pagination
        });

    } catch (error) {

        console.error(
            "❌ Get Notifications Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Failed to fetch notifications",
            error: error.message
        });
    }
};


// ============================================================
// Get Unread Count
// GET /api/Notifications/UnreadCount
// ============================================================

const getUnreadCount = async (req, res) => {
    try {

        const userId =
            req.user?.userId ||
            req.user?.UserID ||
            req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User information not found"
            });
        }

        // const result = await NotificationService.getUnreadCount(userId);
        const { moduleName } = req.query;

        const result =
            await NotificationService.getUnreadCount(
                userId,
                moduleName
            );

        return res.status(200).json(result);

    } catch (error) {

        console.error(
            "❌ Get Unread Count Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Failed to fetch unread notification count",
            error: error.message
        });
    }
};


// ============================================================
// Mark Notification As Read
// PATCH /api/Notifications/MarkAsRead/:id
// ============================================================

const markAsRead = async (req, res) => {
    try {

        const userId =
            req.user?.userId ||
            req.user?.UserID ||
            req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User information not found"
            });
        }

        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Notification ID is required"
            });
        }

        const notificationData = {
            action: "MARK_NOTIFICATION_AS_READ",

            data: {
                notificationId: id,
                userId
            }
        };

        const response = await sendMessage(
            "notification_request",
            "notification_response",
            notificationData
        );

        return res.status(200).json(response);

    } catch (error) {

        console.error(
            "❌ Mark Notification As Read Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Failed to mark notification as read",
            error: error.message
        });
    }
};


// ============================================================
// Mark All Notifications As Read
// PATCH /api/Notifications/MarkAllAsRead
// ============================================================

const markAllAsRead = async (req, res) => {
    try {

        const userId =
            req.user?.userId ||
            req.user?.UserID ||
            req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User information not found"
            });
        }

        const notificationData = {
            action: "MARK_ALL_NOTIFICATIONS_AS_READ",

            data: {
                userId
            }
        };

        const response = await sendMessage(
            "notification_request",
            "notification_response",
            notificationData
        );

        // Return RabbitMQ/Service response directly
        return res.status(200).json(response);

    } catch (error) {

        console.error(
            "❌ Mark All Notifications As Read Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Failed to mark notifications as read",
            error: error.message
        });
    }
};

// ============================================================
// Test Push Notification
// POST /api/Notification/TestPush
// ============================================================

const testPushNotification = async (req, res) => {
    try {

        const { deviceToken } = req.body || {};

        if (!deviceToken) {
            return res.status(400).json({
                success: false,
                message: "Device token is required"
            });
        }

        const result = await sendPushNotification({
            token: deviceToken,
            title: "HotelOps Test Notification",
            body: "Firebase push notification is working successfully.",
            data: {
                type: "TEST",
                moduleName: "Notification"
            }
        });

        return res.status(200).json({
            success: true,
            message: "Test push notification sent successfully",
            data: result
        });

    } catch (error) {

        console.error(
            "❌ Test Push Notification Error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Failed to send test push notification",
            error: error.message
        });
    }
};

// ============================================================
// Exports
// ============================================================

module.exports = {
    createNotification,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    testPushNotification
};