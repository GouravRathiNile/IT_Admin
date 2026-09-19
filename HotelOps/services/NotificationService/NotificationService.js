const { pool } = require("../../db");

const {
    retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const { sendPushNotification } = require("../../utils/sendPushNotification");
const { sendNotificationEmail } = require("../CapexService/CapexEmailTemplate");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");

// Canonical notification module names are defined in one place. Add a new
// normalized key here when another module needs casing/spacing normalization.
const NOTIFICATION_MODULE_NAMES = Object.freeze({
    capex: "Capex",
    guestglitch: "Guest Glitch",
    incidentreport: "Incident Report",
    opex: "Opex",
    engineering: "Engineering",
    minutesofmeeting: "Minutes of Meeting",
});

// Modules using the shared Firebase dispatcher. Recipient selection remains in
// each module service; this set only enables generic post-persistence delivery.
const PUSH_NOTIFICATION_MODULES = new Set(["Capex", "Guest Glitch", "Incident Report", "Opex", "Engineering", "Minutes of Meeting"]);

// Email rollout is intentionally limited to CAPEX. Other modules keep their
// existing notification delivery until they are explicitly enabled here.
const EMAIL_NOTIFICATION_MODULES = new Set(["Capex"]);

const ENGINEERING_WARRANTY_ENTITY = "EquipmentWarrantySummary";
const ENGINEERING_WARRANTY_ACTIONS = Object.freeze([
    "WARRANTY_DAILY_SUMMARY", // Legacy aggregate action used by older deployments.
    "WARRANTY_EXPIRING_TOMORROW",
    "WARRANTY_EXPIRING_TODAY",
    "WARRANTY_EXPIRED",
]);

const warrantyDuplicateActions = (action) => action === "WARRANTY_DAILY_SUMMARY"
    ? ENGINEERING_WARRANTY_ACTIONS
    : ["WARRANTY_DAILY_SUMMARY", action];

const ENGINEERING_SCHEDULED_EVENTS = Object.freeze({
    EquipmentMaintenanceSummary: new Set(["MAINTENANCE_DUE"]),
    EquipmentAMCSummary: new Set(["AMC_EXPIRING_TODAY"]),
});

const normalizeNotificationModuleName = (moduleName) => {
    if (moduleName === undefined || moduleName === null) return moduleName;
    const trimmed = String(moduleName).trim();
    const normalizedKey = trimmed.toLowerCase().replace(/\s+/g, "");
    return NOTIFICATION_MODULE_NAMES[normalizedKey] || trimmed;
};

// Generic Firebase delivery used after a notification has been committed.
const pushNotificationToRecipients = async (notification, userIds) => {
    try {
        const devices = await pool.query(`
            SELECT DISTINCT TRIM(ud.devicetoken) AS token
            FROM user_device ud
            INNER JOIN user_master um ON um.userid = ud.userid
            INNER JOIN user_org_mapping uom ON uom.userid = um.userid
            WHERE ud.userid::text = ANY($1::text[]) AND uom.organizationid = $2
              AND ud.isactive = TRUE AND ud.isdeleted = FALSE
              AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
              AND uom.isactive = TRUE AND uom.isdeleted = FALSE
              AND NULLIF(TRIM(ud.devicetoken), '') IS NOT NULL`,
            [userIds, notification.organization_id]);
        for (let offset = 0; offset < devices.rows.length; offset += 20) {
            await Promise.all(devices.rows.slice(offset, offset + 20).map(async ({ token }) => {
                try {
                    await sendPushNotification({ token, title: notification.title, body: notification.message,
                        data: { notificationId: notification.id, organizationId: notification.organization_id,
                            moduleName: notification.module_name, entityId: notification.entity_id,
                            action: notification.action } });
                } catch (error) {
                    console.error("Notification push failed:", error.code || "delivery failed");
                }
            }));
        }
    } catch (error) {
        console.error("Notification device lookup failed:", error.code || "lookup failed");
    }
};

// Resolve email addresses from the already-finalized notification recipients.
// The case-insensitive map prevents one mailbox receiving duplicate messages.
const emailNotificationToRecipients = async (notification, userIds) => {
    try {
        const [recipients, organizationResult] = await Promise.all([
          pool.query(`
            SELECT um.userid, TRIM(um.email) AS email
            FROM user_master um
            WHERE um.userid::text = ANY($1::text[])
              AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
              AND NULLIF(TRIM(um.email), '') IS NOT NULL`,
            [userIds]),
          pool.query(`
            SELECT om.organizationname, om.shortname, logo.logoname
            FROM organization_master om
            LEFT JOIN LATERAL (
              SELECT oml.logoname
              FROM organization_master_logo oml
              WHERE oml.organizationid = om.organizationid AND oml.isdeleted = FALSE
              ORDER BY oml.logoid
              LIMIT 1
            ) logo ON TRUE
            WHERE om.organizationid = $1 AND om.isactive = TRUE
              AND om.activationstatus = TRUE AND om.isdeleted = FALSE
            LIMIT 1`, [notification.organization_id]),
        ]);
        const uniqueEmails = new Map();
        for (const row of recipients.rows) {
            const email = String(row.email || "").trim();
            if (email) uniqueEmails.set(email.toLowerCase(), email);
        }

        const organization = organizationResult.rows[0] || {};
        let logoUrl = process.env.NILE_OFFICIAL_LOGO_URL || null;
        if (organization.logoname) {
            try {
                logoUrl = generateOrganizationLogoUrl(organization.logoname);
            } catch (error) {
                console.error("Notification organization logo URL failed:", error.message);
            }
        }
        const emailNotification = {
            ...notification,
            organization_name: organization.organizationname || organization.shortname || "HotelOps",
            organization_short_name: organization.shortname || organization.organizationname || "HotelOps",
            logo_url: logoUrl,
        };

        await Promise.all([...uniqueEmails.values()].map(async (email) => {
            try {
                await sendNotificationEmail(email, emailNotification);
            } catch (error) {
                // A failed mailbox must not block delivery to other recipients.
                console.error("Notification email delivery failed:", error.message);
            }
        }));
    } catch (error) {
        console.error("Notification email recipient lookup failed:", error.message);
    }
};

// ============================================================
// Common Failure Response
// ============================================================

const fail = (message, statusCode = 500, errors = undefined) => {

    const response = {
        success: false,
        statusCode,
        message,
    };

    if (errors !== undefined) {
        response.errors = errors;
    }

    return response;
};


// ============================================================
// CREATE NOTIFICATION
// ============================================================

const createNotification = async (data) => {

    let client;
    let transactionStarted = false;

    try {

        // Normalize before persistence so equivalent names never create
        // separate notification modules/tabs because of casing or spaces.
        const moduleName = normalizeNotificationModuleName(data.moduleName);

        client = await pool.connect();

        await client.query("BEGIN");
        transactionStarted = true;


        // ======================================================
        // Validate User IDs
        // ======================================================

        if (!Array.isArray(data.userIds) || data.userIds.length === 0) {

            await client.query("ROLLBACK");
            transactionStarted = false;

            return fail(
                "At least one recipient user is required.",
                400
            );
        }


        // ======================================================
        // Normalize User IDs
        // Remove duplicate users
        // ======================================================

        const userIds = [
            ...new Set(
                data.userIds
                    .map((userId) => String(userId).trim())
                    .filter(Boolean)
            ),
        ];


        if (userIds.length === 0) {

            await client.query("ROLLBACK");
            transactionStarted = false;

            return fail(
                "At least one valid recipient user is required.",
                400
            );
        }

        // Warranty summaries are scheduled and may arrive from more than one
        // app worker. Serialize their persistence and reuse an existing row so
        // the same organization/event/business-date is never inserted twice.
        if (moduleName === "Engineering" &&
            data.entityType === ENGINEERING_WARRANTY_ENTITY &&
            ENGINEERING_WARRANTY_ACTIONS.includes(data.action) &&
            data.entityId !== undefined && data.entityId !== null) {
            const entityId = String(data.entityId);
            const lockKey = `${moduleName}:${data.organizationId}:${data.entityType}:${entityId}`;
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [lockKey]);

            // Old workers/queued messages used one combined daily action.
            // Ignore that obsolete command; current jobs publish one event row
            // each for TOMORROW, TODAY and EXPIRED.
            if (data.action === "WARRANTY_DAILY_SUMMARY") {
                await client.query("COMMIT");
                transactionStarted = false;
                return {
                    success: true,
                    statusCode: 200,
                    message: "Legacy warranty notification ignored.",
                };
            }

            const duplicateResult = await client.query(`
                SELECT id
                FROM notifications
                WHERE organization_id = $1
                  AND module_name = $2
                  AND entity_type = $3
                  AND entity_id = $4
                  AND action = ANY($5::text[])
                ORDER BY id ASC
                LIMIT 1;`, [data.organizationId, moduleName, data.entityType, entityId,
                warrantyDuplicateActions(data.action)]);
            if (duplicateResult.rows.length) {
                await client.query("COMMIT");
                transactionStarted = false;
                return {
                    success: true,
                    statusCode: 200,
                    message: "Notification already exists.",
                    data: { id: Number(duplicateResult.rows[0].id) },
                };
            }
        }

        // Scheduled Engineering summaries may be published concurrently by
        // multiple app instances. Serialize the final insert so one event per
        // organization/business-date is persisted even under that race.
        const scheduledActions = ENGINEERING_SCHEDULED_EVENTS[data.entityType];
        if (moduleName === "Engineering" && scheduledActions?.has(data.action) &&
            data.entityId !== undefined && data.entityId !== null) {
            const entityId = String(data.entityId);
            const lockKey = `${moduleName}:${data.organizationId}:${data.entityType}:${data.action}:${entityId}`;
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [lockKey]);
            const duplicateResult = await client.query(`
                SELECT id FROM notifications
                WHERE organization_id = $1 AND module_name = $2
                  AND entity_type = $3 AND entity_id = $4 AND action = $5
                ORDER BY id ASC LIMIT 1;`,
            [data.organizationId, moduleName, data.entityType, entityId, data.action]);
            if (duplicateResult.rows.length) {
                await client.query("COMMIT");
                transactionStarted = false;
                return { success: true, statusCode: 200,
                    message: "Notification already exists.",
                    data: { id: Number(duplicateResult.rows[0].id) } };
            }
        }


        // ======================================================
        // Insert Notification
        // ======================================================

        const notificationResult = await client.query(
            `
            INSERT INTO notifications
            (
                organization_id,
                title,
                message,
                type,
                module_name,
                action,
                entity_type,
                entity_id,
                user_type,
                department,
                designation,
                priority,
                created_at
            )
            VALUES
            (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                CURRENT_TIMESTAMP
            )
            RETURNING
                id,
                organization_id,
                title,
                message,
                type,
                module_name,
                action,
                entity_type,
                entity_id,
                user_type,
                department,
                designation,
                priority,
                created_at;
            `,
            [
                data.organizationId,
                data.title,
                data.message,
                data.type || "info",
                moduleName,
                data.action || null,
                data.entityType || null,
                data.entityId !== undefined &&
                data.entityId !== null
                    ? String(data.entityId)
                    : null,
                data.userType || null,
                data.department || null,
                data.designation || null,
                data.priority || "normal",
            ]
        );


        const notification = notificationResult.rows[0];
        // Email metadata is intentionally transient and never changes the
        // persisted notification/API response contract.
        notification.email_data = data.emailData || null;


        // ======================================================
        // Insert Recipients
        // ======================================================

        const recipientValues = [];
        const recipientParams = [];

        userIds.forEach((userId, index) => {

            const notificationParam = index * 2 + 1;
            const userParam = index * 2 + 2;

            recipientValues.push(
                `($${notificationParam}, $${userParam}, FALSE, NULL, CURRENT_TIMESTAMP)`
            );

            recipientParams.push(
                notification.id,
                userId
            );
        });


        await client.query(
            `
            INSERT INTO notification_recipients
            (
                notification_id,
                user_id,
                is_read,
                read_at,
                created_at
            )
            VALUES
            ${recipientValues.join(", ")}
            ON CONFLICT (notification_id, user_id)
            DO NOTHING;
            `,
            recipientParams
        );


        // ======================================================
        // COMMIT
        // ======================================================

        await client.query("COMMIT");
        transactionStarted = false;

        if (PUSH_NOTIFICATION_MODULES.has(notification.module_name)) {
            // Do not hold the transaction connection or delay the RabbitMQ reply for Firebase.
            Promise.resolve().then(() => pushNotificationToRecipients(notification, userIds))
                .catch(() => console.error("Notification push dispatch failed"));
        }

        if (EMAIL_NOTIFICATION_MODULES.has(notification.module_name)) {
            // Email starts only after persistence commits and runs independently
            // from Firebase so neither delivery channel can block the other.
            Promise.resolve().then(() => emailNotificationToRecipients(notification, userIds))
                .catch((error) => console.error("Notification email dispatch failed:", error.message));
        }


        // ======================================================
        // Response
        // ======================================================

        return {
            success: true,
            statusCode: 201,
            message: "Notification created successfully.",
            data: {
                id: Number(notification.id),
                organizationId: Number(notification.organization_id),
                title: notification.title,
                message: notification.message,
                type: notification.type,
                moduleName: notification.module_name,
                action: notification.action,
                entityType: notification.entity_type,
                entityId: notification.entity_id,
                userType: notification.user_type,
                department: notification.department,
                designation: notification.designation,
                priority: notification.priority,
                recipientCount: userIds.length,
                createdAt: notification.created_at,
            },
        };

    } catch (error) {

        if (client && transactionStarted) {
            await client.query("ROLLBACK");
            transactionStarted = false;
        }


        console.error(
            "Create Notification Error:",
            error.message
        );


        const retryResponse = retryableDatabaseResponse(error);

        if (retryResponse) {
            return retryResponse;
        }


        if (error.code === "23514") {
            return fail(
                "Invalid notification type or priority.",
                400
            );
        }


        if (error.code === "22P02") {
            return fail(
                "Invalid notification data.",
                400
            );
        }


        return fail(
            "Unable to create notification at this time.",
            500
        );

    } finally {

        if (client) {
            client.release();
        }

    }
};


