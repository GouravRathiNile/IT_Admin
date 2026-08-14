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
]);

const pick = (source, fields) => fields.reduce((result, field) => {
  if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
  return result;
}, {});

const createDTO = (body = {}) => pick(body, EDITABLE_FIELDS);
const updateDTO = (body = {}) => ({ ID: body.ID ?? body.id, ...pick(body, EDITABLE_FIELDS) });

const listDTO = (body = {}) => ({
  page: body.page ?? 1,
  pageSize: body.pageSize ?? 10,
  search: body.search ?? "",
  fromDate: body.fromDate ?? null,
  toDate: body.toDate ?? null,
  status: body.status ?? null,
  roomNumber: body.roomNumber ?? null,
  complaint: body.complaint ?? null,
  departmentIds: body.departmentIds ?? [],
  receivedByIds: body.receivedByIds ?? [],
  informedToIds: body.informedToIds ?? [],
  guestStatus: body.guestStatus ?? null,
  companyName: body.companyName ?? null,
  complaintSource: body.complaintSource ?? null,
  raiseSource: body.raiseSource ?? null,
  createdBy: body.createdBy ?? null,
  updatedBy: body.updatedBy ?? null,
  sortBy: body.sortBy ?? "EntryDate",
  sortDirection: body.sortDirection ?? "DESC",
});

module.exports = { EDITABLE_FIELDS, PROTECTED_FIELDS, createDTO, updateDTO, listDTO };
