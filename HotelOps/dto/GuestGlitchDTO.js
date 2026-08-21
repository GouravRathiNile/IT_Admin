const { formatDate } = require("../utils/dateFormatter");

const EDITABLE_FIELDS = Object.freeze([
  "EntryDate",
  "Status",
  "ResolvedBy",
  "GuestName",
  "RoomNumber",
  "Time",
  "Complaint",
  "ServiceRecovery",
  "DetailedInvestigation",
  "InternalActionTaken",
  "CompanyName",
  "Rate",
  "CheckInDate",
  "CheckOutDate",
  "GMComment",
  "ProcessLapse",
  "SRA_Room",
  "SRA_Food",
  "SRA_Other",
  "RaiseSource",
  "ComplaintSource",
  "AttachmentTitle",
  "GuestStatus",
  "ProcessLapseCategory",
  "InternalActionTakenCategory",
  "GetMetJson",
  "DepartmentIDs",
  "ReceivedByIDs",
  "InformedToIDs",
  "DepartmentHODComments",
]);

const PROTECTED_FIELDS = Object.freeze([
  "OrganizationID",
  "CreatedBy",
  "CreatedDate",
  "ModifyBy",
  "ModifyDate",
  "ModifiedBy",
  "DeletedBy",
  "DeletedDate",
  "CreatedIP",
  "ModifiedIP",
  "UserID",
  "Username",
  "IP",
  "CurrentWorkflowStage",
]);

const pick = (source, fields) =>
  fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
    return result;
  }, {});

const createDTO = (body = {}) => ({
  ...pick(body, EDITABLE_FIELDS),
  UpdatedBy: body.UpdatedBy ?? null,
});

const updateDTO = (body = {}) => ({
  ID: body.ID ?? body.id,
  ...pick(body, EDITABLE_FIELDS),
  WorkflowAction: body.WorkflowAction,
  UpdatedBy: body.UpdatedBy ?? null,
});

const parseCommaSeparatedIDs = (value) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  return (Array.isArray(value) ? value : String(value).split(","))
    .map((item) => String(item).trim())
    .filter(Boolean);
};

const formatGuestGlitchDates = (data = {}) => ({
  ...data,
  EntryDate: formatDate(data.EntryDate),
  CheckInDate: formatDate(data.CheckInDate),
  CheckOutDate: formatDate(data.CheckOutDate),
  CreatedDate: formatDate(data.CreatedDate, "DD MMM YYYY HH:mm"),
  ModifyDate: formatDate(data.ModifyDate, "DD MMM YYYY HH:mm"),
});

/*
 * LIST REQUEST / FILTER DTO
 */
const listDTO = (query = {}) => ({
  page: query.page ?? 1,
  pageSize: query.pageSize ?? 10,

  search: query.search ?? "",

  fromDate: query.fromDate ?? null,
  toDate: query.toDate ?? null,

  status: query.status ?? null,
  guestStatus: query.guestStatus ?? null,

  departmentIds: parseCommaSeparatedIDs(query.departmentIds),
  receivedByIds: parseCommaSeparatedIDs(query.receivedByIds),
  informedToIds: parseCommaSeparatedIDs(query.informedToIds),

  roomNumber: query.roomNumber ?? null,
  guestName: query.guestName ?? null,
  complaint: query.complaint ?? null,

  complaintSource: query.complaintSource ?? null,
  raiseSource: query.raiseSource ?? null,

  processLapse: query.processLapse ?? null,
  processLapseCategory: query.processLapseCategory ?? null,

  companyName: query.companyName ?? null,

  checkInDate: query.checkInDate ?? null,
  checkOutDate: query.checkOutDate ?? null,

  internalActionTaken: query.internalActionTaken ?? null,
  internalActionTakenCategory:
    query.internalActionTakenCategory ?? null,

  createdBy: query.createdBy ?? null,
  updatedBy: query.updatedBy ?? null,

  sortBy: query.sortBy ?? "EntryDate",
  sortDirection: query.sortDirection ?? "DESC",
});

/*
 * REPORT FILTER DTO
 */
const reportListDTO = (query = {}) => ({
  ...listDTO(query),
});

/*
 * LIST RESPONSE DTO
 *
 * Only fields required by the list UI
 * + fields useful for filtering/future filtering.
 */
const listResponseDTO = (row, resolved = {}) => ({
  ID: Number(row.id),

  OrganizationID:
    row.organizationid == null
      ? null
      : Number(row.organizationid),

  OrganizationName: row.organizationname ?? null,

  EntryDate: formatDate(row.entrydate),
  Time: row.time,

  RoomNumber: row.roomnumber,
  GuestName: row.guestname,
  GuestStatus: row.gueststatus,

  Departments: resolved.departments || [],

  Complaint: row.complaint,
  Status: row.status,
  CurrentWorkflowStage: row.currentworkflowstage ?? null,

  ComplaintSource: row.complaintsource,
  RaiseSource: row.raisesource,

  ProcessLapse: row.processlapse,
  ProcessLapseCategory: row.processlapsecategory,

  ServiceRecovery: row.servicerecovery,

  InternalActionTaken: row.internalactiontaken,
  InternalActionTakenCategory:
    row.internalactiontakencategory,

  CompanyName: row.companyname,

  CheckInDate: formatDate(row.checkindate),
  CheckOutDate: formatDate(row.checkoutdate),

  CreatedBy: row.createdby,
  UpdatedBy: row.updatedby,
});

/*
 * COMPLETE REPORT / DETAIL DTO
 *
 * Used by:
 * - Guest Glitch Report Detail
 * - Master Report
 * - PDF generation
 */