// ============================================================
// GET NOTIFICATIONS
// Direct PostgreSQL Read
//
// Supports:
// ?moduleName=Guest%20Glitch
// ?page=1
// ?limit=20
// ============================================================

const getNotifications = async (data) => {

    try {

        const userId = data.userId;

        const page = Number(data.page) || 1;

        const limit = Number(data.limit) || 20;

        const offset = (page - 1) * limit;


        // ======================================================
        // Validate Pagination
        // ======================================================

        if (!Number.isInteger(page) || page < 1) {

            return fail(
                "Page must be a positive integer.",
                400
            );
        }


        if (!Number.isInteger(limit) || limit < 1) {

            return fail(
                "Limit must be a positive integer.",
                400
            );
        }


        // Prevent unnecessarily large queries
        const PageSize = Math.min(limit, 100);


        // ======================================================
        // Build Filters
        // ======================================================

        const conditions = [
            "nr.user_id = $1",
            "nr.is_read = FALSE",
        ];

        const queryParams = [userId];

        let parameterIndex = 2;


        // ======================================================
        // Module Name Filter
        // ======================================================

        if (
            data.moduleName !== undefined &&
            data.moduleName !== null &&
            String(data.moduleName).trim() !== ""
        ) {

            conditions.push(
                `n.module_name = $${parameterIndex}`
            );

            queryParams.push(
                normalizeNotificationModuleName(data.moduleName)
            );

            parameterIndex++;
        }


        const whereClause =
            conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";


        // ======================================================
        // Total Count
        // ======================================================

        const countResult = await pool.query(
            `
            SELECT COUNT(*) AS total_count
            FROM notifications n
            INNER JOIN notification_recipients nr
                ON nr.notification_id = n.id
            ${whereClause};
            `,
            queryParams
        );


        const totalCount =
            Number(countResult.rows[0].total_count);


        // ======================================================
        // Notification List
        // ======================================================

        const result = await pool.query(
            `
            SELECT
                n.id,
                n.organization_id,
                n.title,
                n.message,
                n.type,
                n.module_name,
                n.action,
                n.entity_type,
                n.entity_id,
                n.user_type,
                n.department,
                n.designation,
                n.priority,
                nr.is_read,
                nr.read_at,
                n.created_at

            FROM notifications n

            INNER JOIN notification_recipients nr
                ON nr.notification_id = n.id

            ${whereClause}

            ORDER BY n.created_at DESC, n.id DESC

            LIMIT $${parameterIndex}
            OFFSET $${parameterIndex + 1};
            `,
            [
                ...queryParams,
                PageSize,
                offset,
            ]
        );


        // ======================================================
        // Map Response
        // ======================================================

        const notifications = result.rows.map((row) => ({

            id: Number(row.id),

            organizationId: Number(row.organization_id),

            title: row.title,

            message: row.message,

            type: row.type,

            moduleName: row.module_name,

            action: row.action,

            entityType: row.entity_type,

            entityId: row.entity_id,

            userType: row.user_type,

            department: row.department,

            designation: row.designation,

            priority: row.priority,

            isRead: row.is_read,

            readAt: row.read_at,

            createdAt: row.created_at,

        }));


        // ======================================================
        // Pagination
        // ======================================================

        const totalPages =
            Math.ceil(totalCount / PageSize);


        return {

            success: true,

            message: "Notifications fetched successfully.",

            data: notifications,

            pagination: {

                totalCount,

                page,

                pageSize: PageSize,

                pageCount: notifications.length,

                totalPages,

            },

        };

    } catch (error) {

        console.error(
            "Get Notifications Error:",
            error.message
        );


        const retryResponse = retryableDatabaseResponse(error);

        if (retryResponse) {
            return retryResponse;
        }


        return fail(
            "Unable to fetch notifications at this time.",
            503
        );

    }
};


