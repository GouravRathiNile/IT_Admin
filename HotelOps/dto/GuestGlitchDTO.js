const { formatDate } = require("../utils/dateFormatter");

const mapHODComments = (comments = [], departments = []) => comments.map((item) => ({
  departmentName: item.departmentName ?? departments.find((department) =>
    Number(department.ID ?? department.id) === Number(item.departmentId)
  )?.Name ?? departments.find((department) =>
    Number(department.ID ?? department.id) === Number(item.departmentId)
  )?.name ?? null,
  HODComment: String(item.HODComment ?? item.comment ?? ""),
}));

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
]);

const CREATE_FIELDS = Object.freeze([
  "OrganizationID", "GuestStatus", "RoomNumber", "GuestName", "Complaint",
  "DepartmentIDs", "ReceivedByIDs", "InformedToIDs", "Time", "CompanyName",
]);

const pick = (source, fields) =>
  fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
    return result;
  }, {});

const createDTO = (body = {}) => ({
  ...pick(body, CREATE_FIELDS),
});

const updateDTO = (body = {}) => ({
  ID: body.ID ?? body.id,
  ...pick(body, EDITABLE_FIELDS),
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

  organizationId: query.organizationId ?? query.OrganizationID ?? null,

  search: query.search ?? "",

  fromDate: query.fromDate ?? null,
  toDate: query.toDate ?? null,

  status: query.status ?? null,
  guestStatus: query.guestStatus ?? null,

  departmentIds: parseCommaSeparatedIDs(query.departmentIds),
  receivedByIds: parseCommaSeparatedIDs(query.receivedByIds),
  informedToIds: parseCommaSeparatedIDs(query.informedToIds),

  roomNumber: query.roomNumber ?? query.RoomNumber ?? null,
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
 * Includes the list columns plus stored fields required to reopen the Edit form.
 */
const listResponseDTO = (row, resolved = {}) => ({
  ID: Number(row.id),

  OrganizationID:
    row.organizationid == null
      ? null
      : Number(row.organizationid),

  OrganizationName: row.shortname ?? null,

  EntryDate: formatDate(row.entrydate),
  Time: row.time,

  RoomNumber: row.roomnumber,
  GuestName: row.guestname,
  GuestStatus: row.gueststatus ?? null,
  Departments: resolved.departments || [],
  ReceivedByUsers: resolved.receivedByUsers || [],
  InformedToUsers: resolved.informedToUsers || [],
  ResolvedBy: row.resolvedby ?? null,

  Complaint: row.complaint,
  Status: row.status,

  ProcessLapseCategory: row.processlapsecategory ?? null,
  ProcessLapse: row.processlapse ?? null,
  InternalActionTakenCategory: row.internalactiontakencategory ?? null,
  InternalActionTaken: row.internalactiontaken ?? null,
  DetailedInvestigation: row.detailedinvestigation ?? null,
  ServiceRecovery: row.servicerecovery,
  GMComment: row.gmcomment ?? null,

  SRA_Room: row.sra_room == null ? null : Number(row.sra_room),
  SRA_Food: row.sra_food == null ? null : Number(row.sra_food),
  SRA_Other: row.sra_other == null ? null : Number(row.sra_other),

  DepartmentHODComments: mapHODComments(row.departmenthodcomments || [], resolved.departments || []),
  GetMetJson: row.getmetjson || [],

  CompanyName: row.companyname ?? null,
  Rate: row.rate == null ? null : Number(row.rate),
  CheckInDate: formatDate(row.checkindate),
  CheckOutDate: formatDate(row.checkoutdate),
  ComplaintSource: row.complaintsource ?? null,
  RaiseSource: row.raisesource ?? null,
  AttachmentTitle: row.attachmenttitle ?? null,
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

  DepartmentHODComments: mapHODComments(
    row.departmenthodcomments ?? row.DepartmentHODComments ?? [],
    resolved.departments || []
  ),

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
  CREATE_FIELDS,
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
