const repository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const { OPTION_TYPES } = require("../../config/guestGlitchConstants");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");
const { compactReportDTO, completeReportDTO } = require("../../dto/GuestGlitchReportDTO");
const { generateGuestGlitchPdf } = require("./GuestGlitchPdfService");
const generateAttachmentUrl = require("../../AzurConfigration/GuestGlitch/AzureGetData");

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

const mapRow = (row) => ({
  ID: Number(row.id), OrganizationID: Number(row.organizationid), EntryDate: row.entrydate,
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
  const selected = new Set((data.DepartmentIDs || []).map(Number));
  if ((data.DepartmentHODComments || []).some((item) => !selected.has(Number(item.departmentId)))) {
    return { error: fail("Department HOD comment can only be added for a selected department") };
  }
  return { departments, receivedUsers, informedUsers };
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
});

const create = async (data) => {
  const client = await repository.getClient();
  try {
    await client.query("BEGIN");
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

const list = async (data) => {
  try {
    const result = await repository.list(data, data.OrganizationID);
    return {
      success: true, message: "Guest Glitches fetched successfully",
      data: result.rows.map(mapRow),
      pagination: { page: Number(data.page), pageSize: Number(data.pageSize), totalRecords: result.total, totalPages: Math.ceil(result.total / Number(data.pageSize)) },
    };
  } catch (error) {
    console.error("List Guest Glitch Error:", error.message);
    return fail("Unable to retrieve guest glitches at this time.", 503);
  }
};

const get = async (data) => {
  const client = await repository.getClient();
  try {
    const found = await ensureOwnedRecord(client, data.ID, data.OrganizationID);
    if (found.error) return found.error;
    const row = found.record;
    const [departments, receivedUsers, informedUsers] = await Promise.all([
      repository.validateDepartments(client, data.OrganizationID, row.departmentids || []),
      repository.validateUsers(client, data.OrganizationID, row.receivedbyids || []),
      repository.validateUsers(client, data.OrganizationID, row.informedtoids || []),
    ]);
    return { success: true, message: "Guest glitch retrieved successfully.", data: {
      ...mapRow(row),
      departments: departments.map((item) => ({ id: Number(item.departmentid), name: item.departmentname })),
      receivedByUsers: receivedUsers.map((item) => ({ id: Number(item.userid), name: item.fullname })),
      informedToUsers: informedUsers.map((item) => ({ id: Number(item.userid), name: item.fullname })),
    } };
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
    const current = mapRow(found.record);
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
    if (!Object.keys(changed).length) { await client.query("ROLLBACK"); return { success: true, message: "No changes were detected.", data: { ID: Number(data.ID) } }; }
    await repository.updateChangedFields(client, data.ID, data.OrganizationID, changed, data.UserID, data.Username, data.IP);
    await client.query("COMMIT");
    return { success: true, message: "Guest glitch updated successfully.", data: { ID: Number(data.ID) } };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update Guest Glitch Error:", error.message);
    const retry = retryableDatabaseResponse(error);
    return retry || fail("Unable to update guest glitch at this time.", 503);
  } finally { client.release(); }
};

const updateStatus = async (data) => {
  const client = await repository.getClient();
  try {
    await client.query("BEGIN");
    const found = await ensureOwnedRecord(client, data.ID, data.OrganizationID, true);
    if (found.error) { await client.query("ROLLBACK"); return found.error; }
    const target = cleanText(data.Status);
    const [option, currentOption] = await Promise.all([
      repository.findOption(client, data.OrganizationID, "Status", target),
      repository.findOption(client, data.OrganizationID, "Status", found.record.status),
    ]);
    if (!option) { await client.query("ROLLBACK"); return fail("The selected status is invalid or inactive."); }
    if (!currentOption) { await client.query("ROLLBACK"); return fail("The current status is not configured for this organization."); }
    const allowed = Array.isArray(currentOption.metadata?.allowedNext)
      ? currentOption.metadata.allowedNext
      : [];
    if (!allowed.includes(target)) { await client.query("ROLLBACK"); return fail(`Invalid status transition from ${found.record.status} to ${target}`); }
    if (option.metadata?.requiresResolvedBy === true && !cleanText(data.ResolvedBy)) {
      await client.query("ROLLBACK");
      return fail(`ResolvedBy is required when changing status to ${target}`);
    }
    const changed = { Status: target };
    if (data.ResolvedBy != null) changed.ResolvedBy = cleanText(data.ResolvedBy);
    await repository.updateChangedFields(client, data.ID, data.OrganizationID, changed, data.UserID, data.Username, data.IP);
    await client.query("COMMIT");
    return { success: true, message: "Guest glitch status updated successfully.", data: { ID: Number(data.ID), Status: target } };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Status Guest Glitch Error:", error.message);
    const retry = retryableDatabaseResponse(error);
    return retry || fail("Unable to update guest glitch status at this time.", 503);
  } finally { client.release(); }
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
    return { success: true, message: "Guest Glitch options retrieved successfully.", data: rows.map((row) => ({
      OptionID: Number(row.optionid), OptionType: row.optiontype, OptionValue: row.optionvalue,
      DisplayName: row.displayname, Metadata: row.metadata || {}, SortOrder: row.sortorder,
    })) };
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
  const selections = await repository.resolveSelections(client, rows[0]?.organizationid, rows);
  return rows.map((row, index) => ({ row, resolved: selections[index] }));
};

const report = async (data, complete = false) => {
  const client = await repository.getClient();
  try {
    const result = await repository.reportList(data, data.OrganizationID);
    const resolvedRows = await resolveReportRows(client, result.rows);
    const mapped = resolvedRows.map(({ row, resolved }) => complete
      ? completeReportDTO(row, resolved)
      : compactReportDTO({ ...row, departments: resolved.departments.map((item) => item.name).filter(Boolean).join(", "), receivedByUsers: resolved.receivedByUsers.map((item) => item.name).filter(Boolean).join(", ") }));
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

const reportDetail = async (data) => {
  const client = await repository.getClient();
  try {
    const row = await repository.findReportByID(client, data.ID, data.OrganizationID);
    if (!row) return fail("Guest Glitch not found", 404);
    const [resolved] = await repository.resolveSelections(client, data.OrganizationID, [row]);
    return { success: true, message: "Guest Glitch report detail fetched successfully", data: completeReportDTO(row, resolved) };
  } catch (error) {
    console.error("Guest Glitch Report Detail Error:", error.message);
    return fail("Unable to retrieve Guest Glitch report detail at this time.", 503);
  } finally { client.release(); }
};

const masterReportPdf = async (data) => {
  const detail = await reportDetail(data);
  if (!detail.success) return detail;
  try {
    const buffer = await generateGuestGlitchPdf(detail.data);
    return { success: true, message: "Guest Glitch PDF generated successfully", pdfBase64: buffer.toString("base64"), filename: `guest-glitch-${data.ID}.pdf` };
  } catch (error) {
    console.error("Guest Glitch PDF Error:", error.message);
    return fail("Unable to generate Guest Glitch PDF at this time.", 503);
  }
};

const gmAction = async (data) => {
  const client = await repository.getClient();
  try {
    await client.query("BEGIN");
    const row = await repository.findReportByID(client, data.ID, data.OrganizationID, true);
    if (!row) { await client.query("ROLLBACK"); return fail("Guest Glitch not found", 404); }
    const changed = { GMComment: cleanText(data.GMComment) };
    if (data.Status != null) {
      const targetValue = cleanText(data.Status);
      const [current, target] = await Promise.all([
        repository.findOption(client, data.OrganizationID, "Status", row.status),
        repository.findOption(client, data.OrganizationID, "Status", targetValue),
      ]);
      if (!current || !target) { await client.query("ROLLBACK"); return fail("The selected status is invalid or inactive."); }
      const allowed = Array.isArray(current.metadata?.allowedNext) ? current.metadata.allowedNext : [];
      if (!allowed.includes(targetValue)) { await client.query("ROLLBACK"); return fail(`Invalid status transition from ${row.status} to ${targetValue}`); }
      if (target.metadata?.requiresResolvedBy === true && !cleanText(data.ResolvedBy)) {
        await client.query("ROLLBACK"); return fail(`ResolvedBy is required when changing status to ${targetValue}`);
      }
      changed.Status = targetValue;
      if (data.ResolvedBy != null) changed.ResolvedBy = cleanText(data.ResolvedBy);
    }
    await repository.updateChangedFields(client, data.ID, data.OrganizationID, changed, data.UserID, data.Username, data.IP);
    await client.query("COMMIT");
    return { success: true, message: "Guest Glitch GM action saved successfully", data: { ID: Number(data.ID), Status: changed.Status || row.status } };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Guest Glitch GM Action Error:", error.message);
    const retry = retryableDatabaseResponse(error);
    return retry || fail("Unable to save Guest Glitch GM action at this time.", 503);
  } finally { client.release(); }
};

const attachment = async (data) => {
  const client = await repository.getClient();
  try {
    const row = await repository.findByID(client, data.ID, data.OrganizationID);
    if (!row) return fail("Guest Glitch not found", 404);
    if (!row.attachment) return fail("Attachment not found", 404);
    const title = row.attachmenttitle || `guest-glitch-${data.ID}-attachment`;
    return { success: true, message: "Attachment URL generated successfully", data: {
      AttachmentTitle: title,
      Url: generateAttachmentUrl(row.attachment, { disposition: data.disposition, filename: title }),
      ExpiresInSeconds: 3600,
    } };
  } catch (error) {
    console.error("Guest Glitch Attachment Error:", error.message);
    return fail("Unable to retrieve Guest Glitch attachment at this time.", 503);
  } finally { client.release(); }
};

module.exports = {
  create, list, get, update, updateStatus, remove, listOptions, upsertOption,
  report: (data) => report(data, false), masterReport: (data) => report(data, true),
  reportDetail, masterReportPdf, gmView: reportDetail, gmAction, attachment,
};
