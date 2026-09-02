const numberOrNull = (value) => value == null ? null : Number(value);
const name = (item) => item.name || item.fullname || item.departmentname || item.username || "";

const compactReportDTO = (row) => ({
  ID: Number(row.id), Hotel: row.hotel || row.organizationname || null,
  EntryDate: row.entrydate, RoomNumber: row.roomnumber, GuestName: row.guestname,
  Departments: row.departments || row.department || "", Complaint: row.complaint,
  ProcessLapse: row.processlapse, ServiceRecovery: row.servicerecovery,
  DetailedInvestigation: row.detailedinvestigation, InternalActionTaken: row.internalactiontaken,
  CheckInDate: row.checkindate, CheckOutDate: row.checkoutdate, CompanyName: row.companyname,
  Rate: numberOrNull(row.rate), UpdatedBy: row.updatedby,
  ReceivedByUsers: row.receivedByUsers || row.receivedby || "", ResolvedBy: row.resolvedby,
  GMComment: row.gmcomment, Status: row.status,
});

const completeReportDTO = (row, resolved = {}) => ({
  ID: Number(row.id), Hotel: row.hotel || row.organizationname || null,
  OrganizationID: Number(row.organizationid), EntryDate: row.entrydate, Status: row.status,
  ResolvedBy: row.resolvedby, GuestStatus: row.gueststatus, RoomNumber: row.roomnumber,
  GuestName: row.guestname, Time: row.time, Complaint: row.complaint,
  ComplaintSource: row.complaintsource, RaiseSource: row.raisesource,
  DepartmentIDs: row.departmentids || [], Departments: resolved.departments || [],
  ReceivedByIDs: row.receivedbyids || [], ReceivedByUsers: resolved.receivedByUsers || [],
  InformedToIDs: row.informedtoids || [], InformedToUsers: resolved.informedToUsers || [],
  DepartmentHODComments: (row.departmenthodcomments || []).map((comment) => ({
    departmentName: comment.departmentName || name((resolved.departments || []).find(
      (item) => Number(item.id) === Number(comment.departmentId)
    ) || {}),
    HODComment: String(comment.HODComment ?? comment.comment ?? ""),
  })),
  ProcessLapse: row.processlapse, ProcessLapseCategory: row.processlapsecategory,
  ServiceRecovery: row.servicerecovery, DetailedInvestigation: row.detailedinvestigation,
  InternalActionTaken: row.internalactiontaken,
  InternalActionTakenCategory: row.internalactiontakencategory,
  CompanyName: row.companyname, Rate: numberOrNull(row.rate), CheckInDate: row.checkindate,
  CheckOutDate: row.checkoutdate, SRA_Room: numberOrNull(row.sra_room),
  SRA_Food: numberOrNull(row.sra_food), SRA_Other: numberOrNull(row.sra_other),
  GMComment: row.gmcomment, GetMetJson: row.getmetjson,
  Attachment: row.attachment ? { Title: row.attachmenttitle, Available: true } : null,
  CreatedBy: row.createdby, CreatedDate: row.createddate, CreatedIP: row.createdip,
  ModifyBy: row.modifyby, ModifyDate: row.modifydate, ModifiedIP: row.modifiedip,
  UpdatedBy: row.updatedby, Deleted: Boolean(row.isdeleted),
  FieldAudits: Object.fromEntries(Object.entries(row)
    .filter(([key]) => key.endsWith("updateby") || key.endsWith("updatebyon"))
    .map(([key, value]) => [key, value])),
});

module.exports = { compactReportDTO, completeReportDTO };
