const NotificationService = require("../../services/NotificationService/NotificationService");

const {
    retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const NotificationHandler = async (message) => {
    try {
        switch (message.action) {

            // ======================================================
            // Create Notification

            case "CREATE_NOTIFICATION":
                return await NotificationService.createNotification(
                    message.data
                );

            // ======================================================
            // Mark Notification As Read

            case "MARK_NOTIFICATION_AS_READ":
                return await NotificationService.markAsRead(
                    message.data
                );

            // ======================================================
            // Mark All Notifications As Read

            case "MARK_ALL_NOTIFICATIONS_AS_READ":
                return await NotificationService.markAllAsRead(
                    message.data
                );
            
            // ======================================================
            // Test Push Notification

            case "TEST_PUSH_NOTIFICATION":
                return await NotificationService.testPushNotification(
                    message.data
                );
            // ======================================================
            // Reject Unknown Actions

            default:
                return {
                    success: false,
                    statusCode: 400,
                    message: "Invalid Notification action.",
                };
        }

    } catch (error) {

        console.error(
            "Notification Handler Error:",
            error.message
        );

        // Retry transient database errors
        const retryResponse = retryableDatabaseResponse(error);

        if (retryResponse) {
            return retryResponse;
        }

        return {
            success: false,
            statusCode: 500,
            message: "Unable to process Notification request.",
        };
    }
};

module.exports = NotificationHandler;