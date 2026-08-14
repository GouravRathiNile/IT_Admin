const repository = require("../../repositories/GuestGlitchRepository/GuestGlitchRepository");
const { OPTION_TYPES } = require("../../config/guestGlitchConstants");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

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
  if (record) return { record };
  const ownership = await repository.findOwnership(client, id);
  if (!ownership) return { error: fail("Guest glitch record not found.", 404) };
  if (Number(ownership.organizationid) !== Number(organizationID)) return { error: fail("Guest glitch record does not belong to your organization.", 403) };
  if (ownership.isdeleted) return { error: fail("Guest glitch record has already been deleted.", 400) };
  return { error: fail("Guest glitch record not found.", 404) };
};

const validateSelections = async (client, data, organizationID) => {
  const departments = await repository.validateDepartments(client, organizationID, data.DepartmentIDs || []);
  if (departments.length !== (data.DepartmentIDs || []).length) return { error: fail("One or more selected departments are invalid or inactive.") };
  const receivedUsers = await repository.validateUsers(client, organizationID, data.ReceivedByIDs || []);
  if (receivedUsers.length !== (data.ReceivedByIDs || []).length) return { error: fail("One or more Received By users are invalid or inactive.") };
  const informedUsers = await repository.validateUsers(client, organizationID, data.InformedToIDs || []);
  if (informedUsers.length !== (data.InformedToIDs || []).length) return { error: fail("One or more Informed To users are invalid or inactive.") };
  const selected = new Set((data.DepartmentIDs || []).map(Number));
  if ((data.DepartmentHODComments || []).some((item) => !selected.has(Number(item.departmentId)))) {
    return { error: fail("HOD comments can only be added for selected departments.") };
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
    return { success: true, message: "Guest glitch created successfully.", data: { ID: Number(result.id) } };
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
      success: true, message: "Guest glitches retrieved successfully.",
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
    if (!allowed.includes(target)) { await client.query("ROLLBACK"); return fail("This guest glitch cannot be moved to the requested status."); }
    if (target === "Resolved" && !cleanText(data.ResolvedBy)) { await client.query("ROLLBACK"); return fail("Resolved By is required when resolving a guest glitch."); }
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

module.exports = { create, list, get, update, updateStatus, remove, listOptions, upsertOption };
