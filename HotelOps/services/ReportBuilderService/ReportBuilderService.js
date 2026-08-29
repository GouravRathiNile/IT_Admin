const { pool } = require("../../db");
const guestGlitchRepository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const guestGlitchService = require("../GuestGlitchService/GuestGlitchService");
const guestGlitchValidator = require("../../validators/GuestGlitchValidator");
const { reportListDTO } = require("../../dto/GuestGlitchDTO");
const incidentReportService = require("../IncidentReportService/IncidentReportService");
const { listDTO: incidentListDTO } = require("../../dto/IncidentReportDTO");
const { validateList: validateIncidentList } = require("../../validators/IncidentReportValidator");
const hlpReportService = require("../HLPReportService/HLPReportService");
const registry = require("./ReportRegistry");
const { ReportBuilderValidationError, isRealDate } = require("./ReportQueryBuilder");
const guestGlitchReportProvider = require("./providers/GuestGlitchReportProvider");
const { generateCSV, generateExcel } = require("../../utils/exportHelper");
const { generatePdf } = require("../../utils/pdfHelper");
const { formatDate } = require("../../utils/dateFormatter");

const fail = (message, statusCode = 400) => ({ success: false, statusCode, message });
// Public module/report identifiers must resolve through the immutable registry.
const requireModule = (moduleName) => {
  const moduleDefinition = registry.getModule(moduleName);
  if (!moduleDefinition) throw new ReportBuilderValidationError("Report module not found.", 404);
  return moduleDefinition;
};
const requireReport = (moduleName, reportType) => {
  requireModule(moduleName);
  const report = registry.getReport(moduleName, reportType);
  if (!report) throw new ReportBuilderValidationError("Report type not found.", 404);
  return report;
};
// Resolve the authenticated user's complete active organization boundary once per request.
const resolveAccess = async (userID) => {
  if (!Number.isInteger(Number(userID)) || Number(userID) <= 0) {
    throw new ReportBuilderValidationError("Invalid authenticated user.", 401);
  }
  const mappings = await guestGlitchRepository.resolveOrganizations(Number(userID));
  if (!mappings.length) throw new ReportBuilderValidationError("No active organization is assigned to the authenticated user.", 403);
  return { mappings, organizationIDs: mappings.map((item) => Number(item.organizationid)) };
};
// Convert validation and database exceptions into safe Report API responses.
const execute = async (operation, label) => {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ReportBuilderValidationError) return fail(error.message, error.statusCode);
    console.error(`Report ${label}:`, error.message);
    return fail("Unable to process report request at this time.", 503);
  }
};

// Narrow access only after confirming the requested organization belongs to the user.
const selectOrganizations = (access, requested) => {
  if (requested === undefined || requested === null || requested === "") return access.organizationIDs;
  const organizationID = Number(requested);
  if (!Number.isInteger(organizationID) || organizationID <= 0) {
    throw new ReportBuilderValidationError("Organization ID must be a valid positive number.");
  }
  if (!access.organizationIDs.includes(organizationID)) {
    throw new ReportBuilderValidationError("You are not authorized to access this organization.", 403);
  }
  return [organizationID];
};

// Config, types and options expose registry/master metadata without queue indirection.
const getConfig = (data) => execute(async () => {
  const report = requireReport(data.module, data.reportType);
  await resolveAccess(data.UserID);
  return { success: true, message: "Report configuration fetched successfully", data: registry.publicConfig(report) };
}, "Configuration Error");

const getTypes = (data) => execute(async () => {
  const moduleDefinition = requireModule(data.module);
  await resolveAccess(data.UserID);
  return {
    success: true,
    message: "Report types fetched successfully",
    data: registry.listReportTypes(moduleDefinition),
  };
}, "Types Error");

