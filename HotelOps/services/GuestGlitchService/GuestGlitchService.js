const repository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const { OPTION_TYPES } = require("../../config/guestGlitchConstants");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");
// const { compactReportDTO, completeReportDTO, listResponseDTO, } = require("../../dto/GuestGlitchReportDTO");
const {
  createDTO,
  updateDTO,
  listDTO,
  reportListDTO,
  listResponseDTO,
  completeReportDTO,
  compactReportDTO,
  formatGuestGlitchDates,
} = require("../../dto/GuestGlitchDTO");
const { generatePdf } = require("../../utils/pdfHelper");
const generateAttachmentUrl = require("../../AzurConfigration/GuestGlitch/AzureGetData");
const { generateCSV, generateExcel } = require("../../utils/exportHelper");
const { formatDate } = require("../../utils/dateFormatter");

const GUEST_GLITCH_EXPORT_COLUMNS = Object.freeze([
  { key: "ID", header: "ID", width: 12 }, { key: "OrganizationName", header: "Organization", width: 24 },
  { key: "EntryDate", header: "Entry Date", width: 16 }, { key: "Time", header: "Time", width: 12 },
  { key: "RoomNumber", header: "Room Number", width: 14 }, { key: "GuestName", header: "Guest Name", width: 22 },
  { key: "GuestStatus", header: "Guest Status", width: 16 }, { key: "Departments", header: "Departments", width: 28 },
  { key: "ReceivedByUsers", header: "Received By", width: 25 }, { key: "InformedToUsers", header: "Informed To", width: 25 },
  { key: "Complaint", header: "Complaint", width: 40 }, { key: "Status", header: "Status", width: 16 },
  { key: "ComplaintSource", header: "Complaint Source", width: 18 }, { key: "RaiseSource", header: "Raise Source", width: 18 },
  { key: "ProcessLapse", header: "Process Lapse", width: 35 }, { key: "ProcessLapseCategory", header: "Process Lapse Category", width: 24 },
  { key: "ServiceRecovery", header: "Service Recovery", width: 40 }, { key: "InternalActionTaken", header: "Internal Action Taken", width: 40 },
  { key: "InternalActionTakenCategory", header: "Internal Action Category", width: 26 },
  { key: "CompanyName", header: "Company Name", width: 22 }, { key: "Rate", header: "Rate", width: 14 },
  { key: "CheckInDate", header: "Check In Date", width: 16 }, { key: "CheckOutDate", header: "Check Out Date", width: 16 },
  { key: "ResolvedBy", header: "Resolved By", width: 22 }, { key: "UpdatedBy", header: "Updated By", width: 22 },
  { key: "GMComment", header: "GM Comment", width: 35 },
]);
const guestPdfItems = (data, fields) => fields.map(([label, key]) => ({ label, value: data[key] }));
const GUEST_GLITCH_PDF_SECTIONS = Object.freeze([
  { title: "Hotel and Guest", fields: [["Hotel", "Hotel"], ["Entry Date", "EntryDate"], ["Room", "RoomNumber"], ["Guest", "GuestName"], ["Guest Status", "GuestStatus"], ["Company", "CompanyName"], ["Rate", "Rate"], ["Check In", "CheckInDate"], ["Check Out", "CheckOutDate"]] },
  { title: "Complaint and Follow-up", fields: [["Complaint", "Complaint"], ["Complaint Source", "ComplaintSource"], ["Raise Source", "RaiseSource"], ["Departments", "Departments"], ["Received By", "ReceivedByUsers"], ["Informed To", "InformedToUsers"], ["Process Lapse", "ProcessLapse"], ["Service Recovery", "ServiceRecovery"], ["Detailed Investigation", "DetailedInvestigation"], ["Internal Action", "InternalActionTaken"]] },
  { title: "Workflow", fields: [["Status", "Status"], ["Resolved By", "ResolvedBy"], ["GM Comment", "GMComment"], ["HOD Comments", "DepartmentHODComments"]] },
  { title: "Audit and Attachment", fields: [["Created By", "CreatedBy"], ["Created Date", "CreatedDate"], ["Modified By", "ModifyBy"], ["Modified Date", "ModifyDate"], ["Attachment", "Attachment"]] },
]);

