const output = (key, label, publicKey, options = {}) => Object.freeze({
  key, label, publicKey, selectable: true, sortable: Boolean(options.sortable),
});

const guestGlitch = Object.freeze({
  module: "GuestGlitch",
  reportType: "guest-glitch",
  label: "Guest Glitch Report",
  title: "Guest Glitch Report",
  runnable: true,
  execution: "guestGlitchCompact",
  export: Object.freeze({
    formats: Object.freeze(["csv", "excel", "pdf"]),
    maxRows: 25000,
    pdfMaxRows: 2500,
    orientation: "landscape",
    filename: "Guest_Glitch_Report",
  }),
  filters: Object.freeze([
    { key: "organizationId", optionKey: "organization", label: "Organization", type: "organization", filterable: true, required: false, optionSource: "organization", engineField: "organizationId", operator: "equals" },
    { key: "fromDate", label: "From Date", type: "date", filterable: true, required: false, engineField: "entryDate", operator: "greaterThanOrEqual" },
    { key: "toDate", label: "To Date", type: "date", filterable: true, required: false, engineField: "entryDate", operator: "lessThanOrEqual" },
    { key: "departmentId", optionKey: "department", label: "Department", type: "department", filterable: true, required: false, optionSource: "department", engineField: "departmentId", operator: "in", wrapArray: true },
    { key: "status", label: "Status", type: "select", filterable: true, required: false, optionSource: "Status", engineField: "status", operator: "equals" },
    { key: "complaint", label: "Complaint", type: "text", filterable: true, required: false, engineField: "complaint", operator: "contains" },
  ].map(Object.freeze)),
  columns: Object.freeze([
    output("id", "ID", "ID", { sortable: true }),
    output("organization", "Organization", "Organization", { sortable: true }),
    output("entryDate", "Entry Date", "EntryDate", { sortable: true }),
    output("roomNumber", "Room Number", "RoomNumber", { sortable: true }),
    output("guestName", "Guest Name", "GuestName", { sortable: true }),
    output("departments", "Departments", "Departments"),
    output("complaint", "Complaint", "Complaint"),
    output("processLapse", "Process Lapse", "ProcessLapse"),
    output("serviceRecovery", "Service Recovery", "ServiceRecovery"),
    output("detailedInvestigation", "Detailed Investigation", "DetailedInvestigation"),
    output("internalActionTaken", "Internal Action Taken", "InternalActionTaken"),
    output("checkInDate", "Check-In Date", "CheckInDate"),
    output("checkOutDate", "Check-Out Date", "CheckOutDate"),
    output("companyName", "Company Name", "CompanyName"),
    output("rate", "Rate", "Rate", { sortable: true }),
    output("updatedBy", "Updated By", "UpdatedBy"),
    output("receivedBy", "Received By", "ReceivedBy"),
    output("resolvedBy", "Resolved By", "ResolvedBy"),
    output("gmComment", "GM Comment", "GMComment"),
    output("status", "Status", "Status", { sortable: true }),
  ]),
  sortFields: Object.freeze({
    id: true, organization: true, entryDate: true,
    roomNumber: true, guestName: true, status: true, rate: true,
  }),
  defaultSort: Object.freeze([
    { field: "entryDate", direction: "DESC" }, { field: "id", direction: "DESC" },
  ]),
});

const guestGlitchMaster = Object.freeze({
  module: "GuestGlitch",
  reportType: "guest-glitch-master",
  label: "Guest Glitch Master Report",
  title: "Guest Glitch Master Report",
  runnable: true,
  execution: "guestGlitchMaster",
  filters: Object.freeze([
    { key: "organizationId", optionKey: "organization", label: "Organization", type: "organization", required: false, optionSource: "organization", targetKey: "organizationId" },
    { key: "fromDate", label: "From Date", type: "date", required: false, targetKey: "fromDate" },
    { key: "toDate", label: "To Date", type: "date", required: false, targetKey: "toDate" },
    { key: "departmentId", optionKey: "department", label: "Department", type: "department", required: false, optionSource: "department", targetKey: "departmentIds", wrapArray: true },
    { key: "receivedById", optionKey: "receivedBy", label: "Received By", type: "user", required: false, optionSource: "user", targetKey: "receivedByIds", wrapArray: true },
    { key: "informedToId", optionKey: "informedTo", label: "Informed To", type: "user", required: false, optionSource: "user", targetKey: "informedToIds", wrapArray: true },
    { key: "status", label: "Status", type: "select", required: false, optionSource: "Status", targetKey: "status" },
    { key: "guestStatus", label: "Guest Status", type: "select", required: false, optionSource: "GuestStatus", targetKey: "guestStatus" },
    { key: "search", label: "Search", type: "text", required: false, targetKey: "search" },
    { key: "roomNumber", label: "Room Number", type: "text", required: false, targetKey: "roomNumber" },
    { key: "guestName", label: "Guest Name", type: "text", required: false, targetKey: "guestName" },
    { key: "complaint", label: "Complaint", type: "text", required: false, targetKey: "complaint" },
    { key: "complaintSource", label: "Complaint Source", type: "select", required: false, optionSource: "ComplaintSource", targetKey: "complaintSource" },
    { key: "raiseSource", label: "Raise Source", type: "select", required: false, optionSource: "RaiseSource", targetKey: "raiseSource" },
    { key: "processLapse", label: "Process Lapse", type: "text", required: false, targetKey: "processLapse" },
    { key: "processLapseCategory", label: "Process Lapse Category", type: "select", required: false, optionSource: "ProcessLapseCategory", targetKey: "processLapseCategory" },
    { key: "companyName", label: "Company Name", type: "text", required: false, targetKey: "companyName" },
    { key: "checkInDate", label: "Check-In Date", type: "date", required: false, targetKey: "checkInDate" },
    { key: "checkOutDate", label: "Check-Out Date", type: "date", required: false, targetKey: "checkOutDate" },
    { key: "internalActionTaken", label: "Internal Action Taken", type: "text", required: false, targetKey: "internalActionTaken" },
    { key: "internalActionTakenCategory", label: "Internal Action Taken Category", type: "select", required: false, optionSource: "InternalActionTakenCategory", targetKey: "internalActionTakenCategory" },
    { key: "createdBy", label: "Created By", type: "text", required: false, targetKey: "createdBy" },
    { key: "updatedBy", label: "Updated By", type: "text", required: false, targetKey: "updatedBy" },
  ].map(Object.freeze)),
  columns: Object.freeze([
    "ID", "OrganizationID", "OrganizationName", "EntryDate", "Status", "ResolvedBy",
    "GuestName", "RoomNumber", "Time", "Complaint", "ServiceRecovery",
    "DetailedInvestigation", "InternalActionTaken", "CompanyName", "Rate",
    "CheckInDate", "CheckOutDate", "UpdatedBy", "GMComment", "ProcessLapse",
    "SRA_Room", "SRA_Food", "SRA_Other", "RaiseSource", "ComplaintSource",
    "AttachmentTitle", "GuestStatus", "ProcessLapseCategory",
    "InternalActionTakenCategory", "GetMetJson", "DepartmentIDs", "ReceivedByIDs",
    "InformedToIDs", "DepartmentHODComments", "CreatedBy", "CreatedDate", "ModifyBy",
    "ModifyDate", "Departments", "ReceivedByUsers", "InformedToUsers",
  ]),
  sortFields: Object.freeze({
    id: "ID", organization: "Hotel", entryDate: "EntryDate", roomNumber: "RoomNumber",
    guestName: "GuestName", status: "Status", rate: "Rate",
    createdDate: "CreatedDate", modifyDate: "ModifyDate",
  }),
  defaultSort: Object.freeze({ field: "entryDate", direction: "DESC" }),
});

