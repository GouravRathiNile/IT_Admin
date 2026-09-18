const { pool } = require("../../db");
const EngineeringService = require("./EngineeringService");

const TIME_ZONE = "Asia/Kolkata";
const LOCK_KEY = "engineering-equipment-warranty-status-job";

const kolkataDateTime = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour), minute: Number(parts.minute) };
};

const boundedSetting = (value, fallback, maximum) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback;
};

const warrantyStatusSchedule = () => ({
  hour: boundedSetting(process.env.ENGINEERING_WARRANTY_STATUS_JOB_HOUR, 8, 23),
  minute: boundedSetting(process.env.ENGINEERING_WARRANTY_STATUS_JOB_MINUTE, 0, 59),
});

const runEngineeringWarrantyStatusJob = async ({ poolOverride = pool,
  service = EngineeringService, now = new Date() } = {}) => {
  const client = await poolOverride.connect();
  let locked = false;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked;", [LOCK_KEY]);
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) return { skipped: true, reason: "already-running" };

    const businessDate = kolkataDateTime(now).date;
    const result = await service.processWarrantyStatusUpdates({ businessDate });
    return { skipped: false, ...result };
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(hashtext($1));", [LOCK_KEY]); }
      catch (error) { console.error("Engineering Warranty Status Job Unlock Failed:", error.message); }
    }
    client.release();
  }
};

const startEngineeringWarrantyStatusJob = () => {
  const { hour, minute } = warrantyStatusSchedule();
  let lastRunDate = null;

  const check = async () => {
    const current = kolkataDateTime();
    if (current.date === lastRunDate || current.hour < hour ||
      (current.hour === hour && current.minute < minute)) return;

    lastRunDate = current.date;
    try {
      const result = await runEngineeringWarrantyStatusJob();
      console.log("Engineering Warranty Status Job Completed:", result);
      if (Number(result.failed || 0) > 0) lastRunDate = null;
    } catch (error) {
      // A failed run is retried on the next minute without affecting APIs.
      lastRunDate = null;
      console.error("Engineering Warranty Status Job Failed:", error.message);
    }
  };

  void check();
  const timer = setInterval(check, 60 * 1000);
  timer.unref?.();
  return timer;
};

module.exports = { kolkataDateTime, warrantyStatusSchedule,
  runEngineeringWarrantyStatusJob, startEngineeringWarrantyStatusJob };