const fail = (message, statusCode = 400, errors) => ({ success: false, statusCode, message, ...(errors ? { errors } : {}) });
const cleanText = (value) => value == null ? null : String(value).trim();
const canonical = (value) => {
  if (Array.isArray(value)) return JSON.stringify([...value].sort((a, b) => {
    const left = typeof a === "object" ? Number(a.departmentId) : Number(a);
    const right = typeof b === "object" ? Number(b.departmentId) : Number(b);
    return left - right;
  }));
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value == null || value === "") return null;
  return String(value);
};

const mergeDepartmentComments = (existing = [], supplied = [], user = {}) => {
  const comments = new Map(existing.map((item) => [Number(item.departmentId), {
    ...item, departmentId: Number(item.departmentId), comment: String(item.comment || "").trim(),
  }]));
  for (const item of supplied) {
    comments.set(Number(item.departmentId), {
      departmentId: Number(item.departmentId), comment: String(item.comment || "").trim(),
      commentedBy: user.Username || null, commentedByUserID: user.UserID || null,
    });
  }
  return [...comments.values()].filter((item) => item.comment);
};

const resolveOrganization = async (userID, allowMultiple = false) => {
  const rows = await repository.resolveOrganizations(userID);
  if (rows.length === 0) return { error: fail("No active organization is assigned to the authenticated user.", 403) };
  if (rows.length > 1 && !allowMultiple) return { error: fail("Multiple organizations are assigned to this user. An organization must be selected before accessing Guest Glitch.", 409) };
  const organizationIDs = rows.map((row) => Number(row.organizationid));
  return { OrganizationID: organizationIDs.length === 1 ? organizationIDs[0] : null, OrganizationIDs: organizationIDs,
    UserType: String(rows[0].usertype || "").trim(), DepartmentID: rows[0].departmentid == null ? null : Number(rows[0].departmentid) };
};

const withOrganization = (operation, allowMultiple = false) => async (data) => {
  try {
    const organization = await resolveOrganization(data.UserID, allowMultiple);
    if (organization.error) return organization.error;
    return operation({ ...data, ...organization });
  } catch (error) {
    console.error("Guest Glitch Organization Resolution Error:", error.message);
    return fail("Unable to resolve organization for Guest Glitch at this time.", 503);
  }
};

const mapRow = (row) => ({
  ID: Number(row.id), OrganizationID: Number(row.organizationid), EntryDate: row.entrydate,
  CurrentWorkflowStage: row.currentworkflowstage,
  Status: row.status, ResolvedBy: row.resolvedby, GuestName: row.guestname,
  RoomNumber: row.roomnumber, Time: row.time, Complaint: row.complaint,
  ServiceRecovery: row.servicerecovery, DetailedInvestigation: row.detailedinvestigation,
  InternalActionTaken: row.internalactiontaken, CompanyName: row.companyname,
  Rate: row.rate == null ? null : Number(row.rate), CheckInDate: row.checkindate,
  CheckOutDate: row.checkoutdate, UpdatedBy: row.updatedby, GMComment: row.gmcomment,
  ProcessLapse: row.processlapse, SRA_Room: row.sra_room == null ? null : Number(row.sra_room),
  SRA_Food: row.sra_food == null ? null : Number(row.sra_food),
  SRA_Other: row.sra_other == null ? null : Number(row.sra_other), RaiseSource: row.raisesource,
  ComplaintSource: row.complaintsource, AttachmentTitle: row.attachmenttitle,
  Attachment: row.attachment, GuestStatus: row.gueststatus,
  ProcessLapseCategory: row.processlapsecategory,
  InternalActionTakenCategory: row.internalactiontakencategory,
  GetMetJson: row.getmetjson, DepartmentIDs: row.departmentids || [],
  ReceivedByIDs: row.receivedbyids || [], InformedToIDs: row.informedtoids || [],
  DepartmentHODComments: row.departmenthodcomments || [], CreatedDate: row.createddate,
  ModifyDate: row.modifydate,
});

const ensureOwnedRecord = async (client, id, organizationID, lock = false) => {
  const record = await repository.findByID(client, id, organizationID, false, lock);
  return record
    ? { record }
    : { error: fail("Guest Glitch not found", 404) };
};