const getOptions = (data) => execute(async () => {
  const report = requireReport(data.module, data.reportType);
  const optionField = String(data.field || "").trim();
  const filter = report.filters.find((item) => item.key === optionField || item.optionKey === optionField);
  if (!filter?.optionSource) throw new ReportBuilderValidationError("Options are not available for this report field.");
  const access = await resolveAccess(data.UserID);
  const organizationIDs = selectOrganizations(access, data.organizationId);
  let rows;
  if (filter.optionSource === "organization") {
    rows = access.mappings
      .filter((item) => organizationIDs.includes(Number(item.organizationid)))
      .map((item) => ({ value: Number(item.organizationid), label: item.organizationname }));
  } else if (filter.optionSource === "department") {
    const result = await pool.query(
      `SELECT dm.departmentid AS value, dm.departmentname AS label, dm.organizationid
       FROM department_master dm
       WHERE dm.organizationid = ANY($1::bigint[]) AND dm.isdeleted = FALSE
       ORDER BY dm.organizationid, dm.departmentname;`, [organizationIDs]
    );
    rows = result.rows.map((item) => ({ value: Number(item.value), label: item.label }));
  } else if (filter.optionSource === "user") {
    const result = await pool.query(
      `SELECT DISTINCT um.userid AS value, COALESCE(um.fullname, um.username) AS label, uom.organizationid
       FROM user_master um
       INNER JOIN user_org_mapping uom ON uom.userid = um.userid
       WHERE uom.organizationid = ANY($1::bigint[])
         AND uom.isactive = TRUE AND uom.isdeleted = FALSE
         AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
       ORDER BY uom.organizationid, label;`, [organizationIDs]
    );
    rows = result.rows.map((item) => ({
      value: Number(item.value), label: item.label, organizationId: Number(item.organizationid),
    }));
  } else {
    const result = await pool.query(
      `SELECT optionvalue AS value, displayname AS label, organizationid
       FROM guest_glitch_option_master
       WHERE organizationid = ANY($1::bigint[]) AND optiontype = $2
         AND isactive = TRUE AND isdeleted = FALSE
       ORDER BY organizationid, sortorder, displayname;`, [organizationIDs, filter.optionSource]
    );
    rows = result.rows.map((item) => ({
      value: item.value, label: item.label, organizationId: Number(item.organizationid),
    }));
  }
  return { success: true, message: "Report filter options fetched successfully", data: rows };
}, "Options Error");

// Translate the simple public Guest Glitch contract into trusted internal filters.
const translateRequest = (report, body, access) => {
  const filters = body.filters === undefined ? {} : body.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new ReportBuilderValidationError("Filters must be an object.");
  }
  const supported = new Map(report.filters.map((item) => [item.key, item]));
  for (const key of Object.keys(filters)) {
    if (!supported.has(key)) throw new ReportBuilderValidationError(`Invalid report filter: ${key}`);
  }
  const translated = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    const definition = supported.get(key);
    if (["organization", "department"].includes(definition.type)) {
      if (!Number.isInteger(Number(value)) || Number(value) <= 0) {
        throw new ReportBuilderValidationError(`${definition.label} must be a valid positive number.`);
      }
    } else if (definition.type === "date" && !isRealDate(value)) {
      throw new ReportBuilderValidationError(`Please provide a valid date for ${definition.label}.`);
    } else if (["select", "text"].includes(definition.type) && (typeof value !== "string" || !value.trim())) {
      throw new ReportBuilderValidationError(`Please provide a valid value for ${definition.label}.`);
    }
    translated.push({
      field: definition.engineField, operator: definition.operator,
      value: definition.wrapArray ? [Number(value)] : value,
    });
  }
  if (filters.organizationId !== undefined && filters.organizationId !== null && filters.organizationId !== "") {
    selectOrganizations(access, filters.organizationId);
  }
  if (filters.fromDate && filters.toDate && String(filters.fromDate) > String(filters.toDate)) {
    throw new ReportBuilderValidationError("From Date must not be after To Date.");
  }
  const page = body.page === undefined ? 1 : Number(body.page);
  const pageSize = body.pageSize === undefined ? 10 : Number(body.pageSize);
  if (!Number.isInteger(page) || page < 1) throw new ReportBuilderValidationError("Page must be a positive integer.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ReportBuilderValidationError("Page size must be between 1 and 100.");
  }
  let sort = null;
  if (body.sort !== undefined && body.sort !== null) {
    if (typeof body.sort !== "object" || Array.isArray(body.sort)) throw new ReportBuilderValidationError("Sort must be an object.");
    const field = String(body.sort.field || "").trim();
    if (!report.sortFields[field]) throw new ReportBuilderValidationError(`Invalid report sort field: ${field || "unknown"}`);
    const direction = String(body.sort.direction || "").toUpperCase();
    if (!["ASC", "DESC"].includes(direction)) throw new ReportBuilderValidationError("Sort direction must be ASC or DESC.");
    sort = { field, direction };
  }
  return { filters: translated, sort, page, pageSize };
};

