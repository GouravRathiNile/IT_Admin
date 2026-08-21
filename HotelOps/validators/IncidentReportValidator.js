const { EDITABLE_FIELDS, PROTECTED_FIELDS, SORT_COLUMNS } = require("../config/incidentReportConstants");
const validationError = (field, message) => ({ field, message });
const has = (object, field) => Object.prototype.hasOwnProperty.call(object, field);

const isDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === String(value);
};
const isID = (value) => /^[A-Za-z0-9_-]{1,30}$/.test(String(value || ""));
const isTime = (value) => /^(([01]\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM))$/i.test(String(value || "").trim());

const validateFields = (data, create) => {
  const errors = [];
  const allowed = new Set([...EDITABLE_FIELDS, ...(create ? [] : ["ID", "id"])]);
  for (const field of Object.keys(data)) {
    if (PROTECTED_FIELDS.includes(field)) errors.push(validationError(field, `${field} cannot be supplied by the client.`));
    else if (!allowed.has(field)) errors.push(validationError(field, `${field} is not an allowed field.`));
  }
  for (const field of ["ReportDate", "IncidentDate", "Time", "Location", "AccidentCause", "Anycasualty", "Description"]) {
    if (create && !String(data[field] ?? "").trim()) errors.push(validationError(field, `${field} is required.`));
    else if (has(data, field) && !String(data[field] ?? "").trim()) errors.push(validationError(field, `${field} cannot be empty.`));
  }
  for (const field of ["ReportDate", "IncidentDate"]) if (has(data, field) && !isDate(data[field])) errors.push(validationError(field, `${field} must use YYYY-MM-DD format.`));
  if (has(data, "Time") && !isTime(data.Time)) errors.push(validationError("Time", "Time must use HH:mm or hh:mm AM/PM format."));
  const limits = { Time: 20, Location: 150, AccidentCause: 150, Anycasualty: 150, Damagedcaused: 2000, Investigation: 2000, InvestigatedBy: 60, PresentDuringIncident: 60, ReportTo: 60, ReportBy: 60 };
  for (const [field, max] of Object.entries(limits)) if (has(data, field) && String(data[field] ?? "").trim().length > max) errors.push(validationError(field, `${field} must not exceed ${max} characters.`));
  return errors;
};

const validateCreate = (body = {}) => validateFields(body, true);
const validateUpdate = (body = {}) => {
  const errors = validateID(body.ID ?? body.id);
  errors.push(...validateFields(body, false));
  if (!EDITABLE_FIELDS.some((field) => has(body, field))) errors.push(validationError("body", "At least one editable field is required."));
  return errors;
};
function validateID(value) {
  if (value === undefined || value === null || String(value).trim() === "") return [validationError("ID", "Incident Report ID is required")];
  return isID(value) ? [] : [validationError("ID", "Incident Report ID is invalid")];
}
const validateList = (data) => {
  const errors = [];
  if (!/^\d+$/.test(String(data.page)) || Number(data.page) < 1) errors.push(validationError("page", "Page must be a positive integer."));
  if (!/^\d+$/.test(String(data.pageSize)) || Number(data.pageSize) < 1 || Number(data.pageSize) > 100) errors.push(validationError("pageSize", "Page size must be between 1 and 100."));
  if (data.year != null && (!/^\d{4}$/.test(String(data.year)) || Number(data.year) < 1900 || Number(data.year) > 9999)) errors.push(validationError("year", "Year must be a valid four-digit year."));
  if (data.month != null && (!/^\d{1,2}$/.test(String(data.month)) || Number(data.month) < 1 || Number(data.month) > 12)) errors.push(validationError("month", "Month must be between 1 and 12."));
  if (data.month != null && data.year == null) errors.push(validationError("month", "Year is required when month is supplied."));
  for (const field of ["fromDate", "toDate"]) if (data[field] && !isDate(data[field])) errors.push(validationError(field, `${field} must use YYYY-MM-DD format.`));
  if (data.fromDate && data.toDate && data.toDate < data.fromDate) errors.push(validationError("toDate", "To date cannot be before from date."));
  if (!SORT_COLUMNS[data.sortBy]) errors.push(validationError("sortBy", "Invalid sort field."));
  if (!["ASC", "DESC"].includes(String(data.sortDirection).toUpperCase())) errors.push(validationError("sortDirection", "Sort direction must be ASC or DESC."));
  if (String(data.search || "").length > 500) errors.push(validationError("search", "Search must not exceed 500 characters."));
  return errors;
};

module.exports = { validateCreate, validateUpdate, validateID, validateList, isDate, isTime };