const validateSelections = async (client, data, organizationID) => {
  const departments = await repository.validateDepartments(client, organizationID, data.DepartmentIDs || []);
  if (departments.length !== (data.DepartmentIDs || []).length) {
    const valid = new Set(departments.map((item) => Number(item.departmentid)));
    const invalidID = (data.DepartmentIDs || []).find((id) => !valid.has(Number(id)));
    return { error: fail(`Invalid Department ID: ${invalidID}`) };
  }
  const receivedUsers = await repository.validateUsers(client, organizationID, data.ReceivedByIDs || []);
  if (receivedUsers.length !== (data.ReceivedByIDs || []).length) {
    const valid = new Set(receivedUsers.map((item) => Number(item.userid)));
    const invalidID = (data.ReceivedByIDs || []).find((id) => !valid.has(Number(id)));
    return { error: fail(`ReceivedBy user ID ${invalidID} is invalid, inactive, or unavailable for this organization`) };
  }
  const informedUsers = await repository.validateUsers(client, organizationID, data.InformedToIDs || []);
  if (informedUsers.length !== (data.InformedToIDs || []).length) {
    const valid = new Set(informedUsers.map((item) => Number(item.userid)));
    const invalidID = (data.InformedToIDs || []).find((id) => !valid.has(Number(id)));
    return { error: fail(`InformedTo user ID ${invalidID} is invalid, inactive, or unavailable for this organization`) };
  }
  const resolvedUsers = await repository.validateUsers(
    client,
    organizationID,
    data.ResolvedBy ? [data.ResolvedBy] : []
  );

  if (
    data.ResolvedBy &&
    resolvedUsers.length !== 1
  ) {
    return {
      error: fail(
        `ResolvedBy user ID ${data.ResolvedBy} is invalid, inactive, or unavailable for this organization`
      ),
    };
  }
  const selected = new Set((data.DepartmentIDs || []).map(Number));
  if ((data.DepartmentHODComments || []).some((item) => !selected.has(Number(item.departmentId)))) {
    return { error: fail("Department HOD comment can only be added for a selected department") };
  }
  return { departments, receivedUsers, informedUsers, resolvedUsers, };
};

const validateOptions = async (client, data, organizationID) => {
  const fields = ["Status", "GuestStatus", "ComplaintSource", "RaiseSource", "ProcessLapseCategory", "InternalActionTakenCategory"];
  for (const field of fields) {
    if (data[field] != null && String(data[field]).trim()) {
      const option = await repository.findOption(client, organizationID, field, String(data[field]).trim());
      if (!option) return fail(`The selected ${field} is invalid or inactive.`);
    }
  }
  return null;
};

const applySnapshots = (data, selections) => ({
  ...data,
  Department: selections.departments.map((item) => item.departmentname).join(", "),
  ReceivedBy: selections.receivedUsers.map((item) => item.fullname).join(", "),
  InformedTo: selections.informedUsers.map((item) => item.fullname).join(", "),
  ResolvedBy: selections.resolvedUsers.map((item) => item.fullname).join(", "),
});

const create = async (data) => {
  const client = await repository.getClient();
  try {
    await client.query("BEGIN");
    const firstStage = await repository.getFirstWorkflowStage(client, data.OrganizationID);
    if (!firstStage) { await client.query("ROLLBACK"); return fail("Guest Glitch workflow configuration is not available for this organization.", 409); }
    data.CurrentWorkflowStage = firstStage.stagekey;
    data.Status = cleanText(data.Status) || "Open";
    const selections = await validateSelections(client, data, data.OrganizationID);
    if (selections.error) { await client.query("ROLLBACK"); return selections.error; }
    const optionError = await validateOptions(client, data, data.OrganizationID);
    if (optionError) { await client.query("ROLLBACK"); return optionError; }
    const prepared = applySnapshots(data, selections);
    const result = await repository.insert(client, prepared);
    await client.query("COMMIT");
    return { success: true, message: "Guest Glitch created successfully", data: { ID: Number(result.id) } };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create Guest Glitch Error:", error.message);
    const retry = retryableDatabaseResponse(error);
    return retry || fail("Unable to create guest glitch at this time.", 503);
  } finally { client.release(); }
};

// const list = async (data) => {
//   try {
//     const result = await repository.list(data, data.OrganizationID);
//     return {
//       success: true, message: "Guest Glitches fetched successfully",
//       data: result.rows.map(mapRow),
//       pagination: { page: Number(data.page), pageSize: Number(data.pageSize), totalRecords: result.total, totalPages: Math.ceil(result.total / Number(data.pageSize)) },
//     };
//   } catch (error) {
//     console.error("List Guest Glitch Error:", error.message);
//     return fail("Unable to retrieve guest glitches at this time.", 503);
//   }
// };

