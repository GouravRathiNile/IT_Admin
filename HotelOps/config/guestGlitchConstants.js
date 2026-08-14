const PERMISSIONS = Object.freeze({
  VIEW: "GuestGlitch.View",
  CREATE: "GuestGlitch.Create",
  UPDATE: "GuestGlitch.Update",
  DELETE: "GuestGlitch.Delete",
  STATUS_UPDATE: "GuestGlitch.StatusUpdate",
  REPORT: "GuestGlitch.Report",
  MASTER_REPORT: "GuestGlitch.MasterReport",
  OPTION_MANAGE: "GuestGlitch.OptionManage",
});

const OPTION_TYPES = Object.freeze([
  "Status",
  "GuestStatus",
  "ComplaintSource",
  "RaiseSource",
  "ProcessLapseCategory",
  "InternalActionTakenCategory",
]);

const STATUS_TRANSITIONS = Object.freeze({
  Open: ["In Progress"],
  "In Progress": ["Resolved"],
  Resolved: ["Closed"],
  Closed: [],
});

const SORT_COLUMNS = Object.freeze({
  ID: "gg.id",
  EntryDate: "gg.entrydate",
  Status: "gg.status",
  RoomNumber: "gg.roomnumber",
  GuestName: "gg.guestname",
  CreatedDate: "gg.createddate",
  ModifyDate: "gg.modifydate",
});

const FIELD_AUDIT_COLUMNS = Object.freeze({
  EntryDate: ["entrydateupdateby", "entrydateupdatebyon"],
  Status: ["statusupdateby", "statusupdatebyon"],
  ResolvedBy: ["resolvedbyupdateby", "resolvedbyupdatebyon"],
  ReceivedBy: ["receivedbyupdateby", "receivedbyupdatebyon"],
  InformedTo: ["informedtoupdateby", "informedtoupdatebyon"],
  GuestName: ["guestnameupdateby", "guestnameupdatebyon"],
  RoomNumber: ["roomnumberupdateby", "roomnumberupdatebyon"],
  Time: ["timeupdateby", "timeupdatebyon"],
  Complaint: ["complaintupdateby", "complaintupdatebyon"],
  ServiceRecovery: ["servicerecoveryupdateby", "servicerecoveryupdatebyon"],
  DetailedInvestigation: ["detailedinvestigationupdateby", "detailedinvestigationupdatebyon"],
  InternalActionTaken: ["internalactiontakenupdateby", "internalactiontakenupdatebyon"],
  CompanyName: ["companynameupdateby", "companynameupdatebyon"],
  Rate: ["rateupdateby", "rateupdatebyon"],
  CheckInDate: ["checkindateupdateby", "checkindateupdatebyon"],
  CheckOutDate: ["checkoutdateupdateby", "checkoutdateupdatebyon"],
  UpdatedBy: ["updatedbyupdateby", "updatedbyupdatebyon"],
  GMComment: ["gmcommentupdateby", "gmcommentupdatebyon"],
  ProcessLapse: ["processlapseupdateby", "processlapseupdatebyon"],
  Department: ["departmentupdateby", "departmentupdatebyon"],
  SRA_Room: ["sra_roomupdateby", "sra_roomupdatebyon"],
  SRA_Food: ["sra_foodupdateby", "sra_foodupdatebyon"],
  SRA_Other: ["sra_otherupdateby", "sra_otherupdatebyon"],
  RaiseSource: ["raisesourceupdateby", "raisesourceupdatebyon"],
  ComplaintSource: ["complaintsourceupdateby", "complaintsourceupdatebyon"],
  AttachmentTitle: ["attachmenttitleupdateby", "attachmenttitleupdatebyon"],
  Attachment: ["attachmentupdateby", "attachmentupdatebyon"],
  GuestStatus: ["gueststatusupdateby", "gueststatusupdatebyon"],
  ProcessLapseCategory: ["processlapsecategoryupdateby", "processlapsecategoryupdatebyon"],
  InternalActionTakenCategory: ["internalactiontakencategoryupdateby", "internalactiontakencategoryupdatebyon"],
});

module.exports = {
  PERMISSIONS,
  OPTION_TYPES,
  STATUS_TRANSITIONS,
  SORT_COLUMNS,
  FIELD_AUDIT_COLUMNS,
};
