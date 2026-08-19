const EDITABLE_FIELDS = Object.freeze([
  "EntryDate", "Status", "ResolvedBy", "GuestName", "RoomNumber", "Time",
  "Complaint", "ServiceRecovery", "DetailedInvestigation", "InternalActionTaken",
  "CompanyName", "Rate", "CheckInDate", "CheckOutDate", "GMComment",
  "ProcessLapse", "SRA_Room", "SRA_Food", "SRA_Other", "RaiseSource",
  "ComplaintSource", "AttachmentTitle", "GuestStatus", "ProcessLapseCategory",
  "InternalActionTakenCategory", "GetMetJson", "DepartmentIDs", "ReceivedByIDs",
  "InformedToIDs", "DepartmentHODComments",
]);

const PROTECTED_FIELDS = Object.freeze([
  "OrganizationID", "CreatedBy", "CreatedDate", "ModifyBy", "ModifyDate",
  "ModifiedBy", "DeletedBy", "DeletedDate", "CreatedIP", "ModifiedIP",
  "UserID", "Username", "IP",
]);

const pick = (source, fields) => fields.reduce((result, field) => {
  if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
  return result;
}, {});

const createDTO = (body = {}) => pick(body, EDITABLE_FIELDS);
const updateDTO = (body = {}) => ({ ID: body.ID ?? body.id, ...pick(body, EDITABLE_FIELDS) });

const parseCommaSeparatedIDs = (value) => {
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : String(value).split(","))
    .map((item) => String(item).trim());
};

const listDTO = (query = {}) => ({
  page: query.page ?? 1,
  pageSize: query.pageSize ?? 10,
  search: query.search ?? "",
  fromDate: query.fromDate ?? null,
  toDate: query.toDate ?? null,
  status: query.status ?? null,
  departmentIds: parseCommaSeparatedIDs(query.departmentIds),
  sortBy: query.sortBy ?? "EntryDate",
  sortDirection: query.sortDirection ?? "DESC",
});

const reportListDTO = (query = {}) => ({
  ...listDTO(query),
  roomNumber: query.roomNumber ?? null,
  guestName: query.guestName ?? null,
  complaint: query.complaint ?? null,
  complaintSource: query.complaintSource ?? null,
  raiseSource: query.raiseSource ?? null,
});

module.exports = { EDITABLE_FIELDS, PROTECTED_FIELDS, createDTO, updateDTO, listDTO, reportListDTO, parseCommaSeparatedIDs };
