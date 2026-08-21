const { pool } = require("../../db");
const { COLUMN_MAP, SORT_COLUMNS } = require("../../config/incidentReportConstants");

const DETAIL_COLUMNS = `ir.id, ir.organizationid, ir.reportdate, ir.incidentdate,
  ir.time, ir.location, ir.accidentcause, ir.anycasualty, ir.description,
  ir.damagedcaused, ir.investigation, ir.investigatedby,
  ir.presentduringincident, ir.reportto, ir.reportby,
  ir.createddate, ir.createdby, ir.modifydate, ir.modifyby`;
const COMPACT_COLUMNS = `ir.id, ir.organizationid, ir.reportdate, ir.incidentdate,
  ir.time, ir.location, ir.accidentcause, ir.anycasualty,
  ir.presentduringincident, ir.reportto, ir.reportby`;

const getClient = () => pool.connect();

const resolveOrganizations = async (userID) => {
  const result = await pool.query(
    `SELECT uom.organizationid, om.organizationname
     FROM user_org_mapping uom
     INNER JOIN organization_master om ON om.organizationid = uom.organizationid
     WHERE uom.userid = $1 AND uom.isactive = TRUE AND uom.isdeleted = FALSE
       AND om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
     ORDER BY uom.organizationid
     LIMIT 2;`, [userID]
  );
  return result.rows;
};

const insert = async (client, id, organizationID, data, userID) => {
  const fields = Object.keys(COLUMN_MAP).filter((field) => Object.prototype.hasOwnProperty.call(data, field));
  const values = [id, organizationID, ...fields.map((field) => data[field]), String(userID)];
  const columns = ["id", "organizationid", ...fields.map((field) => COLUMN_MAP[field]), "createdby"];
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const result = await client.query(
    `INSERT INTO incident_report_entry_master
      (${columns.join(", ")}, createddate, isdeleted)
     VALUES (${placeholders.join(", ")}, CURRENT_TIMESTAMP, FALSE)
     RETURNING id;`, values
  );
  return result.rows[0];
};

const findByID = async (client, id, organizationID, lock = false) => {
  const result = await client.query(
    `SELECT ${DETAIL_COLUMNS}
     FROM incident_report_entry_master ir
     WHERE ir.id = $1 AND ir.organizationid = $2 AND ir.isdeleted = FALSE
     LIMIT 1 ${lock ? "FOR UPDATE" : ""};`, [id, organizationID]
  );
  return result.rows[0] || null;
};

const update = async (client, id, organizationID, data, userID) => {
  const fields = Object.keys(COLUMN_MAP).filter((field) => Object.prototype.hasOwnProperty.call(data, field));
  const values = fields.map((field) => data[field]);
  const assignments = fields.map((field, index) => `${COLUMN_MAP[field]} = $${index + 1}`);
  values.push(String(userID), id, organizationID);
  const result = await client.query(
    `UPDATE incident_report_entry_master
     SET ${assignments.join(", ")}, modifyby = $${values.length - 2}, modifydate = CURRENT_TIMESTAMP
     WHERE id = $${values.length - 1} AND organizationid = $${values.length} AND isdeleted = FALSE
     RETURNING id;`, values
  );
  return result.rows[0] || null;
};

const softDelete = async (client, id, organizationID, userID) => {
  const result = await client.query(
    `UPDATE incident_report_entry_master
     SET isdeleted = TRUE, modifyby = $1, modifydate = CURRENT_TIMESTAMP
     WHERE id = $2 AND organizationid = $3 AND isdeleted = FALSE
     RETURNING id;`, [String(userID), id, organizationID]
  );
  return result.rows[0] || null;
};

const buildFilters = (data, organizationID) => {
  const filters = ["ir.organizationid = $1", "ir.isdeleted = FALSE"];
  const values = [organizationID];
  const add = (sql, value) => { values.push(value); filters.push(sql.replace("?", `$${values.length}`)); };
  if (data.search) {
    values.push(`%${data.search}%`);
    const p = `$${values.length}`;
    filters.push(`(ir.location ILIKE ${p} OR ir.accidentcause ILIKE ${p} OR ir.anycasualty ILIKE ${p}
      OR ir.presentduringincident ILIKE ${p} OR ir.reportto ILIKE ${p} OR ir.reportby ILIKE ${p}
      OR ir.description ILIKE ${p})`);
  }
  if (data.year) {
    const month = data.month ? Number(data.month) : 1;
    const start = `${data.year}-${String(month).padStart(2, "0")}-01`;
    const end = data.month
      ? new Date(Date.UTC(Number(data.year), month, 1)).toISOString().slice(0, 10)
      : `${Number(data.year) + 1}-01-01`;
    add("ir.reportdate >= ?", start);
    add("ir.reportdate < ?", end);
  }
  if (data.fromDate) add("ir.reportdate >= ?", data.fromDate);
  if (data.toDate) add("ir.reportdate <= ?", data.toDate);
  return { where: filters.join(" AND "), values };
};

const list = async (data, organizationID, detailed = false, paginate = true) => {
  const { where, values } = buildFilters(data, organizationID);
  const count = paginate
    ? await pool.query(`SELECT COUNT(*)::bigint total FROM incident_report_entry_master ir WHERE ${where};`, values)
    : null;
  const limit = Number(data.pageSize), offset = (Number(data.page) - 1) * limit;
  const queryValues = paginate ? [...values, limit, offset] : values;
  const paginationSQL = paginate
    ? `LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length}`
    : "";
  const direction = String(data.sortDirection).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const result = await pool.query(
    `SELECT ${detailed ? DETAIL_COLUMNS : COMPACT_COLUMNS}
     FROM incident_report_entry_master ir WHERE ${where}
     ORDER BY ${SORT_COLUMNS[data.sortBy]} ${direction}, ir.id DESC
     ${paginationSQL};`, queryValues
  );
  return { rows: result.rows, total: paginate ? Number(count.rows[0].total) : result.rows.length };
};

module.exports = { getClient, resolveOrganizations, insert, findByID, update, softDelete, list };