// Apply the registered Master Report filter/sort allowlists.
const translateMasterRequest = (report, body, access) => {
  const filters = body.filters === undefined ? {} : body.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new ReportBuilderValidationError("Filters must be an object.");
  }
  const definitions = new Map(report.filters.map((item) => [item.key, item]));
  const queryInput = {};
  for (const [key, value] of Object.entries(filters)) {
    const definition = definitions.get(key);
    if (!definition) throw new ReportBuilderValidationError(`Invalid report filter: ${key}`);
    if (value === undefined || value === null || value === "") continue;
    if (["organization", "department", "user"].includes(definition.type)) {
      if (!Number.isInteger(Number(value)) || Number(value) <= 0) {
        throw new ReportBuilderValidationError(`${definition.label} must be a valid positive number.`);
      }
    } else if (definition.type === "date" && !isRealDate(value)) {
      throw new ReportBuilderValidationError(`Please provide a valid date for ${definition.label}.`);
    } else if (["select", "text"].includes(definition.type) && (typeof value !== "string" || !value.trim())) {
      throw new ReportBuilderValidationError(`Please provide a valid value for ${definition.label}.`);
    }
    queryInput[definition.targetKey] = definition.wrapArray ? [Number(value)] : value;
  }
  if (filters.organizationId !== undefined && filters.organizationId !== null && filters.organizationId !== "") {
    selectOrganizations(access, filters.organizationId);
  }
  if (filters.fromDate && filters.toDate && String(filters.fromDate) > String(filters.toDate)) {
    throw new ReportBuilderValidationError("From Date must not be after To Date.");
  }
  if (body.sort !== undefined && body.sort !== null) {
    if (typeof body.sort !== "object" || Array.isArray(body.sort)) throw new ReportBuilderValidationError("Sort must be an object.");
    const field = String(body.sort.field || "").trim();
    const sortBy = report.sortFields[field];
    if (!sortBy) throw new ReportBuilderValidationError(`Invalid report sort field: ${field || "unknown"}`);
    const direction = String(body.sort.direction || "").toUpperCase();
    if (!["ASC", "DESC"].includes(direction)) throw new ReportBuilderValidationError("Sort direction must be ASC or DESC.");
    queryInput.sortBy = sortBy;
    queryInput.sortDirection = direction;
  } else {
    queryInput.sortBy = report.sortFields[report.defaultSort.field];
    queryInput.sortDirection = report.defaultSort.direction;
  }
  queryInput.page = body.page ?? 1;
  queryInput.pageSize = body.pageSize ?? 10;
  const query = reportListDTO(queryInput);
  const errors = guestGlitchValidator.validateReportList(query);
  if (errors.length) throw new ReportBuilderValidationError(errors[0].message);
  return query;
};

