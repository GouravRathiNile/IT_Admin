const { pool } = require("../../db");

const {
    retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");

const { sendPushNotification } = require("../../utils/sendPushNotification");

const guestGlitchIds = (values) => [...new Set((Array.isArray(values) ? values : [values])
    .filter((value) => value != null && /^[1-9]\d*$/.test(String(value).trim()))
    .map((value) => String(value).trim()))].sort();

const guestGlitchValue = (field, value) => {
    if (["DepartmentIDs", "InformedToIDs", "ResolvedBy"].includes(field)) {
        return JSON.stringify(guestGlitchIds(value));
    }
    if (field === "DepartmentHODComments") {
        return JSON.stringify((Array.isArray(value) ? value : [])
            .map((item) => [String(item.departmentName || "").trim().toLowerCase(),
                String(item.HODComment ?? item.comment ?? "").trim()])
            .filter((item) => item[1]).sort((a, b) => a[0].localeCompare(b[0])));
    }
    return String(value ?? "").trim();
};

// This uses the committed snapshot, including the original creator and current assignments.
const notifyGuestGlitch = async ({ actorUserId, previous, current }) => {
    try {
        const fields = ["Status", "GMComment", "DepartmentHODComments", "DepartmentIDs",
            "InformedToIDs", "ResolvedBy", "Complaint", "DetailedInvestigation",
            "ServiceRecovery", "InternalActionTaken"];
        const changed = previous ? fields.filter((field) =>
            guestGlitchValue(field, previous[field]) !== guestGlitchValue(field, current[field])) : [];
        if (previous && !changed.length) return;
        const status = changed.includes("Status");
        const gmComment = changed.includes("GMComment");
        const hodComment = changed.includes("DepartmentHODComments");
        const assignment = changed.some((field) => ["DepartmentIDs", "InformedToIDs", "ResolvedBy"].includes(field));
        const action = !previous ? "CREATED" : status ? "STATUS_CHANGED" : gmComment ? "GM_COMMENT_UPDATED"
            : hodComment ? "HOD_COMMENT_UPDATED" : assignment ? "ASSIGNMENT_CHANGED" : "UPDATED";
        const directIds = guestGlitchIds([
            ...(current.InformedToIDs || []),
            ...((status || gmComment) ? current.ReceivedByIDs || [] : []),
            ...((status || gmComment || hodComment) ? [current.CreatedBy] : []),
            ...((status || assignment) ? [current.ResolvedBy] : []),
        ]);
        const departmentIds = guestGlitchIds(current.DepartmentIDs);
        const includeGMs = !previous || status || gmComment || hodComment || assignment;
        const recipients = await pool.query(`
            SELECT DISTINCT um.userid
            FROM user_master um
            INNER JOIN user_org_mapping uom ON uom.userid = um.userid
            INNER JOIN organization_master om ON om.organizationid = uom.organizationid
            WHERE uom.organizationid = $1
              AND uom.isactive = TRUE AND uom.isdeleted = FALSE
              AND om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
              AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
              AND um.userid::text <> $2
              AND (um.userid::text = ANY($3::text[])
                OR (UPPER(TRIM(um.usertype)) = 'HOD' AND EXISTS (
                    SELECT 1 FROM department_master dm
                    WHERE dm.departmentid = um.departmentid AND dm.organizationid = $1
                      AND dm.isdeleted = FALSE AND dm.departmentid::text = ANY($4::text[])))
                OR ($5::boolean AND UPPER(TRIM(um.usertype)) = 'GM'))`,
            [current.OrganizationID, String(actorUserId), directIds, departmentIds, includeGMs]);
        const userIds = guestGlitchIds(recipients.rows.map((row) => row.userid))
            .filter((id) => id !== String(actorUserId));
        if (!userIds.length) return;
        const { sendMessage } = require("../../producer/producer");
        const QUEUE = require("../../config/queue");
        const response = await sendMessage(QUEUE.NOTIFICATION.REQUEST, QUEUE.NOTIFICATION.RESPONSE, {
            action: "CREATE_NOTIFICATION",
            data: {
                organizationId: current.OrganizationID,
                title: previous ? "Guest Glitch updated" : "Guest Glitch created",
                message: previous ? `Guest Glitch #${current.ID} updated: ${changed.join(", ")}.`
                    : `Guest Glitch #${current.ID} has been created.`,
                type: "info", moduleName: "GuestGlitch", entityType: "GuestGlitch",
                entityId: String(current.ID), action, priority: "normal", userIds,
            },
        });
        // A queued database retry is already owned by the existing consumer.
        if (!response || response.success !== true) {
            console.error("Guest Glitch notification request unsuccessful:", response?.message || "No response");
        }
    } catch (error) {
        console.error("Guest Glitch notification failed:", error.message);
    }
};

const pushGuestGlitchNotification = async (notification, userIds) => {
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
                    console.error("Guest Glitch push failed:", error.code || "delivery failed");
                }
            }));
        }
    } catch (error) {
        console.error("Guest Glitch device lookup failed:", error.code || "lookup failed");
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
                data.moduleName,
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

        if (notification.module_name === "GuestGlitch") {
            // Do not hold the transaction connection or delay the RabbitMQ reply for Firebase.
            Promise.resolve().then(() => pushGuestGlitchNotification(notification, userIds))
                .catch(() => console.error("Guest Glitch push dispatch failed"));
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
// ?moduleName=GuestGlitch
// ?isRead=false
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
                String(data.moduleName).trim()
            );

            parameterIndex++;
        }


        // ======================================================
        // Read / Unread Filter
        // ======================================================

        if (
            data.isRead !== undefined &&
            data.isRead !== null &&
            String(data.isRead).trim() !== ""
        ) {

            const normalizedIsRead =
                String(data.isRead)
                    .trim()
                    .toLowerCase();


            if (
                normalizedIsRead !== "true" &&
                normalizedIsRead !== "false"
            ) {

                return fail(
                    "isRead must be true or false.",
                    400
                );
            }


            conditions.push(
                `nr.is_read = $${parameterIndex}`
            );

            queryParams.push(
                normalizedIsRead === "true"
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
//             moduleName: "GuestGlitch",
//             unreadCount: 2
//         }
//     ]
// }
//
// Optional:
// ?moduleName=GuestGlitch
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
                String(moduleName).trim()
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

    notifyGuestGlitch,

    createNotification,

    getNotifications,

    getUnreadCount,

    markAsRead,

    markAllAsRead,

    testPushNotification

};
