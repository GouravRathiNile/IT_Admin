const RETRYABLE_ERROR_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "55P03", // lock_not_available
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

const isRetryableDatabaseError = (error) => {
  if (!error) return false;

  if (RETRYABLE_ERROR_CODES.has(error.code)) return true;

  return typeof error.code === "string" && error.code.startsWith("08");
};

const retryableDatabaseResponse = (error) => {
  if (!isRetryableDatabaseError(error)) return null;

  return {
    success: false,
    retry: true,
  };
};

module.exports = {
  isRetryableDatabaseError,
  retryableDatabaseResponse,
};