const incident = Object.freeze({
  module: "IncidentReport",
  reportType: "incident",
  label: "Incident Report",
  title: "Incident Report",
  runnable: true,
  execution: "incident",
  filters: Object.freeze([
    { key: "search", label: "Search", type: "text", required: false, targetKey: "search" },
    { key: "year", label: "Year", type: "number", required: false, targetKey: "year" },
    { key: "month", label: "Month", type: "number", required: false, targetKey: "month" },
    { key: "fromDate", label: "From Date", type: "date", required: false, targetKey: "fromDate" },
    { key: "toDate", label: "To Date", type: "date", required: false, targetKey: "toDate" },
  ].map(Object.freeze)),
  sortFields: Object.freeze({
    id: "ID", reportDate: "ReportDate", incidentDate: "IncidentDate",
    time: "Time", location: "Location", accidentCause: "AccidentCause",
  }),
  defaultSort: Object.freeze({ field: "reportDate", direction: "DESC" }),
});

const hlpMonthly = Object.freeze({
  module: "HLPReport",
  reportType: "monthly",
  label: "HLP Monthly Report",
  title: "HLP Monthly Report",
  runnable: true,
  execution: "hlpMonthly",
  filters: Object.freeze([
    { key: "organizationId", optionKey: "organization", label: "Organization", type: "organization", required: false, optionSource: "organization", targetKey: "OrganizationID" },
    { key: "year", label: "Year", type: "number", required: true, targetKey: "Year" },
    { key: "month", label: "Month", type: "number", required: true, targetKey: "Month" },
  ].map(Object.freeze)),
});

const hlpLastYear = Object.freeze({
  module: "HLPReport",
  reportType: "last-year-same-day",
  label: "HLP Last Year Same Day Report",
  title: "HLP Last Year Same Day Report",
  runnable: true,
  execution: "hlpLastYear",
  filters: Object.freeze([
    { key: "organizationId", optionKey: "organization", label: "Organization", type: "organization", required: false, optionSource: "organization", targetKey: "OrganizationID" },
    { key: "entryDate", label: "Entry Date", type: "date", required: true, targetKey: "EntryDate" },
  ].map(Object.freeze)),
});

const normalize = (value) => String(value || "").trim().toLowerCase();
const MODULES = Object.freeze({
  guestglitch: Object.freeze({
    module: "GuestGlitch",
    reports: Object.freeze({
      "guest-glitch": guestGlitch,
      "guest-glitch-master": guestGlitchMaster,
    }),
  }),
  incidentreport: Object.freeze({
    module: "IncidentReport",
    reports: Object.freeze({ incident }),
  }),
  hlpreport: Object.freeze({
    module: "HLPReport",
    reports: Object.freeze({
      monthly: hlpMonthly,
      "last-year-same-day": hlpLastYear,
    }),
  }),
});
const getModule = (moduleName) => MODULES[normalize(moduleName)] || null;
const getReport = (moduleName, reportType) => getModule(moduleName)?.reports[normalize(reportType)] || null;
const listReportTypes = (moduleDefinition) => Object.values(moduleDefinition.reports).map(({ reportType, label }) => ({
  key: reportType, label,
}));
const publicConfig = (report) => {
  const compactGuestGlitch = report.execution === "guestGlitchCompact";
  return {
    title: report.title,
    filters: report.filters.map(({ key, label, type, required, filterable }) => ({
      key, label, type, required,
      ...(compactGuestGlitch ? { filterable: Boolean(filterable) } : {}),
    })),
    ...(compactGuestGlitch ? {
      columns: report.columns.map(({ key, label, selectable, sortable }) => ({ key, label, selectable, sortable })),
    } : {}),
  };
};

module.exports = { getModule, getReport, listReportTypes, publicConfig };
