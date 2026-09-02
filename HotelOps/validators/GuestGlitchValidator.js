const { SORT_COLUMNS, REPORT_SORT_COLUMNS } = require("../config/guestGlitchConstants");
const { CREATE_FIELDS, EDITABLE_FIELDS, PROTECTED_FIELDS } = require("../dto/GuestGlitchDTO");

const isPositiveInteger = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const isISODate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === String(value);
};
const error = (field, message) => ({ field, message });

const parseJSONField = (value) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (_) { return value; }
};

const normalizeIDArray = (body, field, errors, required = false) => {
  const value = parseJSONField(body[field]);
  if (!Array.isArray(value)) {
    errors.push(error(field, `${field} must be an array.`));
    return [];
  }
  if (required && value.length === 0) errors.push(error(field, `At least one ${field.replace("IDs", "")} must be selected.`));
  if (value.some((id) => !isPositiveInteger(id))) errors.push(error(field, `${field} must contain only positive integer IDs.`));
  const normalized = value.map(Number);
  if (new Set(normalized).size !== normalized.length) errors.push(error(field, `${field} must not contain duplicate IDs.`));
  return normalized;
};

const validateCommon = (data, isCreate) => {
  const errors = [];
  const allowedFields = new Set(isCreate ? CREATE_FIELDS : [...EDITABLE_FIELDS, "ID", "id"]);
  for (const field of Object.keys(data)) {
    if (!allowedFields.has(field) && !PROTECTED_FIELDS.includes(field)) {
      errors.push(error(field, `${field} is not an allowed field.`));
    }
  }
  for (const field of PROTECTED_FIELDS) {
    if (isCreate && field === "OrganizationID") continue;
    if (Object.prototype.hasOwnProperty.call(data, field)) errors.push(error(field, `${field} cannot be supplied by the client.`));
  }

  const requiredText = ["GuestStatus", "RoomNumber", "GuestName", "Complaint", "Time"];
  for (const field of requiredText) {
    if (isCreate && (!Object.prototype.hasOwnProperty.call(data, field) || !String(data[field] ?? "").trim())) {
      errors.push(error(field, `${field.replace(/([A-Z])/g, " $1").trim()} is required.`));
    } else if (Object.prototype.hasOwnProperty.call(data, field) && !String(data[field] ?? "").trim()) {
      errors.push(error(field, `${field.replace(/([A-Z])/g, " $1").trim()} cannot be empty.`));
    }
  }
  if (isCreate) {
    if (data.OrganizationID === undefined || data.OrganizationID === null || data.OrganizationID === "") errors.push(error("OrganizationID", "Organization ID is required."));
    else if (!isPositiveInteger(data.OrganizationID)) errors.push(error("OrganizationID", "Organization ID must be a valid number."));
    else data.OrganizationID = Number(data.OrganizationID);
  }

  const lengths = {
    Status: 50, ResolvedBy: 60, GuestName: 60, RoomNumber: 60,
    ServiceRecovery: 2000, DetailedInvestigation: 2000, InternalActionTaken: 2000,
    CompanyName: 150, GMComment: 500, ProcessLapse: 500, RaiseSource: 30,
    ComplaintSource: 30, AttachmentTitle: 250, GuestStatus: 30,
    ProcessLapseCategory: 50, InternalActionTakenCategory: 50,
  };
  for (const [field, max] of Object.entries(lengths)) {
    if (data[field] != null && String(data[field]).trim().length > max) errors.push(error(field, `${field} must not exceed ${max} characters.`));
  }
  if (data.ResolvedBy !== undefined && data.ResolvedBy !== null && String(data.ResolvedBy).trim() !== "") {
    if (!isPositiveInteger(data.ResolvedBy)) errors.push(error("ResolvedBy", "ResolvedBy must be a valid positive user ID."));
    else data.ResolvedBy = Number(data.ResolvedBy);
  }
  if (data.Time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.Time))) errors.push(error("Time", "Time must use 24-hour HH:mm format."));

  for (const field of ["EntryDate", "CheckInDate", "CheckOutDate"]) {
    if (data[field] != null && data[field] !== "" && !isISODate(data[field])) errors.push(error(field, `${field} must use YYYY-MM-DD format.`));
  }
  if (data.CheckInDate && data.CheckOutDate && isISODate(data.CheckInDate) && isISODate(data.CheckOutDate) && data.CheckOutDate < data.CheckInDate) {
    errors.push(error("CheckOutDate", "Check-out date cannot be before check-in date."));
  }

  for (const field of ["Rate", "SRA_Room", "SRA_Food", "SRA_Other"]) {
    if (data[field] != null && data[field] !== "") {
      const value = Number(data[field]);
      if (!Number.isFinite(value) || value < 0 || !/^\d+(\.\d{1,2})?$/.test(String(data[field]))) {
        errors.push(error(field, `${field} must be a non-negative number with at most two decimal places.`));
      } else {
        const maximum = field === "Rate" ? 99999999.99 : 9999999999.99;
        if (value > maximum) errors.push(error(field, `${field} exceeds the maximum allowed value.`));
      }
    }
  }

  const requiredArrays = ["DepartmentIDs", "ReceivedByIDs", "InformedToIDs"];
  for (const field of requiredArrays) {
    if (isCreate || Object.prototype.hasOwnProperty.call(data, field)) data[field] = normalizeIDArray(data, field, errors, isCreate);
  }

  if (!isCreate && Object.prototype.hasOwnProperty.call(data, "DepartmentHODComments")) {
    const comments = parseJSONField(data.DepartmentHODComments ?? []);
    if (!Array.isArray(comments)) {
      errors.push(error("DepartmentHODComments", "DepartmentHODComments must be an array."));
      data.DepartmentHODComments = [];
    } else {
      const seen = new Set();
      const shouldValidateSelection = isCreate || Object.prototype.hasOwnProperty.call(data, "DepartmentIDs");
      const selectedDepartments = new Set((data.DepartmentIDs || []).map(Number));
      data.DepartmentHODComments = [];
      comments.forEach((item) => {
        const departmentName = String(item?.departmentName ?? "").trim();
        const legacyDepartmentID = item?.departmentId;
        const key = departmentName.toLowerCase() || String(legacyDepartmentID || "");
        const hodComment = String(item?.HODComment ?? item?.comment ?? "").trim();
        if (!item || (!departmentName && !isPositiveInteger(legacyDepartmentID))) errors.push(error("DepartmentHODComments", "Each HOD comment requires a valid departmentName."));
        else if (seen.has(key)) errors.push(error("DepartmentHODComments", "Duplicate department HOD comments are not allowed."));
        else if (shouldValidateSelection && legacyDepartmentID != null && !selectedDepartments.has(Number(legacyDepartmentID))) errors.push(error("DepartmentHODComments", "Department HOD comment can only be added for a selected department"));
        else if (hodComment.length > 500) errors.push(error("DepartmentHODComments", "HOD comments must not exceed 500 characters."));
        else {
          seen.add(key);
          data.DepartmentHODComments.push(departmentName
            ? { departmentName, HODComment: hodComment }
            : { departmentId: Number(legacyDepartmentID), HODComment: hodComment });
        }
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "GetMetJson")) {
    data.GetMetJson = parseJSONField(data.GetMetJson);
    if (data.GetMetJson !== null && (Array.isArray(data.GetMetJson) || typeof data.GetMetJson !== "object")) {
      errors.push(error("GetMetJson", "GetMetJson must be a JSON object."));
    }
  }

  return errors;
};

const validateCreate = (body = {}) => {
  const data = { ...body };
  const errors = validateCommon(data, true);
  return { data, errors };
};

const validateUpdate = (body = {}) => {
  const data = { ...body, ID: body.ID ?? body.id };
  const errors = [];
  if (data.ID === undefined || data.ID === null || data.ID === "") errors.push(error("ID", "Guest Glitch ID is required"));
  else if (!isPositiveInteger(data.ID)) errors.push(error("ID", "Guest Glitch ID must be a valid number"));
  errors.push(...validateCommon(data, false));
  if (!EDITABLE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field))) errors.push(error("body", "At least one editable field is required."));
  return { data, errors };
};