// ============================================================
// GET UNREAD COUNT
// Direct PostgreSQL Read
//
// Response:
// {
//     totalCount: 4,
//     unreadCount: [
//         {
//             moduleName: "CAPEX",
//             unreadCount: 2
//         },
//         {
//             moduleName: "Guest Glitch",
//             unreadCount: 2
//         }
//     ]
// }
//
// Optional:
// ?moduleName=Guest%20Glitch
// ============================================================

const getUnreadCount = async (userId, moduleName = null) => {

    try {

        // ======================================================
        // Build Module Filter
        // ======================================================

        const conditions = [
            "nr.user_id = $1",
            "nr.is_read = FALSE",
        ];

        const queryParams = [userId];

        let parameterIndex = 2;


        // ======================================================
        // Optional Module Filter
        // ======================================================

        if (
            moduleName !== undefined &&
            moduleName !== null &&
            String(moduleName).trim() !== ""
        ) {

            conditions.push(
                `n.module_name = $${parameterIndex}`
            );

            queryParams.push(
                normalizeNotificationModuleName(moduleName)
            );

            parameterIndex++;
        }


        const whereClause =
            `WHERE ${conditions.join(" AND ")}`;


        // ======================================================
        // Total Unread Count
        // ======================================================

        const totalResult = await pool.query(
            `
            SELECT COUNT(*) AS total_count

            FROM notification_recipients nr

            INNER JOIN notifications n
                ON n.id = nr.notification_id

            ${whereClause};
            `,
            queryParams
        );


        const totalCount =
            Number(totalResult.rows[0].total_count);


        // ======================================================
        // Module Wise Unread Count
        // ======================================================

        const moduleResult = await pool.query(
            `
            SELECT
                n.module_name AS "moduleName",
                COUNT(*) AS unread_count

            FROM notification_recipients nr

            INNER JOIN notifications n
                ON n.id = nr.notification_id

            ${whereClause}

            GROUP BY n.module_name

            ORDER BY unread_count DESC, n.module_name ASC;
            `,
            queryParams
        );


        const unreadCount = moduleResult.rows.map((row) => ({
            moduleName: row.moduleName,
            unreadCount: Number(row.unread_count),
        }));


        // ======================================================
        // Response
        // ======================================================

        return {

            success: true,

            message: "Unread notification count fetched successfully.",

            data: {

                totalCount,

                unreadCount,

            },

        };

    } catch (error) {

        console.error(
            "Get Unread Count Error:",
            error.message
        );


        const retryResponse =
            retryableDatabaseResponse(error);

        if (retryResponse) {
            return retryResponse;
        }


        return fail(
            "Unable to fetch unread notification count.",
            503
        );

    }
};


