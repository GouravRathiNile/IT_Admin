const guestGlitchService = require("../../GuestGlitchService/GuestGlitchService");
const { ReportBuilderValidationError } = require("../ReportQueryBuilder");

const SORT_FIELDS = Object.freeze({
  id: "ID", organization: "Hotel", entryDate: "EntryDate",
  roomNumber: "RoomNumber", guestName: "GuestName", status: "Status", rate: "Rate",
});

const names = (items) => Array.isArray(items)
  ? items.map((item) => item?.Name ?? item?.name ?? item?.FullName ?? item?.fullname)
    .filter(Boolean).join(", ")
  : (items ?? "");

const normalizeRow = (row) => ({
  id: row.ID == null ? null : Number(row.ID),
  organization: row.OrganizationName ?? row.Hotel ?? null,
  entryDate: row.EntryDate ?? null,
  roomNumber: row.RoomNumber ?? null,
  guestName: row.GuestName ?? null,
  departments: names(row.Departments),
  complaint: row.Complaint ?? null,
  processLapse: row.ProcessLapse ?? null,
  serviceRecovery: row.ServiceRecovery ?? null,
  detailedInvestigation: row.DetailedInvestigation ?? null,
  internalActionTaken: row.InternalActionTaken ?? null,
  checkInDate: row.CheckInDate ?? null,
  checkOutDate: row.CheckOutDate ?? null,
  companyName: row.CompanyName ?? null,
  rate: row.Rate == null ? null : Number(row.Rate),
  updatedBy: row.UpdatedBy ?? null,
  receivedBy: names(row.ReceivedByUsers),
  resolvedBy: row.ResolvedBy ?? null,
  gmComment: row.GMComment ?? null,
  status: row.Status ?? null,
});

const validateColumns = (definitions, requested) => {
  if (requested === undefined || requested === null) return definitions;
  if (!Array.isArray(requested) || !requested.length) {
    throw new ReportBuilderValidationError("At least one valid report column is required.");
  }
  const available = new Map(definitions.map((column) => [column.key, column]));
  const seen = new Set();
  return requested.map((key) => {
    if (typeof key !== "string" || !available.has(key) || seen.has(key)) {
      throw new ReportBuilderValidationError(`Invalid report column: ${String(key)}`);
    }
    seen.add(key);
    return available.get(key);
  });
};

const normalizedResult = (response, columns, context = {}) => ({
  title: context.title || "Guest Glitch Report",
  columns: columns.map(({ key, label }) => ({ key, label })),
  rows: (response.data || []).map((source) => {
    const row = normalizeRow(source);
    return Object.fromEntries(columns.map(({ key }) => [key, row[key] ?? null]));
  }),
  metadata: context.metadata || {},
  pagination: response.pagination,
});

const publicResponse = (response, normalized, columns) => ({
  success: true,
  message: "Report generated successfully",
  data: normalized.rows.map((row) => Object.fromEntries(
    columns.map((column) => [column.publicKey, row[column.key] ?? null])
  )),
  pagination: normalized.pagination,
});

const queryFromDefinition = (definition, organizationIDs) => {
  const query = {
    OrganizationIDs: organizationIDs.map(Number),
    page: definition.page ?? 1,
    pageSize: definition.pageSize ?? 10,
    sortBy: definition.sort ? SORT_FIELDS[definition.sort.field] : "EntryDate",
    sortDirection: definition.sort?.direction ?? "DESC",
  };
  for (const filter of definition.filters || []) {
    if (filter.field === "organizationId") query.OrganizationIDs = [Number(filter.value)];
    else if (filter.field === "entryDate" && filter.operator === "greaterThanOrEqual") query.fromDate = filter.value;
    else if (filter.field === "entryDate" && filter.operator === "lessThanOrEqual") query.toDate = filter.value;
    else if (filter.field === "departmentId") query.departmentIds = filter.value.map(Number);
    else if (filter.field === "status") query.statusExact = filter.value;
    else if (filter.field === "complaint") query.complaintEscaped = String(filter.value).replace(/[\\%_]/g, "\\$&");
  }
  return query;
};

const getNormalized = async ({ definition, organizationIDs, columns, selectedColumns, exportOptions }) => {
  const trustedColumns = validateColumns(columns, selectedColumns);
  const response = await guestGlitchService.reportForProvider(
    queryFromDefinition(definition, organizationIDs),
    exportOptions
  );
  if (!response.success) return response;
  const selectedOrganization = (definition.filters || []).find((filter) => filter.field === "organizationId");
  return {
    success: true,
    normalized: normalizedResult(response, trustedColumns, {
      title: "Guest Glitch Report",
      metadata: {
        organizationId: selectedOrganization ? Number(selectedOrganization.value) : null,
      },
    }),
    columns: trustedColumns,
    source: response,
  };
};

const run = async (options) => {
  const result = await getNormalized(options);
  if (!result.success) return result;
  return publicResponse(result.source, result.normalized, result.columns);
};

module.exports = {
  run, getNormalized, queryFromDefinition, normalizeRow, validateColumns, normalizedResult, publicResponse,
};