const list = async (data) => {
  const client = await repository.getClient();

  try {
    const result = await repository.list(
      data,
      data.OrganizationIDs || data.OrganizationID
    );

    let resolvedSelections = [];

    if (result.rows.length > 0) {
      resolvedSelections = (await resolveReportRows(client, result.rows)).map((item) => item.resolved);
    }

    const mapped = result.rows.map((row, index) =>
      listResponseDTO(
        row,
        resolvedSelections[index] || {
          departments: [],
        }
      )
    );

    return {
      success: true,
      message: "Guest Glitches fetched successfully",
      data: mapped,
      pagination: {
        page: Number(data.page),
        pageSize: Number(data.pageSize),
        totalRecords: result.total,
        totalPages: Math.ceil(
          result.total / Number(data.pageSize)
        ),
      },
    };
  } catch (error) {
    console.error("========== LIST GUEST GLITCH ERROR ==========");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    console.error("Full Error:", error);
    console.error("==============================================");

    return fail(
      "Unable to retrieve guest glitches at this time.",
      503
    );

  } finally {
    client.release();
  }
};

const get = async (data) => {
  const client = await repository.getClient();
  try {
    const found = await ensureOwnedRecord(client, data.ID, data.OrganizationIDs || data.OrganizationID);
    if (found.error) return found.error;
    const row = found.record;
    const recordOrganizationID = Number(row.organizationid);
    const workflow = await resolveWorkflowAccess(client, row, data, "VIEW");
    if (workflow.error) return workflow.error;
    const [departments, receivedUsers, informedUsers] = await Promise.all([
      repository.validateDepartments(client, recordOrganizationID, row.departmentids || []),
      repository.validateUsers(client, recordOrganizationID, row.receivedbyids || []),
      repository.validateUsers(client, recordOrganizationID, row.informedtoids || []),
    ]);
    return {
      success: true, message: "Guest glitch retrieved successfully.", data: {
      ...formatGuestGlitchDates(mapRow(row)),
        workflow: workflowDTO(workflow.access),
        DepartmentHODComments: (row.departmenthodcomments || []).map((item) => ({ ...item,
          departmentId: Number(item.departmentId),
          departmentName: departments.find((department) => Number(department.departmentid) === Number(item.departmentId))?.departmentname || null,
        })),
        departments: departments.map((item) => ({ id: Number(item.departmentid), name: item.departmentname })),
        receivedByUsers: receivedUsers.map((item) => ({ id: Number(item.userid), name: item.fullname })),
        informedToUsers: informedUsers.map((item) => ({ id: Number(item.userid), name: item.fullname })),
      }
    };
  } catch (error) {
    console.error("Get Guest Glitch Error:", error.message);
    return fail("Unable to retrieve guest glitch at this time.", 503);
  } finally { client.release(); }
};

