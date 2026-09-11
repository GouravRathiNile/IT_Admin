const { messaging } = require("../config/firebase");

const sendPushNotification = async ({
    token,
    title,
    body,
    data = {}
}) => {

    if (!token) {
        throw new Error("Firebase device token is required");
    }

    const firebaseMessage = {
        token,

        notification: {
            title,
            body
        },

        data: Object.fromEntries(
            Object.entries(data).map(([key, value]) => [
                key,
                String(value)
            ])
        ),

        android: {
            priority: "high",
            notification: {
                sound: "default",
                channelId: "default"
            }
        }
    };

    const response = await messaging.send(firebaseMessage);

    console.log("✅ Firebase Push Sent:", response);

    return {
        success: true,
        messageId: response
    };
};

module.exports = {
    sendPushNotification
};