const validateID = (input = {}) => {
  const value = typeof input === "object" && input !== null ? input.ID ?? input.id : input;
  if (value === undefined || value === null || value === "") return [error("ID", "Guest Glitch ID is required")];
  return isPositiveInteger(value) ? [] : [error("ID", "Guest Glitch ID must be a valid number")];
};

const validateList = (data) => {
  const errors = [];
  if (!isPositiveInteger(data.page)) errors.push(error("page", "Page must be a positive integer."));
  if (!isPositiveInteger(data.pageSize) || Number(data.pageSize) > 100) errors.push(error("pageSize", "Page size must be between 1 and 100."));
  if (!SORT_COLUMNS[data.sortBy]) errors.push(error("sortBy", "Invalid sort field."));
  if (!['ASC', 'DESC'].includes(String(data.sortDirection).toUpperCase())) errors.push(error("sortDirection", "Sort direction must be ASC or DESC."));
  if (data.organizationId != null && data.organizationId !== "" && !isPositiveInteger(data.organizationId)) errors.push(error("organizationId", "Organization ID must be a valid number."));
  else if (data.organizationId != null && data.organizationId !== "") data.organizationId = Number(data.organizationId);
  for (const field of ["fromDate", "toDate"]) if (data[field] && !isISODate(data[field])) errors.push(error(field, `${field} must use YYYY-MM-DD format.`));
  if (data.fromDate && data.toDate && data.toDate < data.fromDate) errors.push(error("toDate", "To date cannot be before from date."));
  data.departmentIds = normalizeIDArray(data, "departmentIds", errors, false);
  return errors;
};

const validateStatus = (body = {}) => {
  const errors = validateID(body);
  if (!String(body.Status ?? body.status ?? "").trim()) errors.push(error("Status", "Status is required."));
  return errors;
};

const validateReportList = (data) => {
  const base = { ...data, sortBy: SORT_COLUMNS[data.sortBy] ? data.sortBy : "EntryDate" };
  const errors = validateList(base);
  data.departmentIds = base.departmentIds;
  if (!REPORT_SORT_COLUMNS[data.sortBy]) errors.push(error("sortBy", "Invalid report sort field."));
  for (const field of ["search", "status", "roomNumber", "guestName", "complaint", "complaintSource", "raiseSource"]) {
    if (data[field] != null && String(data[field]).length > 500) errors.push(error(field, `${field} is too long.`));
  }
  return errors;
};

const validateGMAction = (body = {}) => {
  const errors = validateID(body);
  const comment = String(body.GMComment ?? "").trim();
  if (!comment) errors.push(error("GMComment", "GMComment is required"));
  else if (comment.length > 500) errors.push(error("GMComment", "GMComment must not exceed 500 characters."));
  if (body.Status !== undefined && !String(body.Status).trim()) errors.push(error("Status", "Status cannot be empty."));
  return errors;
};

const validateDisposition = (value) => ["inline", "attachment"].includes(String(value || "inline").toLowerCase())
  ? [] : [error("disposition", "Disposition must be inline or attachment.")];

module.exports = { validateCreate, validateUpdate, validateID, validateList, validateReportList, validateStatus, validateGMAction, validateDisposition, isPositiveInteger };