const getBodyParts = (report, body = {}) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ReportBuilderValidationError("Request body must be an object.");
  }
  const filters = body.filters === undefined ? {} : body.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new ReportBuilderValidationError("Filters must be an object.");
  }
  const definitions = new Map(report.filters.map((item) => [item.key, item]));
  for (const key of Object.keys(filters)) {
    if (!definitions.has(key)) throw new ReportBuilderValidationError(`Invalid report filter: ${key}`);
  }
  for (const definition of report.filters) {
    const value = filters[definition.key];
    if (definition.required && (value === undefined || value === null || String(value).trim() === "")) {
      throw new ReportBuilderValidationError(`${definition.label} is required.`);
    }
  }
  const page = body.page ?? 1;
  const pageSize = body.pageSize ?? 10;
  if (!/^\d+$/.test(String(page)) || Number(page) < 1) {
    throw new ReportBuilderValidationError("Page must be a positive integer.");
  }
  if (!/^\d+$/.test(String(pageSize)) || Number(pageSize) < 1 || Number(pageSize) > 100) {
    throw new ReportBuilderValidationError("Page size must be between 1 and 100.");
  }
  return { filters, definitions, page: Number(page), pageSize: Number(pageSize) };
};

// Reuse Incident DTO/validation semantics instead of duplicating report SQL rules.
const translateIncidentRequest = (report, body) => {
  const { filters, page, pageSize } = getBodyParts(report, body);
  const queryInput = { ...filters, page, pageSize };
  if (body.sort !== undefined && body.sort !== null) {
    if (typeof body.sort !== "object" || Array.isArray(body.sort)) {
      throw new ReportBuilderValidationError("Sort must be an object.");
    }
    const field = String(body.sort.field || "").trim();
    if (!report.sortFields[field]) throw new ReportBuilderValidationError(`Invalid report sort field: ${field || "unknown"}`);
    const direction = String(body.sort.direction || "").toUpperCase();
    if (!["ASC", "DESC"].includes(direction)) throw new ReportBuilderValidationError("Sort direction must be ASC or DESC.");
    queryInput.sortBy = report.sortFields[field];
    queryInput.sortDirection = direction;
  } else {
    queryInput.sortBy = report.sortFields[report.defaultSort.field];
    queryInput.sortDirection = report.defaultSort.direction;
  }
  const query = incidentListDTO(queryInput);
  const errors = validateIncidentList(query);
  if (errors.length) throw new ReportBuilderValidationError(errors[0].message);
  return query;
};

// Adapt registered HLP filters to the existing monthly/exact-date service contracts.
const translateHLPRequest = (report, body, access) => {
  const { filters, definitions, page, pageSize } = getBodyParts(report, body);
  if (body.sort !== undefined && body.sort !== null) {
    throw new ReportBuilderValidationError("Sorting is not supported for this report.");
  }
  const query = { OrganizationIDs: access.organizationIDs };
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const definition = definitions.get(key);
    if (definition.type === "organization") {
      query[definition.targetKey] = selectOrganizations(access, value)[0];
    } else if (definition.type === "date") {
      if (!isRealDate(value)) throw new ReportBuilderValidationError(`Please provide a valid date for ${definition.label}.`);
      query[definition.targetKey] = value;
    } else if (definition.type === "number") {
      if (!/^\d+$/.test(String(value))) throw new ReportBuilderValidationError(`${definition.label} must be a valid number.`);
      query[definition.targetKey] = Number(value);
    }
  }
  return { query, page, pageSize };
};

const paginateRows = (rows, page, pageSize) => {
  const totalRecords = rows.length;
  const offset = (page - 1) * pageSize;
  return {
    data: rows.slice(offset, offset + pageSize),
    pagination: { page, pageSize, totalRecords, totalPages: Math.ceil(totalRecords / pageSize) },
  };
};

