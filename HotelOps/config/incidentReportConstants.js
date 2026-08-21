const EDITABLE_FIELDS = Object.freeze([
  "ReportDate", "IncidentDate", "Time", "Location", "AccidentCause",
  "Anycasualty", "Description", "Damagedcaused", "Investigation",
  "InvestigatedBy", "PresentDuringIncident", "ReportTo", "ReportBy",
]);

const PROTECTED_FIELDS = Object.freeze([
  "OrganizationID", "organizationid", "CreatedDate", "createddate",
  "CreatedBy", "createdby", "ModifyDate", "modifydate", "ModifyBy",
  "modifyby", "IsDeleted", "isdeleted", "UserID", "Username", "IP",
]);

const COLUMN_MAP = Object.freeze({
  ReportDate: "reportdate", IncidentDate: "incidentdate", Time: "time",
  Location: "location", AccidentCause: "accidentcause", Anycasualty: "anycasualty",
  Description: "description", Damagedcaused: "damagedcaused",
  Investigation: "investigation", InvestigatedBy: "investigatedby",
  PresentDuringIncident: "presentduringincident", ReportTo: "reportto", ReportBy: "reportby",
});

const SORT_COLUMNS = Object.freeze({
  ID: "ir.id", ReportDate: "ir.reportdate", IncidentDate: "ir.incidentdate",
  Time: "ir.time", Location: "ir.location", CreatedDate: "ir.createddate",
  ModifyDate: "ir.modifydate",
});

module.exports = { EDITABLE_FIELDS, PROTECTED_FIELDS, COLUMN_MAP, SORT_COLUMNS };
