const { pool } = require("../../db");
const { SORT_COLUMNS, REPORT_SORT_COLUMNS, FIELD_AUDIT_COLUMNS } = require("../../config/guestGlitchConstants");

const COLUMN_MAP = Object.freeze({
  EntryDate: "entrydate", Status: "status", ResolvedBy: "resolvedby",
  ReceivedBy: "receivedby", InformedTo: "informedto", GuestName: "guestname",
  RoomNumber: "roomnumber", Time: "time", Complaint: "complaint",
  ServiceRecovery: "servicerecovery", DetailedInvestigation: "detailedinvestigation",
  InternalActionTaken: "internalactiontaken", CompanyName: "companyname", Rate: "rate",
  CheckInDate: "checkindate", CheckOutDate: "checkoutdate", UpdatedBy: "updatedby",
  GMComment: "gmcomment", ProcessLapse: "processlapse", Department: "department",
  SRA_Room: "sra_room", SRA_Food: "sra_food", SRA_Other: "sra_other",
  RaiseSource: "raisesource", ComplaintSource: "complaintsource",
  AttachmentTitle: "attachmenttitle", Attachment: "attachment", GuestStatus: "gueststatus",
  ProcessLapseCategory: "processlapsecategory",
  InternalActionTakenCategory: "internalactiontakencategory", GetMetJson: "getmetjson",
  DepartmentIDs: "departmentids", ReceivedByIDs: "receivedbyids",
  InformedToIDs: "informedtoids", DepartmentHODComments: "departmenthodcomments",
});

const JSON_FIELDS = new Set(["GetMetJson", "DepartmentIDs", "ReceivedByIDs", "InformedToIDs", "DepartmentHODComments"]);

const getClient = () => pool.connect();

const validateDepartments = async (client, organizationID, ids) => {
  if (!ids.length) return [];
  const result = await client.query(
    `SELECT departmentid, departmentname
     FROM department_master
     WHERE organizationid = $1 AND isdeleted = FALSE AND departmentid = ANY($2::bigint[])
     ORDER BY departmentname;`,
    [organizationID, ids]
  );
  return result.rows;
};

const validateUsers = async (client, organizationID, ids) => {
  if (!ids.length) return [];
  const result = await client.query(
    `SELECT DISTINCT um.userid, um.fullname, um.username
     FROM user_master um
     INNER JOIN user_org_mapping uom ON uom.userid = um.userid
     WHERE uom.organizationid = $1 AND um.userid = ANY($2::bigint[])
       AND uom.isactive = TRUE AND uom.isdeleted = FALSE
       AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
     ORDER BY um.fullname;`,
    [organizationID, ids]
  );
  return result.rows;
};

const findOption = async (client, organizationID, optionType, optionValue) => {
  const result = await client.query(
    `SELECT optionid, optiontype, optionvalue, displayname, metadata
     FROM guest_glitch_option_master
     WHERE organizationid = $1 AND optiontype = $2 AND optionvalue = $3
       AND isactive = TRUE AND isdeleted = FALSE LIMIT 1;`,
    [organizationID, optionType, optionValue]
  );
  return result.rows[0] || null;
};

const insert = async (client, data) => {
  const fields = Object.keys(COLUMN_MAP).filter((field) => Object.prototype.hasOwnProperty.call(data, field));
  const columns = fields.map((field) => COLUMN_MAP[field]);
  const values = fields.map((field) => JSON_FIELDS.has(field) ? JSON.stringify(data[field]) : data[field]);
  const fixedColumns = ["organizationid", "createdby", "modifyby", "updatedby", "createdip", "modifiedip"];
  const fixedValues = [data.OrganizationID, String(data.UserID), String(data.UserID), data.Username, data.IP, data.IP];
  const allValues = [...values, ...fixedValues];
  const placeholders = allValues.map((_, index) => `$${index + 1}`);
  const result = await client.query(
    `INSERT INTO guest_glitch_entry_master
      (${[...columns, ...fixedColumns].join(", ")})
     VALUES (${placeholders.join(", ")}) RETURNING id;`,
    allValues
  );
  return result.rows[0];
};

const findByID = async (client, id, organizationID, includeDeleted = false, lock = false) => {
  const result = await client.query(
    `SELECT * FROM guest_glitch_entry_master
     WHERE id = $1 AND organizationid = $2 ${includeDeleted ? "" : "AND isdeleted = FALSE"}
     LIMIT 1 ${lock ? "FOR UPDATE" : ""};`,
    [id, organizationID]
  );
  return result.rows[0] || null;
};