// ============================================================
// MARK NOTIFICATION AS READ
// RabbitMQ Mutation
// ============================================================

const markAsRead = async ({ notificationId, userId }) => {

    try {

        const result = await pool.query(
            `
            UPDATE notification_recipients

            SET
                is_read = TRUE,
                read_at = CURRENT_TIMESTAMP

            WHERE notification_id = $1
              AND user_id = $2
              AND is_read = FALSE

            RETURNING
                notification_id AS "notificationId",
                user_id AS "userId";
            `,
            [
                notificationId,
                userId
            ]
        );


        if (result.rows.length === 0) {

            return {
                success: false,
                statusCode: 404,
                message: "Notification not found or already marked as read.",
            };

        }


        // ======================================================
        // Do NOT return isRead / readAt
        // ======================================================

        return {

            success: true,

            message: "Notification marked as read.",

        };

    } catch (error) {

        console.error(
            "Mark Notification As Read Error:",
            error.message
        );


        const retryResponse =
            retryableDatabaseResponse(error);

        if (retryResponse) {
            return retryResponse;
        }


        return fail(
            "Unable to mark notification as read.",
            500
        );

    }
};


// ============================================================
// MARK ALL NOTIFICATIONS AS READ
// RabbitMQ Mutation
// ============================================================

const markAllAsRead = async (data) => {

    try {

        const result = await pool.query(
            `
            UPDATE notification_recipients

            SET
                is_read = TRUE,
                read_at = COALESCE(
                    read_at,
                    CURRENT_TIMESTAMP
                )

            WHERE user_id = $1
              AND is_read = FALSE

            RETURNING id;
            `,
            [
                data.userId
            ]
        );


        return {

            success: true,

            message: "All notifications marked as read.",

            data: {

                updatedCount: result.rowCount,

            },

        };

    } catch (error) {

        console.error(
            "Mark All Notifications As Read Error:",
            error.message
        );


        const retryResponse =
            retryableDatabaseResponse(error);

        if (retryResponse) {
            return retryResponse;
        }


        return fail(
            "Unable to mark notifications as read.",
            500
        );

    }
};


// ============================================================
// Test Push Notification
// ============================================================

const testPushNotification = async ({
    deviceToken,
    title,
    message,
    moduleName
}) => {

    if (!deviceToken) {
        return {
            success: false,
            statusCode: 400,
            message: "Device token is required."
        };
    }

    const result = await sendPushNotification(
        deviceToken,
        title || "HotelOps Test Notification",
        message || "Notification service is working successfully.",
        moduleName || "Notification"
    );

    return {
        success: true,
        message: "Test push notification sent successfully.",
        data: result
    };
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    createNotification,

    getNotifications,

    getUnreadCount,

    markAsRead,

    markAllAsRead,

    testPushNotification

};
