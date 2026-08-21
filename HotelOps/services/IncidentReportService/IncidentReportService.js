const crypto = require("crypto");
const repository = require("../../repositories/IncidentReportRepository/IncidentReportRepository");
const { compactDTO, detailDTO } = require("../../dto/IncidentReportDTO");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");
const { generateIncidentReportPdf } = require("./IncidentReportPdfService");
const { generateCSV, generateExcel } = require("../../utils/exportHelper");
const { formatDate } = require("../../utils/dateFormatter");

const INCIDENT_EXPORT_COLUMNS = Object.freeze([
  { key: "ID", header: "ID", width: 24 }, { key: "ReportDate", header: "Report Date", width: 16 },
  { key: "IncidentDate", header: "Incident Date", width: 16 }, { key: "Time", header: "Time", width: 12 },
  { key: "Location", header: "Location", width: 28 }, { key: "AccidentCause", header: "Accident Cause", width: 35 },
  { key: "Anycasualty", header: "Any Casualty", width: 18 }, { key: "Description", header: "Description", width: 45 },
  { key: "Damagedcaused", header: "Damage Caused", width: 40 }, { key: "Investigation", header: "Investigation", width: 40 },
  { key: "InvestigatedBy", header: "Investigated By", width: 24 }, { key: "PresentDuringIncident", header: "Present During Incident", width: 30 },
  { key: "ReportTo", header: "Report To", width: 24 }, { key: "ReportBy", header: "Report By", width: 24 },
]);

const fail = (message, statusCode = 400) => ({ success: false, statusCode, message });
const clean = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
const generateID = () => {
  const now = new Date();
  const timestamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"), String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join("");
  return `${timestamp}${String(crypto.randomInt(0, 1000000)).padStart(6, "0")}`;
};

const resolveOrganization = async (userID) => {
  const rows = await repository.resolveOrganizations(userID);
  if (rows.length === 0) return { error: fail("No active organization is assigned to the authenticated user.", 403) };
  if (rows.length > 1) return { error: fail("Multiple organizations are assigned to this user. An organization must be selected before accessing Incident Reports.", 409) };
  return { OrganizationID: Number(rows[0].organizationid), OrganizationName: rows[0].organizationname };
};

const create = async (data) => {
  let client;
  try {
    const organization = await resolveOrganization(data.UserID);
    if (organization.error) return organization.error;
    client = await repository.getClient();
    const prepared = clean(data.Payload);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const id = generateID();
        const result = await repository.insert(client, id, organization.OrganizationID, prepared, data.UserID);
        return { success: true, message: "Incident report created successfully.", data: { ID: result.id } };
      } catch (error) {
        if (error.code !== "23505" || attempt === 2) throw error;
      }
    }
    return fail("Unable to generate a unique Incident Report ID.", 503);
  } catch (error) {
    console.error("Create Incident Report Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to create incident report at this time.", 503);
  } finally { if (client) client.release(); }
};

const get = async (data) => {
  let client;
  try {
    const organization = await resolveOrganization(data.UserID);
    if (organization.error) return organization.error;
    client = await repository.getClient();
    const row = await repository.findByID(client, data.ID, organization.OrganizationID);
    if (!row) return fail("Incident report not found.", 404);
    return { success: true, message: "Incident report retrieved successfully.", data: detailDTO(row) };
  } catch (error) {
    console.error("Get Incident Report Error:", error.message);
    return fail("Unable to retrieve incident report at this time.", 503);
  } finally { if (client) client.release(); }
};

const list = async (data, detailed = false) => {
  try {
    const organization = await resolveOrganization(data.UserID);
    if (organization.error) return organization.error;
    const result = await repository.list(data.Query, organization.OrganizationID, detailed);
    return {
      success: true,
      message: detailed ? "Incident report data retrieved successfully." : "Incident reports retrieved successfully.",
      data: result.rows.map(detailed ? detailDTO : compactDTO),
      pagination: { page: Number(data.Query.page), pageSize: Number(data.Query.pageSize), totalRecords: result.total, totalPages: Math.ceil(result.total / Number(data.Query.pageSize)) },
    };
  } catch (error) {
    console.error("List Incident Report Error:", error.message);
    return fail("Unable to retrieve incident reports at this time.", 503);
  }
};

const update = async (data) => {
  let client;
  try {
    const organization = await resolveOrganization(data.UserID);
    if (organization.error) return organization.error;
    client = await repository.getClient();
    await client.query("BEGIN");
    const current = await repository.findByID(client, data.ID, organization.OrganizationID, true);
    if (!current) { await client.query("ROLLBACK"); return fail("Incident report not found.", 404); }
    await repository.update(client, data.ID, organization.OrganizationID, clean(data.Payload), data.UserID);
    await client.query("COMMIT");
    return { success: true, message: "Incident report updated successfully.", data: { ID: data.ID } };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Update Incident Report Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to update incident report at this time.", 503);
  } finally { if (client) client.release(); }
};

const remove = async (data) => {
  let client;
  try {
    const organization = await resolveOrganization(data.UserID);
    if (organization.error) return organization.error;
    client = await repository.getClient();
    const result = await repository.softDelete(client, data.ID, organization.OrganizationID, data.UserID);
    if (!result) return fail("Incident report not found.", 404);
    return { success: true, message: "Incident report deleted successfully." };
  } catch (error) {
    console.error("Delete Incident Report Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to delete incident report at this time.", 503);
  } finally { if (client) client.release(); }
};

const reportPdf = async (data) => {
  let client;
  try {
    const organization = await resolveOrganization(data.UserID);
    if (organization.error) return organization.error;
    client = await repository.getClient();
    const row = await repository.findByID(client, data.ID, organization.OrganizationID);
    if (!row) return fail("Incident report not found.", 404);
    const detail = { ...detailDTO(row), OrganizationName: organization.OrganizationName };
    const buffer = await generateIncidentReportPdf(detail);
    return { success: true, message: "Incident report PDF generated successfully.", pdfBase64: buffer.toString("base64"), filename: `incident-report-${data.ID}.pdf` };
  } catch (error) {
    console.error("Incident Report PDF Error:", error.message);
    return fail("Unable to generate incident report PDF at this time.", 503);
  } finally { if (client) client.release(); }
};

const exportReport = async (data) => {
  try {
    if (!["csv", "excel"].includes(data.format)) return fail("Invalid Incident Report export format.");
    const organization = await resolveOrganization(data.UserID);
    if (organization.error) return organization.error;
    const result = await repository.list(data.Query, organization.OrganizationID, true, false);
    const rows = result.rows.map(detailDTO);
    const buffer = data.format === "csv"
      ? generateCSV(rows, INCIDENT_EXPORT_COLUMNS)
      : await generateExcel(rows, INCIDENT_EXPORT_COLUMNS, "Incident Report");
    const extension = data.format === "csv" ? "csv" : "xlsx";
    return {
      success: true, message: "Incident Report exported successfully.",
      fileBase64: buffer.toString("base64"),
      contentType: data.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `IncidentReport_Report_${formatDate(new Date(), "YYYY-MM-DD")}.${extension}`,
    };
  } catch (error) {
    console.error("Incident Report Export Error:", error.message);
    return fail("Unable to export Incident Report report at this time.", 503);
  }
};

module.exports = { create, list: (data) => list(data, false), get, update, remove, report: (data) => list(data, true), reportPdf, exportReport, generateID, resolveOrganization };