const update = async (data) => {
  const client = await repository.getClient();
  try {
    await client.query("BEGIN");
    const found = await ensureOwnedRecord(client, data.ID, data.OrganizationID, true);
    if (found.error) { await client.query("ROLLBACK"); return found.error; }
    const workflow = await resolveWorkflowAccess(client, found.record, data, "UPDATE");
    if (workflow.error) { await client.query("ROLLBACK"); return workflow.error; }
    const current = mapRow(found.record);
    const allowedFields = new Set(workflow.access.editablefields || []);
    for (const field of Object.keys(data)) {
      if (repository.COLUMN_MAP[field] && field !== "CurrentWorkflowStage" &&
          canonical(data[field]) !== canonical(current[field]) &&
          (workflow.access.canedit !== true || !allowedFields.has(field))) {
        delete data[field];
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "DepartmentHODComments")) {
      data.DepartmentHODComments = mergeDepartmentComments(current.DepartmentHODComments, data.DepartmentHODComments, data);
    }
    const merged = { ...current, ...data };
    if (Object.prototype.hasOwnProperty.call(data, "DepartmentIDs") && !Object.prototype.hasOwnProperty.call(data, "DepartmentHODComments")) {
      const selected = new Set(data.DepartmentIDs.map(Number));
      merged.DepartmentHODComments = (current.DepartmentHODComments || []).filter((item) => selected.has(Number(item.departmentId)));
      data.DepartmentHODComments = merged.DepartmentHODComments;
    }
    const selections = await validateSelections(client, merged, data.OrganizationID);
    if (selections.error) { await client.query("ROLLBACK"); return selections.error; }
    const optionError = await validateOptions(client, data, data.OrganizationID);
    if (optionError) { await client.query("ROLLBACK"); return optionError; }
    const prepared = applySnapshots(data, selections);
    const changed = {};
    for (const [field, value] of Object.entries(prepared)) {
      if (repository.COLUMN_MAP[field] && canonical(value) !== canonical(current[field])) changed[field] = value;
    }
    if (String(data.WorkflowAction || "").toUpperCase() === "PROCEED") {
      if (workflow.access.canproceed !== true) { await client.query("ROLLBACK"); return fail("You are not authorized to proceed this Guest Glitch workflow.", 403); }
      const resulting = { ...current, ...changed };
      const missing = (workflow.access.requiredactionfields || []).find((field) => {
        const value = resulting[field];
        return value == null || value === "" || (Array.isArray(value) && value.length === 0);
      });
      if (missing) { await client.query("ROLLBACK"); return fail(`${missing} is required before proceeding to the next workflow stage.`); }
      if (!workflow.access.isfinalstage && !workflow.access.nextstage) { await client.query("ROLLBACK"); return fail("The next Guest Glitch workflow stage is not configured.", 409); }
      if (!workflow.access.isfinalstage) changed.CurrentWorkflowStage = workflow.access.nextstage;
    }
    if (!Object.keys(changed).length) {
      await client.query("ROLLBACK");
      if (String(data.WorkflowAction || "").toUpperCase() === "PROCEED" && workflow.access.isfinalstage) {
        return { success: true, message: "Guest Glitch workflow is complete.", data: { ID: Number(data.ID), CurrentWorkflowStage: current.CurrentWorkflowStage } };
      }
      return { success: true, message: "No changes were detected.", data: { ID: Number(data.ID) } };
    }
    await repository.updateChangedFields(client, data.ID, data.OrganizationID, changed, data.UserID, data.Username, data.IP);
    await client.query("COMMIT");
    return { success: true, message: "Guest glitch updated successfully.", data: { ID: Number(data.ID), CurrentWorkflowStage: changed.CurrentWorkflowStage || current.CurrentWorkflowStage } };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update Guest Glitch Error:", error.message);
    const retry = retryableDatabaseResponse(error);
    return retry || fail("Unable to update guest glitch at this time.", 503);
  } finally { client.release(); }
};

const updateStatus = async (data) => {
  return update(data);
};

const remove = async (data) => {
  const client = await repository.getClient();
  try {
    await client.query("BEGIN");
    const found = await ensureOwnedRecord(client, data.ID, data.OrganizationID, true);
    if (found.error) { await client.query("ROLLBACK"); return found.error; }
    await repository.softDelete(client, data.ID, data.OrganizationID, data.UserID, data.IP);
    await client.query("COMMIT");
    return { success: true, message: "Guest glitch deleted successfully." };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete Guest Glitch Error:", error.message);
    const retry = retryableDatabaseResponse(error);
    return retry || fail("Unable to delete guest glitch at this time.", 503);
  } finally { client.release(); }
};

const listOptions = async (data) => {
  try {
    if (data.OptionType && !OPTION_TYPES.includes(data.OptionType)) return fail("Invalid Guest Glitch option type.");
    const rows = await repository.listOptions(data.OrganizationID, data.OptionType || null);
    return {
      success: true, message: "Guest Glitch options retrieved successfully.", data: rows.map((row) => ({
        OptionID: Number(row.optionid), OptionType: row.optiontype, OptionValue: row.optionvalue,
        DisplayName: row.displayname, Metadata: row.metadata || {}, SortOrder: row.sortorder,
      }))
    };
  } catch (error) {
    console.error("List Guest Glitch Options Error:", error.message);
    return fail("Unable to retrieve Guest Glitch options at this time.", 503);
  }
};

const upsertOption = async (data) => {
  try {
    const result = await repository.upsertOption(data);
    return { success: true, message: "Guest Glitch option saved successfully.", data: { OptionID: Number(result.optionid) } };
  } catch (error) {
    console.error("Save Guest Glitch Option Error:", error.message);
    const retry = retryableDatabaseResponse(error);
    return retry || fail("Unable to save Guest Glitch option at this time.", 503);
  }
};

