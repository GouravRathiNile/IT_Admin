const { pool } = require("../../db");
const MaintenanceEmailService = require("./EngineeringMaintenanceEmailService");

const TIME_ZONE = "Asia/Kolkata";
const LOCK_KEY = "engineering-equipment-maintenance-job";
const MODULE_NAME = "Engineering";
const ACTION = "MAINTENANCE_DUE";

const kolkataDateTime = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour), minute: Number(parts.minute) };
};

const normalizeSchedule = (value) => String(value || "").trim().toLowerCase()
  .replace(/[\s_-]+/g, "");
const scheduleMonths = Object.freeze({ monthly: null,
  bimonth: [1, 3, 5, 7, 9, 11], bimonthly: [1, 3, 5, 7, 9, 11],
  quarter: [1, 4, 7, 10], quarterly: [1, 4, 7, 10],
  sixmonth: [1, 7], sixmonthly: [1, 7], "6month": [1, 7], "6monthly": [1, 7],
  yearly: [1], annual: [1], annually: [1] });

// Schedule matching mirrors the maintenance list rules, while requiring the
// configured day to exactly match the India business date.
const isMaintenanceDue = (row, businessDate) => {
  const schedule = normalizeSchedule(row.scheduleofservicing);
  if (!Object.prototype.hasOwnProperty.call(scheduleMonths, schedule)) return false;
  const match = String(row.scheduleday || "").match(/\d+/);
  const scheduleDay = match ? Number(match[0]) : null;
  const month = Number(businessDate.slice(5, 7));
  const day = Number(businessDate.slice(8, 10));
  const months = scheduleMonths[schedule];
  return Number.isInteger(scheduleDay) && scheduleDay === day &&
    (months === null || months.includes(month));
};

const resolveDueMaintenance = async ({ businessDate, queryable = pool }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || "")))
    throw new Error("A valid maintenance business date is required.");
  const result = await queryable.query(`
    SELECT e.EquipmentID, e.OrganizationID, e.Description AS EquipmentName,
           e.SerialNumber, e.Make, e.ModelNumber, e.Area,
           e.ScheduleOfServicing, e.ScheduleDay,
           COALESCE(NULLIF(TRIM(om.OrganizationName), ''), om.ShortName, 'HotelOps') AS OrganizationName,
           logo.LogoName
    FROM Engineering_Equipment_Entry_Master e
    INNER JOIN Organization_Master om ON om.OrganizationID = e.OrganizationID
      AND om.IsActive = TRUE AND om.ActivationStatus = TRUE AND om.IsDeleted = FALSE
    LEFT JOIN LATERAL (
      SELECT oml.LogoName FROM organization_master_logo oml
      WHERE oml.OrganizationID = om.OrganizationID AND oml.IsDeleted = FALSE
      ORDER BY oml.LogoID LIMIT 1
    ) logo ON TRUE
    WHERE e.IsDeleted = FALSE
      AND NULLIF(TRIM(e.ScheduleOfServicing), '') IS NOT NULL
      AND NULLIF(TRIM(e.ScheduleDay), '') IS NOT NULL
    ORDER BY e.OrganizationID, e.EquipmentID;`);
  return result.rows.filter((row) => isMaintenanceDue(row, businessDate));
};

const resolveMaintenanceRecipients = async ({ organizationIDs, queryable = pool }) => {
  const result = await queryable.query(`
    SELECT DISTINCT um.UserID, uom.OrganizationID, LOWER(TRIM(um.Email)) AS Email
    FROM user_master um
    INNER JOIN user_org_mapping uom ON uom.UserID = um.UserID
    INNER JOIN department_master dm ON dm.DepartmentID = um.DepartmentID
      AND dm.OrganizationID = uom.OrganizationID
    WHERE uom.OrganizationID = ANY($1::bigint[])
      AND UPPER(TRIM(um.UserType)) = 'HOD'
      AND UPPER(TRIM(dm.DepartmentName)) = 'ENGINEERING'
      AND um.IsActive = TRUE AND um.IsDeleted = FALSE AND um.IsLocked = FALSE
      AND uom.IsActive = TRUE AND uom.IsDeleted = FALSE AND dm.IsDeleted = FALSE;`, [organizationIDs]);
  return result.rows;
};

