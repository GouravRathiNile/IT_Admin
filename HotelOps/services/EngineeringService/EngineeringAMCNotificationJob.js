const { pool } = require("../../db");
const AMCService = require("./EngineeringAMCService");
const AMCEmailService = require("./EngineeringAMCEmailService");

const TIME_ZONE = "Asia/Kolkata";
const LOCK_KEY = "engineering-equipment-amc-expiry-job";

const kolkataDateTime = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour), minute: Number(parts.minute) };
};

const runEngineeringAMCNotificationJob = async ({ poolOverride = pool,
  queryable = pool, service = AMCService, emailService = AMCEmailService,
  publishNotification, now = new Date() } = {}) => {
  const client = await poolOverride.connect();
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked;", [LOCK_KEY]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { skipped: true, reason: "already-running" };
    const businessDate = kolkataDateTime(now).date;
    const amcRows = await service.resolveExpiringAMCs({ businessDate, queryable });
    const organizationIDs = [...new Set(amcRows.map((row) => Number(row.organizationid)))];
    const recipientRows = amcRows.length
      ? await service.resolveAMCRecipients({ organizationIDs, queryable }) : [];
    let notification;
    try {
      notification = await service.processAMCNotifications({ businessDate, amcRows,
        recipientRows, queryable, publishNotification });
    } catch (error) {
      notification = { failed: 1 };
      console.error("Engineering AMC Notification Job Failed:", error.message);
    }
    let email;
    try {
      email = await emailService.processEngineeringAMCEmails({ businessDate, amcRows,
        recipientRows, queryable });
    } catch (error) {
      email = { failed: 1 };
      console.error("Engineering AMC Email Job Failed:", error.message);
    }
    return { skipped: false, notification, email };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1));", [LOCK_KEY])
      .catch((error) => console.error("Engineering AMC Job Unlock Failed:", error.message));
    client.release();
  }
};

const startEngineeringAMCNotificationJob = () => {
  const hour = Math.min(Math.max(Number(process.env.ENGINEERING_AMC_JOB_HOUR ?? 9), 0), 23);
  const minute = Math.min(Math.max(Number(process.env.ENGINEERING_AMC_JOB_MINUTE ?? 0), 0), 59);
  let lastRunDate = null;
  const check = async () => {
    const current = kolkataDateTime();
    if (current.date === lastRunDate || current.hour < hour ||
      (current.hour === hour && current.minute < minute)) return;
    lastRunDate = current.date;
    try {
      const result = await runEngineeringAMCNotificationJob();
      console.log("Engineering AMC Notification Job Completed:", result);
      if (Number(result.notification?.failed || 0) || Number(result.email?.failed || 0)) {
        lastRunDate = null;
      }
    } catch (error) {
      lastRunDate = null;
      console.error("Engineering AMC Notification Job Failed:", error.message);
    }
  };
  void check();
  const timer = setInterval(check, 60 * 1000);
  timer.unref?.();
  return timer;
};

module.exports = { kolkataDateTime, runEngineeringAMCNotificationJob,
  startEngineeringAMCNotificationJob };
