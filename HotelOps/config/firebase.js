const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

const serviceAccount = require("./hotelops-8df99-firebase-adminsdk-opn7v-cc6148a975.json");

// ============================================================
// Firebase Admin Initialization
// ============================================================

let firebaseApp;

if (getApps().length === 0) {
    firebaseApp = initializeApp({
        credential: cert(serviceAccount)
    });

    console.log("✅ Firebase Admin Initialized");
} else {
    firebaseApp = getApps()[0];

    console.log("✅ Existing Firebase Admin App Used");
}

const messaging = getMessaging(firebaseApp);

module.exports = {
    firebaseApp,
    messaging
};