const resolveReportRows = async (client, rows) => {
  const resolvedByRow = new Map();
  const organizations = [...new Set(rows.map((row) => Number(row.organizationid)))];
  for (const organizationID of organizations) {
    const scopedRows = rows.filter((row) => Number(row.organizationid) === organizationID);
    const selections = await repository.resolveSelections(client, organizationID, scopedRows);
    scopedRows.forEach((row, index) => resolvedByRow.set(row, selections[index]));
  }
  return rows.map((row) => ({ row, resolved: resolvedByRow.get(row) }));
};

const workflowDTO = (access) => ({ currentStage: access.stagekey, currentStageName: access.stagename,
  canView: access.canview === true, canEdit: access.canedit === true,
  editableFields: access.editablefields || [], canProceed: access.canproceed === true,
  nextStage: access.nextstage || null, isFinalStage: access.isfinalstage === true });

const resolveWorkflowAccess = async (client, row, data, action = "VIEW") => {
  if (!row.currentworkflowstage) return { error: fail("Guest Glitch workflow stage is not configured for this record.", 409) };
  const access = await repository.getWorkflowAccess(client, row, data);
  if (!access && String(row.createdby) === String(data.UserID)) {
    const stage = await repository.getWorkflowStageState(client, row.organizationid, row.currentworkflowstage);
    if (stage) return { access: { ...stage, canview: true, canedit: false, canproceed: false,
      editablefields: [], requiredactionfields: [] } };
  }
  if (!access || access.canview !== true) {
    console.warn("Guest Glitch workflow access denied", { GuestGlitchID: Number(row.id), UserID: data.UserID,
      OrganizationID: data.OrganizationID, currentWorkflowStage: row.currentworkflowstage,
      configuredStage: access?.stagekey || null, action });
    return { error: fail("You are not authorized to access this Guest Glitch at its current workflow stage.", 403) };
  }
  return { access };
};

const selectionNames = (items = []) => items.map((item) => item.Name ?? item.name).filter(Boolean).join(", ");
const mapCompactReportRows = (resolvedRows) => resolvedRows.map(({ row, resolved }) => compactReportDTO({
  ...row,
  departments: selectionNames(resolved.departments),
  receivedByUsers: selectionNames(resolved.receivedByUsers),
  informedToUsers: selectionNames(resolved.informedToUsers),
}));

const report = async (data, complete = false) => {
  const client = await repository.getClient();
  try {
    const result = await repository.reportList(
      data,
      data.OrganizationIDs || data.OrganizationID
    );
    const resolvedRows = await resolveReportRows(client, result.rows);
    const mapped = complete
      ? resolvedRows.map(({ row, resolved }) => completeReportDTO(row, resolved))
      : mapCompactReportRows(resolvedRows);
    return {
      success: true,
      message: complete ? "Guest Glitch master report fetched successfully" : "Guest Glitch report fetched successfully",
      data: mapped,
      pagination: { page: Number(data.page), pageSize: Number(data.pageSize), totalRecords: result.total, totalPages: Math.ceil(result.total / Number(data.pageSize)) },
    };
  } catch (error) {
    console.error("Guest Glitch Report Error:", error.message);
    return fail("Unable to retrieve Guest Glitch report at this time.", 503);
  } finally { client.release(); }
};

const exportReport = async (data) => {
  const client = await repository.getClient();
  try {
    if (!["csv", "excel"].includes(data.format)) return fail("Invalid Guest Glitch export format.");
    const result = await repository.reportList(data, data.OrganizationIDs || data.OrganizationID, false);
    const rows = mapCompactReportRows(await resolveReportRows(client, result.rows));
    const buffer = data.format === "csv"
      ? generateCSV(rows, GUEST_GLITCH_EXPORT_COLUMNS)
      : await generateExcel(rows, GUEST_GLITCH_EXPORT_COLUMNS, "Guest Glitch Report");
    const extension = data.format === "csv" ? "csv" : "xlsx";
    return {
      success: true, message: "Guest Glitch report exported successfully.",
      fileBase64: buffer.toString("base64"),
      contentType: data.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `GuestGlitch_Report_${formatDate(new Date(), "YYYY-MM-DD")}.${extension}`,
    };
  } catch (error) {
    console.error("Guest Glitch Export Error:", error.message);
    return fail("Unable to export Guest Glitch report at this time.", 503);
  } finally { client.release(); }
};