const processMaintenanceNotifications = async ({ businessDate, dueItems,
  recipientRows, queryable = pool, publishNotification } = {}) => {
  const rows = dueItems || await resolveDueMaintenance({ businessDate, queryable });
  if (!rows.length) return { candidates: 0, organizations: 0, sent: 0, skipped: 0, failed: 0 };
  const organizationIDs = [...new Set(rows.map((row) => Number(row.organizationid)))];
  const recipients = recipientRows || await resolveMaintenanceRecipients({ organizationIDs, queryable });
  const existing = await queryable.query(`
    SELECT Organization_ID FROM notifications
    WHERE Module_Name = $1 AND Entity_Type = 'EquipmentMaintenanceSummary'
      AND Action = $2 AND Entity_ID = $3
      AND Organization_ID = ANY($4::bigint[])
      AND (Created_At AT TIME ZONE 'Asia/Kolkata')::date = $3::date;`,
  [MODULE_NAME, ACTION, businessDate, organizationIDs]);
  const existingOrganizations = new Set(existing.rows.map((row) => Number(row.organization_id)));
  const send = publishNotification || (async (data) => {
    const { sendMessage } = require("../../producer/producer");
    const QUEUE = require("../../config/queue");
    return sendMessage(QUEUE.NOTIFICATION.REQUEST, QUEUE.NOTIFICATION.RESPONSE,
      { action: "CREATE_NOTIFICATION", data });
  });
  const summary = { candidates: rows.length, organizations: organizationIDs.length,
    sent: 0, skipped: 0, failed: 0 };
  for (const organizationID of organizationIDs) {
    const items = rows.filter((row) => Number(row.organizationid) === organizationID);
    const userIds = [...new Set(recipients.filter((row) =>
      Number(row.organizationid) === organizationID).map((row) => String(row.userid)))];
    if (!userIds.length || existingOrganizations.has(organizationID)) { summary.skipped += 1; continue; }
    const count = items.length;
    let message = `${count} Maintenance ${count === 1 ? "Item" : "Items"} Due Today.`;
    if (count <= 3) message += `\n\nScheduled Equipment:\n${items.map((row) => {
      const details = [String(row.equipmentname || "Equipment").trim()];
      if (String(row.area || "").trim()) details.push(`Area: ${String(row.area).trim()}`);
      details.push(`Schedule: ${String(row.scheduleofservicing).trim()}`,
        `Day: ${String(row.scheduleday).trim()}`);
      return `- ${details.join(" | ")}`;
    }).join("\n")}`;
    try {
      const response = await send({ organizationId: organizationID,
        title: "Engineering Maintenance Summary", message, type: "info",
        moduleName: MODULE_NAME, entityType: "EquipmentMaintenanceSummary",
        entityId: businessDate, action: ACTION, priority: "normal", userIds });
      if (!response || response.success !== true) throw new Error(response?.message || "No response");
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`Engineering maintenance notification failed for organization ${organizationID}:`, error.message);
    }
  }
  return summary;
};

const runEngineeringMaintenanceNotificationJob = async ({ poolOverride = pool,
  queryable = pool, emailService = MaintenanceEmailService, now = new Date(),
  publishNotification } = {}) => {
  const client = await poolOverride.connect();
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked;", [LOCK_KEY]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { skipped: true, reason: "already-running" };
    const businessDate = kolkataDateTime(now).date;
    const dueItems = await resolveDueMaintenance({ businessDate, queryable });
    const organizationIDs = [...new Set(dueItems.map((row) => Number(row.organizationid)))];
    const recipientRows = dueItems.length
      ? await resolveMaintenanceRecipients({ organizationIDs, queryable }) : [];
    let notification;
    try { notification = await processMaintenanceNotifications({ businessDate, dueItems,
      recipientRows, queryable, publishNotification }); }
    catch (error) { notification = { failed: 1 }; console.error("Engineering Maintenance Notification Job Failed:", error.message); }
    let email;
    try { email = await emailService.processEngineeringMaintenanceEmails({ businessDate,
      dueItems, recipientRows, queryable }); }
    catch (error) { email = { failed: 1 }; console.error("Engineering Maintenance Email Job Failed:", error.message); }
    return { skipped: false, notification, email };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1));", [LOCK_KEY])
      .catch((error) => console.error("Engineering Maintenance Job Unlock Failed:", error.message));
    client.release();
  }
};

const startEngineeringMaintenanceNotificationJob = () => {
  const hour = Math.min(Math.max(Number(process.env.ENGINEERING_MAINTENANCE_JOB_HOUR ?? 9), 0), 23);
  const minute = Math.min(Math.max(Number(process.env.ENGINEERING_MAINTENANCE_JOB_MINUTE ?? 0), 0), 59);
  let lastRunDate = null;
  const check = async () => {
    const current = kolkataDateTime();
    if (current.date === lastRunDate || current.hour < hour ||
      (current.hour === hour && current.minute < minute)) return;
    lastRunDate = current.date;
    try {
      const result = await runEngineeringMaintenanceNotificationJob();
      console.log("Engineering Maintenance Notification Job Completed:", result);
      if (Number(result.notification?.failed || 0) || Number(result.email?.failed || 0)) lastRunDate = null;
    } catch (error) {
      lastRunDate = null;
      console.error("Engineering Maintenance Notification Job Failed:", error.message);
    }
  };
  void check();
  const timer = setInterval(check, 60 * 1000);
  timer.unref?.();
  return timer;
};

module.exports = { kolkataDateTime, isMaintenanceDue, resolveDueMaintenance,
  resolveMaintenanceRecipients,
  processMaintenanceNotifications, runEngineeringMaintenanceNotificationJob,
  startEngineeringMaintenanceNotificationJob };