// Dispatch execution to existing module services/providers selected by registry metadata.
const run = (data) => execute(async () => {
  const report = requireReport(data.module, data.reportType);
  const access = await resolveAccess(data.UserID);
  if (report.execution === "guestGlitchMaster") {
    const query = translateMasterRequest(report, data.body || {}, access);
    return guestGlitchService.masterReport({ ...query, UserID: Number(data.UserID) });
  }
  if (report.execution === "incident") {
    const query = translateIncidentRequest(report, data.body || {});
    return incidentReportService.report({ UserID: Number(data.UserID), Query: query });
  }
  if (report.execution === "hlpMonthly") {
    const translated = translateHLPRequest(report, data.body || {}, access);
    const response = await hlpReportService.getMonthlyReport(translated.query);
    if (!response.success) return response;
    const result = paginateRows(response.data || [], translated.page, translated.pageSize);
    return { success: true, message: response.message, ...result };
  }
  if (report.execution === "hlpLastYear") {
    const translated = translateHLPRequest(report, data.body || {}, access);
    const response = await hlpReportService.getLastYearReport(translated.query);
    if (!response.success) return response;
    const details = response.data?.Details || [];
    const rows = details.map((item) => ({
      ReportID: response.data.ID,
      EntryDate: response.data.EntryDate,
      MasterID: item.MasterID == null ? null : Number(item.MasterID),
      Title: item.Title ?? null,
      YOD: item.YOD ?? null,
      LYOD: item.LYOD ?? null,
    }));
    const result = paginateRows(rows, translated.page, translated.pageSize);
    return { success: true, message: response.message, ...result };
  }
  if (report.execution === "guestGlitchCompact") {
    const definition = translateRequest(report, data.body || {}, access);
    return guestGlitchReportProvider.run({
      definition, organizationIDs: access.organizationIDs, columns: report.columns,
    });
  }
  throw new ReportBuilderValidationError("Report execution is not configured.");
}, "Run Error");

// Export uses the normalized Guest Glitch provider result for every output format.
const exportReport = (data) => execute(async () => {
  const report = requireReport(data.module, data.reportType);
  if (report.execution !== "guestGlitchCompact" || !report.export) {
    throw new ReportBuilderValidationError("Export is not available for this report type.");
  }
  const body = data.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ReportBuilderValidationError("Export request body must be an object.");
  }
  const format = typeof body.format === "string" ? body.format.trim().toLowerCase() : "";
  if (!report.export.formats.includes(format)) {
    throw new ReportBuilderValidationError("Export format must be csv, excel, or pdf.");
  }
  const access = await resolveAccess(data.UserID);
  const definition = translateRequest(report, body, access);
  const maxRows = format === "pdf" ? report.export.pdfMaxRows : report.export.maxRows;
  const result = await guestGlitchReportProvider.getNormalized({
    definition,
    organizationIDs: access.organizationIDs,
    columns: report.columns,
    selectedColumns: body.columns,
    exportOptions: { paginate: false, maxRows },
  });
  if (!result.success) return result;

  const normalized = result.normalized;
  const renderColumns = normalized.columns.map((column) => ({
    key: column.key, header: column.label, width: 20,
  }));
  let buffer;
  let contentType;
  let extension;
  if (format === "csv") {
    buffer = generateCSV(normalized.rows, renderColumns);
    contentType = "text/csv; charset=utf-8";
    extension = "csv";
  } else if (format === "excel") {
    buffer = await generateExcel(normalized.rows, renderColumns, "Guest Glitch Report");
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    extension = "xlsx";
  } else {
    buffer = await generatePdf({
      title: normalized.title,
      reportName: normalized.title,
      organizationId: normalized.metadata.organizationId,
      orientation: report.export.orientation,
      columns: normalized.columns.map((column) => ({
        key: column.key, header: column.label, align: column.key === "rate" ? "right" : "left",
      })),
      rows: normalized.rows,
    });
    contentType = "application/pdf";
    extension = "pdf";
  }
  return {
    success: true,
    message: "Report exported successfully",
    fileBase64: buffer.toString("base64"),
    contentType,
    filename: `${report.export.filename}_${formatDate(new Date(), "YYYY-MM-DD")}.${extension}`,
  };
}, "Export Error");

module.exports = {
  getTypes, getConfig, getOptions, run, exportReport, resolveAccess, translateRequest, translateMasterRequest,
  translateIncidentRequest, translateHLPRequest, paginateRows,
};