const reportDetail = async (data) => {
  const client = await repository.getClient();
  try {
    const row = await repository.findReportByID(client, data.ID, data.OrganizationIDs || data.OrganizationID);
    if (!row) return fail("Guest Glitch not found", 404);
    const workflow = await resolveWorkflowAccess(client, row, data, "REPORT_VIEW");
    if (workflow.error) return workflow.error;
    const [resolved] = await repository.resolveSelections(client, Number(row.organizationid), [row]);
    return { success: true, message: "Guest Glitch report detail fetched successfully", data: { ...completeReportDTO(row, resolved), workflow: workflowDTO(workflow.access) } };
  } catch (error) {
    console.error("Guest Glitch Report Detail Error:", error.message);
    return fail("Unable to retrieve Guest Glitch report detail at this time.", 503);
  } finally { client.release(); }
};

const masterReportPdf = async (data) => {
  const detail = await reportDetail(data);
  if (!detail.success) return detail;
  try {
    const buffer = await generatePdf({
      title: "Guest Glitch Master Report", reportName: "Guest Glitch Master Report",
      organizationId: detail.data.OrganizationID,
      metadata: [{ label: "Record ID", value: detail.data.ID }, { label: "Organization", value: detail.data.OrganizationName || detail.data.Hotel }],
      sections: GUEST_GLITCH_PDF_SECTIONS.map((section) => ({ title: section.title, items: guestPdfItems(detail.data, section.fields) })),
    });
    return { success: true, message: "Guest Glitch PDF generated successfully", pdfBase64: buffer.toString("base64"), filename: `guest-glitch-${data.ID}.pdf` };
  } catch (error) {
    console.error("Guest Glitch PDF Error:", error.message);
    return fail("Unable to generate Guest Glitch PDF at this time.", 503);
  }
};

const gmAction = async (data) => {
  return update(data);
};

const attachment = async (data) => {
  const client = await repository.getClient();
  try {
    const row = await repository.findByID(client, data.ID, data.OrganizationIDs || data.OrganizationID);
    if (!row) return fail("Guest Glitch not found", 404);
    const workflow = await resolveWorkflowAccess(client, row, data, "ATTACHMENT_VIEW");
    if (workflow.error) return workflow.error;
    if (!row.attachment) return fail("Attachment not found", 404);
    const title = row.attachmenttitle || `guest-glitch-${data.ID}-attachment`;
    return {
      success: true, message: "Attachment URL generated successfully", data: {
        AttachmentTitle: title,
        Url: generateAttachmentUrl(row.attachment, { disposition: data.disposition, filename: title }),
        ExpiresInSeconds: 3600,
      }
    };
  } catch (error) {
    console.error("Guest Glitch Attachment Error:", error.message);
    return fail("Unable to retrieve Guest Glitch attachment at this time.", 503);
  } finally { client.release(); }
};

const getWorkflowConfig = async (data) => {
  const client = await repository.getClient();
  try {
    const rows = await repository.getWorkflowConfig(client, data.OrganizationID);
    const stages = [];
    for (const row of rows) {
      let stage = stages.find((item) => item.FlowConfigID === Number(row.flowconfigid));
      if (!stage) {
        stage = { FlowConfigID: Number(row.flowconfigid), StageKey: row.stagekey, StageName: row.stagename,
          StageOrder: Number(row.stageorder), IsFinalStage: row.isfinalstage, IsActive: row.isactive, Actors: [] };
        stages.push(stage);
      }
      if (row.flowconfigdetailid) stage.Actors.push({ FlowConfigDetailID: Number(row.flowconfigdetailid), ActorType: row.actortype,
        ActorValue: row.actorvalue, CanView: row.canview, CanEdit: row.canedit, CanProceed: row.canproceed,
        EditableFields: row.editablefields || [], RequiredActionFields: row.requiredactionfields || [] });
    }
    return { success: true, message: "Guest Glitch workflow configuration fetched successfully.", data: stages };
  } catch (error) { console.error("Get Guest Glitch Workflow Error:", error.message); return fail("Unable to fetch Guest Glitch workflow configuration at this time.", 503); }
  finally { client.release(); }
};

