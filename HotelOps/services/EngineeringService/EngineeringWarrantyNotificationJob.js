const { pool } = require("../../db");
const EngineeringService = require("./EngineeringService");

const TIME_ZONE = "Asia/Kolkata";
const LOCK_KEY = "engineering-equipment-warranty-notification-job";

const kolkataDateTime = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour), minute: Number(parts.minute) };
};

// The session-level advisory lock makes the daily job safe across app instances.
const runEngineeringWarrantyNotificationJob = async ({
  poolOverride = pool, service = EngineeringService, now = new Date(),
} = {}) => {
  const client = await poolOverride.connect();
  let locked = false;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked;", [LOCK_KEY]);
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) return { skipped: true, reason: "already-running" };
    const result = await service.processEquipmentWarrantyNotifications({
      businessDate: kolkataDateTime(now).date,
    });
    return { skipped: false, ...result };
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(hashtext($1));", [LOCK_KEY]); }
      catch (error) { console.error("Engineering Warranty Job Unlock Failed:", error.message); }
    }
    client.release();
  }
};

const startEngineeringWarrantyNotificationJob = () => {
  const hour = Math.min(Math.max(Number(process.env.ENGINEERING_WARRANTY_JOB_HOUR ?? 8), 0), 23);
  const minute = Math.min(Math.max(Number(process.env.ENGINEERING_WARRANTY_JOB_MINUTE ?? 0), 0), 59);
  let lastRunDate = null;

  const check = async () => {
    const current = kolkataDateTime();
    if (current.date === lastRunDate || current.hour < hour ||
      (current.hour === hour && current.minute < minute)) return;
    lastRunDate = current.date;
    try {
      const result = await runEngineeringWarrantyNotificationJob();
      console.log("Engineering Warranty Notification Job Completed:", result);
      // Successful rows are found by the duplicate check on retry; only failed
      // publishes are retried during the same business day.
      if (Number(result.failed || 0) > 0) lastRunDate = null;
    } catch (error) {
      // Scheduling failure is isolated from the API and will be retried next minute.
      lastRunDate = null;
      console.error("Engineering Warranty Notification Job Failed:", error.message);
    }
  };

  void check();
  const timer = setInterval(check, 60 * 1000);
  timer.unref?.();
  return timer;
};

module.exports = { kolkataDateTime, runEngineeringWarrantyNotificationJob,
  startEngineeringWarrantyNotificationJob };
