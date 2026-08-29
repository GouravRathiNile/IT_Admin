const { EDITABLE_FIELDS } = require("../config/incidentReportConstants");
const { formatDate } = require("../utils/dateFormatter");

const pick = (source, fields) => fields.reduce((result, field) => {
  if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
  return result;
}, {});

const createDTO = (body = {}) => ({ OrganizationID: body.OrganizationID, ...pick(body, EDITABLE_FIELDS) });
const updateDTO = (body = {}) => ({ ID: body.ID ?? body.id, ...pick(body, EDITABLE_FIELDS) });
const listDTO = (query = {}) => ({
  page: query.page ?? 1, pageSize: query.pageSize ?? 10, search: query.search ?? "",
  year: query.year ?? null, month: query.month ?? null,
  fromDate: query.fromDate ?? null, toDate: query.toDate ?? null,
  sortBy: query.sortBy ?? "ReportDate", sortDirection: query.sortDirection ?? "DESC",
});

const publicID = (value) => {
  const text = String(value ?? "");
  const numeric = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(numeric) ? numeric : value;
};

const compactDTO = (row) => ({
  ID: publicID(row.id), Organization: row.organizationshortname ?? null, ReportDate: formatDate(row.reportdate),
  IncidentDate: formatDate(row.incidentdate), Time: row.time, Location: row.location,
  AccidentCause: row.accidentcause, Anycasualty: row.anycasualty,
  Description: row.description, Damagedcaused: row.damagedcaused, Investigation: row.investigation,
  PresentDuringIncident: row.presentduringincident, ReportTo: row.reportto, ReportBy: row.reportby,
});

const detailDTO = (row) => ({
  ...compactDTO(row), InvestigatedBy: row.investigatedby,
  CreatedDate: formatDate(row.createddate, "DD MMM YYYY HH:mm"), CreatedBy: row.createdby,
  ModifyDate: formatDate(row.modifydate, "DD MMM YYYY HH:mm"), ModifyBy: row.modifyby,
});

module.exports = { createDTO, updateDTO, listDTO, compactDTO, detailDTO, publicID };