const saveWorkflowConfig = async (data) => {
  const client = await repository.getClient();
  try { await client.query("BEGIN");
    const actors = data.Stages.flatMap((stage) => stage.Actors);
    const userIDs = [...new Set(actors.filter((actor) => actor.ActorType === "USER_ID").map((actor) => Number(actor.ActorValue)))];
    const departmentIDs = [...new Set(actors.filter((actor) => actor.ActorType === "DEPARTMENT_ID").map((actor) => Number(actor.ActorValue)))];
    const userTypes = [...new Set(actors.filter((actor) => actor.ActorType === "USER_TYPE").map((actor) => String(actor.ActorValue).trim().toUpperCase()))];
    if (userIDs.some((id) => !Number.isSafeInteger(id) || id <= 0)) { await client.query("ROLLBACK"); return fail("USER_ID actor values must be positive integers."); }
    if (departmentIDs.some((id) => !Number.isSafeInteger(id) || id <= 0)) { await client.query("ROLLBACK"); return fail("DEPARTMENT_ID actor values must be positive integers."); }
    const [users, departments, availableTypes] = await Promise.all([
      repository.validateUsers(client, data.OrganizationID, userIDs), repository.validateDepartments(client, data.OrganizationID, departmentIDs),
      repository.validateWorkflowUserTypes(client, data.OrganizationID, userTypes),
    ]);
    const validUsers = new Set(users.map((row) => Number(row.userid))), validDepartments = new Set(departments.map((row) => Number(row.departmentid)));
    const invalidUser = userIDs.find((id) => !validUsers.has(id));
    if (invalidUser) { await client.query("ROLLBACK"); return fail(`Invalid workflow user ID: ${invalidUser}`); }
    const invalidDepartment = departmentIDs.find((id) => !validDepartments.has(id));
    if (invalidDepartment) { await client.query("ROLLBACK"); return fail(`Invalid workflow department ID: ${invalidDepartment}`); }
    const validTypes = new Set(availableTypes), invalidType = userTypes.find((type) => !validTypes.has(type));
    if (invalidType) { await client.query("ROLLBACK"); return fail(`Invalid workflow user type: ${invalidType}`); }
    const stagesInUse = await repository.findWorkflowStagesInUseOutside(client, data.OrganizationID, data.Stages.map((stage) => stage.StageKey));
    if (stagesInUse.length) { await client.query("ROLLBACK"); return fail(`Workflow stages currently in use cannot be removed: ${stagesInUse.join(", ")}`, 409); }
    await repository.replaceWorkflowConfig(client, data); await client.query("COMMIT");
    return { success: true, message: "Guest Glitch workflow configuration saved successfully." };
  } catch (error) { await client.query("ROLLBACK"); console.error("Save Guest Glitch Workflow Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to save Guest Glitch workflow configuration at this time.", 503); }
  finally { client.release(); }
};

const deleteWorkflowConfig = async (data) => {
  const client = await repository.getClient();
  try { await client.query("BEGIN");
    const stagesInUse = await repository.findWorkflowStagesInUseOutside(client, data.OrganizationID, []);
    if (stagesInUse.length) { await client.query("ROLLBACK"); return fail("Guest Glitch workflow configuration cannot be deleted while active records use it.", 409); }
    const count = await repository.deleteWorkflowConfig(client, data.OrganizationID, data.UserID);
    if (!count) { await client.query("ROLLBACK"); return fail("Guest Glitch workflow configuration not found.", 404); }
    await client.query("COMMIT"); return { success: true, message: "Guest Glitch workflow configuration deleted successfully." };
  } catch (error) { await client.query("ROLLBACK"); console.error("Delete Guest Glitch Workflow Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to delete Guest Glitch workflow configuration at this time.", 503); }
  finally { client.release(); }
};

module.exports = {
  create: withOrganization(create),
  list: withOrganization(list, true),
  get: withOrganization(get, true),
  update: withOrganization(update),
  updateStatus: withOrganization(updateStatus),
  remove: withOrganization(remove),
  listOptions: withOrganization(listOptions),
  upsertOption: withOrganization(upsertOption),
  report: withOrganization((data) => report(data, false), true),
  masterReport: withOrganization((data) => report(data, true), true),
  reportDetail: withOrganization(reportDetail, true),
  masterReportPdf: withOrganization(masterReportPdf, true),
  gmView: withOrganization(reportDetail, true),
  gmAction: withOrganization(gmAction),
  attachment: withOrganization(attachment, true),
  exportReport: withOrganization(exportReport, true),
  getWorkflowConfig: withOrganization(getWorkflowConfig),
  saveWorkflowConfig: withOrganization(saveWorkflowConfig),
  deleteWorkflowConfig: withOrganization(deleteWorkflowConfig),
  resolveOrganization,
};