const completeReportDTO = (row = {}, resolved = {}) => ({
  ID: row.id ?? row.ID,

  OrganizationID:
    row.organizationid ?? row.OrganizationID,

  OrganizationName:
    row.organizationname ?? row.OrganizationName ?? null,

  EntryDate: formatDate(row.entrydate ?? row.EntryDate),

  Status:
    row.status ?? row.Status ?? null,

  CurrentWorkflowStage:
    row.currentworkflowstage ?? row.CurrentWorkflowStage ?? null,

  ResolvedBy:
    row.resolvedby ?? row.ResolvedBy ?? null,

  GuestName:
    row.guestname ?? row.GuestName ?? null,

  RoomNumber:
    row.roomnumber ?? row.RoomNumber ?? null,

  Time:
    row.time ?? row.Time ?? null,

  Complaint:
    row.complaint ?? row.Complaint ?? null,

  ServiceRecovery:
    row.servicerecovery ?? row.ServiceRecovery ?? null,

  DetailedInvestigation:
    row.detailedinvestigation ?? row.DetailedInvestigation ?? null,

  InternalActionTaken:
    row.internalactiontaken ?? row.InternalActionTaken ?? null,

  CompanyName:
    row.companyname ?? row.CompanyName ?? null,

  Rate:
    row.rate ?? row.Rate ?? null,

  CheckInDate: formatDate(row.checkindate ?? row.CheckInDate),

  CheckOutDate: formatDate(row.checkoutdate ?? row.CheckOutDate),

  UpdatedBy:
    row.updatedby ?? row.UpdatedBy ?? null,

  GMComment:
    row.gmcomment ?? row.GMComment ?? null,

  ProcessLapse:
    row.processlapse ?? row.ProcessLapse ?? null,

  SRA_Room:
    row.sra_room ?? row.SRA_Room ?? null,

  SRA_Food:
    row.sra_food ?? row.SRA_Food ?? null,

  SRA_Other:
    row.sra_other ?? row.SRA_Other ?? null,

  RaiseSource:
    row.raisesource ?? row.RaiseSource ?? null,

  ComplaintSource:
    row.complaintsource ?? row.ComplaintSource ?? null,

  AttachmentTitle:
    row.attachmenttitle ?? row.AttachmentTitle ?? null,

  Attachment:
    row.attachment ?? row.Attachment ?? null,

  GuestStatus:
    row.gueststatus ?? row.GuestStatus ?? null,

  ProcessLapseCategory:
    row.processlapsecategory ??
    row.ProcessLapseCategory ??
    null,

  InternalActionTakenCategory:
    row.internalactiontakencategory ??
    row.InternalActionTakenCategory ??
    null,

  GetMetJson:
    row.getmetjson ?? row.GetMetJson ?? null,

  DepartmentIDs:
    row.departmentids ?? row.DepartmentIDs ?? [],

  ReceivedByIDs:
    row.receivedbyids ?? row.ReceivedByIDs ?? [],

  InformedToIDs:
    row.informedtoids ?? row.InformedToIDs ?? [],

  DepartmentHODComments:
    row.departmenthodcomments ??
    row.DepartmentHODComments ??
    [],

  CreatedBy:
    row.createdby ?? row.CreatedBy ?? null,

  CreatedDate: formatDate(row.createddate ?? row.CreatedDate, "DD MMM YYYY HH:mm"),

  ModifyBy:
    row.modifyby ?? row.ModifyBy ?? null,

  ModifyDate: formatDate(row.modifydate ?? row.ModifyDate, "DD MMM YYYY HH:mm"),

  Departments:
    resolved.departments || [],

  ReceivedByUsers:
    resolved.receivedByUsers || [],

  InformedToUsers:
    resolved.informedToUsers || [],
});

const compactReportDTO = (row = {}) => ({
  ID: Number(row.id),

  OrganizationID:
    row.organizationid == null
      ? null
      : Number(row.organizationid),

  OrganizationName:
    row.organizationname ??
    row.hotel ??
    null,

  EntryDate: formatDate(row.entrydate),
  Time: row.time ?? null,

  RoomNumber: row.roomnumber ?? null,
  GuestName: row.guestname ?? null,
  GuestStatus: row.gueststatus ?? null,

  Departments:
    row.departments ?? null,

  ReceivedByUsers:
    row.receivedByUsers ?? null,

  InformedToUsers:
    row.informedToUsers ?? null,

  Complaint: row.complaint ?? null,
  Status: row.status ?? null,

  ComplaintSource:
    row.complaintsource ?? null,

  RaiseSource:
    row.raisesource ?? null,

  ProcessLapse:
    row.processlapse ?? null,

  ProcessLapseCategory:
    row.processlapsecategory ?? null,

  ServiceRecovery:
    row.servicerecovery ?? null,

  InternalActionTaken:
    row.internalactiontaken ?? null,

  InternalActionTakenCategory:
    row.internalactiontakencategory ?? null,

  CompanyName:
    row.companyname ?? null,

  Rate:
    row.rate == null ? null : Number(row.rate),

  CheckInDate: formatDate(row.checkindate),

  CheckOutDate: formatDate(row.checkoutdate),

  ResolvedBy:
    row.resolvedby ?? null,

  UpdatedBy:
    row.updatedby ?? null,

  GMComment:
    row.gmcomment ?? null,
});

module.exports = {
  EDITABLE_FIELDS,
  PROTECTED_FIELDS,
  createDTO,
  updateDTO,
  listDTO,
  reportListDTO,
  parseCommaSeparatedIDs,
  listResponseDTO,
  completeReportDTO,
  compactReportDTO,
  formatGuestGlitchDates,
};