const updateChangedFields = async (client, id, organizationID, changed, userID, username, ip) => {
  const assignments = [];
  const values = [];
  const add = (sql, value) => { values.push(value); assignments.push(`${sql} = $${values.length}`); };

  for (const [field, value] of Object.entries(changed)) {
    const column = COLUMN_MAP[field];
    if (!column) continue;
    add(column, JSON_FIELDS.has(field) ? JSON.stringify(value) : value);
    const audit = FIELD_AUDIT_COLUMNS[field];
    if (audit) {
      add(audit[0], userID);
      assignments.push(`${audit[1]} = CURRENT_TIMESTAMP`);
    }
  }
  add("modifyby", String(userID));
  add("updatedby", username);
  add("modifiedip", ip);
  assignments.push("modifydate = CURRENT_TIMESTAMP");
  values.push(id, organizationID);
  const result = await client.query(
    `UPDATE guest_glitch_entry_master SET ${assignments.join(", ")}
     WHERE id = $${values.length - 1} AND organizationid = $${values.length} AND isdeleted = FALSE
     RETURNING id;`,
    values
  );
  return result.rows[0] || null;
};

const softDelete = async (client, id, organizationID, userID, ip) => {
  const result = await client.query(
    `UPDATE guest_glitch_entry_master
     SET isdeleted = TRUE,
         deleteddate = CURRENT_TIMESTAMP,
         deletedby = $1,
         modifyby = $2,
         modifydate = CURRENT_TIMESTAMP,
         modifiedip = $3
     WHERE id = $4
       AND organizationid = $5
       AND isdeleted = FALSE
     RETURNING id;`,
    [
      userID,
      String(userID),
      ip,
      id,
      organizationID,
    ]
  );
  return result.rows[0] || null;
};

const list = async (data, organizationID) => {
  const filters = ["gg.organizationid = $1", "gg.isdeleted = FALSE"];
  const values = [organizationID];
  const add = (condition, value) => { values.push(value); filters.push(condition.replace("?", `$${values.length}`)); };
  if (data.search) add("(gg.guestname ILIKE ? OR gg.roomnumber ILIKE ? OR gg.complaint ILIKE ? OR gg.companyname ILIKE ?)", `%${data.search}%`);
  if (data.search) {
    const p = `$${values.length}`;
    filters[filters.length - 1] = `(gg.guestname ILIKE ${p} OR gg.roomnumber ILIKE ${p} OR gg.complaint ILIKE ${p} OR gg.companyname ILIKE ${p})`;
  }
  if (data.fromDate) add("gg.entrydate >= ?", data.fromDate);
  if (data.toDate) add("gg.entrydate <= ?", data.toDate);
  const scalarFilters = { status: "gg.status", roomNumber: "gg.roomnumber", complaint: "gg.complaint", guestStatus: "gg.gueststatus", companyName: "gg.companyname", complaintSource: "gg.complaintsource", raiseSource: "gg.raisesource", createdBy: "gg.createdby", updatedBy: "gg.updatedby" };
  for (const [field, column] of Object.entries(scalarFilters)) if (data[field]) add(`${column} ILIKE ?`, `%${data[field]}%`);
  for (const [field, column] of [["departmentIds", "departmentids"], ["receivedByIds", "receivedbyids"], ["informedToIds", "informedtoids"]]) {
    if (data[field]?.length) {
      add(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(gg.${column}) AS selected_id(value) WHERE selected_id.value::bigint = ANY(?::bigint[]))`, data[field]);
    }
  }
  const where = filters.join(" AND ");
  const count = await pool.query(`SELECT COUNT(*)::bigint AS total FROM guest_glitch_entry_master gg WHERE ${where};`, values);
  const page = Number(data.page), pageSize = Number(data.pageSize), offset = (page - 1) * pageSize;
  const sortColumn = SORT_COLUMNS[data.sortBy];
  const direction = String(data.sortDirection).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const queryValues = [...values, pageSize, offset];
  const rows = await pool.query(
    `SELECT gg.* FROM guest_glitch_entry_master gg WHERE ${where}
     ORDER BY ${sortColumn} ${direction}, gg.id DESC
     LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length};`,
    queryValues
  );
  return { rows: rows.rows, total: Number(count.rows[0].total) };
};

const listOptions = async (organizationID, optionType = null) => {
  const result = await pool.query(
    `SELECT optionid, optiontype, optionvalue, displayname, metadata, sortorder
     FROM guest_glitch_option_master
     WHERE organizationid = $1 AND isactive = TRUE AND isdeleted = FALSE
       AND ($2::varchar IS NULL OR optiontype = $2)
     ORDER BY optiontype, sortorder, displayname;`,
    [organizationID, optionType]
  );
  return result.rows;
};

const buildReportFilters = (data, organizationID) => {
  const filters = ["gg.organizationid = $1", "gg.isdeleted = FALSE"];
  const values = [organizationID];
  const add = (sql, value) => { values.push(value); filters.push(sql.replace("?", `$${values.length}`)); };
  if (data.search) {
    values.push(`%${data.search}%`);
    const p = `$${values.length}`;
    filters.push(`(gg.guestname ILIKE ${p} OR gg.roomnumber ILIKE ${p} OR gg.complaint ILIKE ${p} OR gg.companyname ILIKE ${p})`);
  }
  if (data.fromDate) add("gg.entrydate >= ?", data.fromDate);
  if (data.toDate) add("gg.entrydate <= ?", data.toDate);
  for (const [field, column] of Object.entries({ status: "gg.status", roomNumber: "gg.roomnumber", guestName: "gg.guestname", complaint: "gg.complaint", complaintSource: "gg.complaintsource", raiseSource: "gg.raisesource" })) {
    if (data[field]) add(`${column} ILIKE ?`, `%${data[field]}%`);
  }
  if (data.departmentIds?.length) add(
    "EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(gg.departmentids, '[]'::jsonb)) selected(value) WHERE selected.value::bigint = ANY(?::bigint[]))",
    data.departmentIds
  );
  return { filters, values };
};

const reportList = async (data, organizationID) => {
  const { filters, values } = buildReportFilters(data, organizationID);
  const where = filters.join(" AND ");
  const count = await pool.query(`SELECT COUNT(*)::bigint total FROM guest_glitch_entry_master gg WHERE ${where};`, values);
  const limit = Number(data.pageSize), offset = (Number(data.page) - 1) * limit;
  const queryValues = [...values, limit, offset];
  const sort = REPORT_SORT_COLUMNS[data.sortBy];
  const direction = String(data.sortDirection).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const result = await pool.query(
    `SELECT gg.*, om.organizationname AS hotel
     FROM guest_glitch_entry_master gg
     INNER JOIN organization_master om ON om.organizationid = gg.organizationid
     WHERE ${where}
     ORDER BY ${sort} ${direction}, gg.id DESC
     LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length};`, queryValues
  );
  return { rows: result.rows, total: Number(count.rows[0].total) };
};

const findReportByID = async (client, id, organizationID, lock = false) => {
  const result = await client.query(
    `SELECT gg.*, om.organizationname AS hotel
     FROM guest_glitch_entry_master gg
     INNER JOIN organization_master om ON om.organizationid = gg.organizationid
     WHERE gg.id = $1 AND gg.organizationid = $2 AND gg.isdeleted = FALSE
     LIMIT 1 ${lock ? "FOR UPDATE OF gg" : ""};`, [id, organizationID]
  );
  return result.rows[0] || null;
};

const resolveSelections = async (client, organizationID, rows) => {
  const unique = (field) => [...new Set(rows.flatMap((row) => row[field] || []).map(Number))];
  const [departments, users] = await Promise.all([
    validateDepartments(client, organizationID, unique("departmentids")),
    validateUsers(client, organizationID, [...new Set([...unique("receivedbyids"), ...unique("informedtoids")])]),
  ]);
  const departmentMap = new Map(departments.map((item) => [Number(item.departmentid), item.departmentname]));
  const userMap = new Map(users.map((item) => [Number(item.userid), item.fullname || item.username]));
  return rows.map((row) => ({
    departments: (row.departmentids || []).map(Number).map((id) => ({ id, name: departmentMap.get(id) || null })),
    receivedByUsers: (row.receivedbyids || []).map(Number).map((id) => ({ id, name: userMap.get(id) || null })),
    informedToUsers: (row.informedtoids || []).map(Number).map((id) => ({ id, name: userMap.get(id) || null })),
  }));
};

const upsertOption = async (data) => {
  const result = await pool.query(
    `INSERT INTO guest_glitch_option_master
      (organizationid, optiontype, optionvalue, displayname, metadata, sortorder, isactive, createdby)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     ON CONFLICT (organizationid, optiontype, optionvalue) WHERE isdeleted = FALSE
     DO UPDATE SET displayname = EXCLUDED.displayname, metadata = EXCLUDED.metadata,
       sortorder = EXCLUDED.sortorder, isactive = EXCLUDED.isactive,
       modifiedby = EXCLUDED.createdby, modifieddate = CURRENT_TIMESTAMP
     RETURNING optionid;`,
    [data.OrganizationID, data.OptionType, data.OptionValue, data.DisplayName || data.OptionValue,
      JSON.stringify(data.Metadata || {}), Number(data.SortOrder || 0), data.IsActive !== false, data.UserID]
  );
  return result.rows[0];
};

module.exports = {
  COLUMN_MAP, getClient, validateDepartments, validateUsers, findOption, insert,
  findByID, updateChangedFields, softDelete, list, listOptions, upsertOption,
  reportList, findReportByID, resolveSelections,
};
