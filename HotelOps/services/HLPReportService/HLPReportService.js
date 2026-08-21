const { pool } = require("../../db");
const { formatDate } = require("../../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

const fail = (message, statusCode = 400) => ({ success: false, statusCode, message });
const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const isRealDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const normalizeValue = (value, field) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > 30) throw Object.assign(new Error(`${field} must not exceed 30 characters`), { statusCode: 400 });
  return normalized;
};

const validateOrganization = async (client, userID, organizationID) => {
  if (!positiveInteger(organizationID)) return fail("Organization ID must be a positive integer");
  const result = await client.query(
    `SELECT 1
       FROM user_org_mapping uom
       JOIN organization_master om ON om.organizationid = uom.organizationid
      WHERE uom.userid = $1 AND uom.organizationid = $2
        AND uom.isactive = TRUE AND uom.isdeleted = FALSE
        AND om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
      LIMIT 1`,
    [userID, Number(organizationID)]
  );
  return result.rowCount ? null : fail("You are not authorized to access the selected organization.", 403);
};

const getMasterRows = (client, activeOnly = true) => client.query(
  `SELECT id AS "ID", title AS "Title", orderby AS "OrderBy", isactive AS "IsActive"
     FROM hlpreport_master_list
    ${activeOnly ? "WHERE isactive = TRUE" : ""}
    ORDER BY orderby NULLS LAST, id`
);

const getMasterList = async () => {
  const client = await pool.connect();
  try {
    const result = await getMasterRows(client);
    return { success: true, message: "HLP report master list fetched successfully", data: result.rows };
  } catch (error) {
    console.error("Get HLP Master List Error:", error.message);
    return fail("Unable to fetch HLP master list at this time.", 503);
  } finally { client.release(); }
};

const masterAuditFields = ["CreatedBy", "CreatedDateTime", "ModifyBy", "ModifyDateTime"];
const parseIsActive = (value, defaultValue) => {
  if (value === undefined) return defaultValue;
  if (value === true || value === false) return value;
  throw Object.assign(new Error("IsActive must be true or false"), { statusCode: 400 });
};
const parseOrderBy = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const order = Number(value);
  if (!Number.isInteger(order)) throw Object.assign(new Error("OrderBy must be an integer"), { statusCode: 400 });
  return order;
};

const createMasterField = async (data) => {
  const title = typeof data.Title === "string" ? data.Title.trim() : "";
  if (!title) return fail("Title is required");
  if (masterAuditFields.some((field) => Object.prototype.hasOwnProperty.call(data, field))) return fail("Audit fields cannot be supplied by the client");
  let orderBy; let isActive;
  try { orderBy = parseOrderBy(data.OrderBy); isActive = parseIsActive(data.IsActive, true); } catch (error) { return fail(error.message); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_master_list_id'))");
    const id = Number((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM hlpreport_master_list")).rows[0].id);
    const result = await client.query(
      `INSERT INTO hlpreport_master_list (id, title, orderby, isactive, createdby, createddatetime)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       RETURNING id AS "ID", title AS "Title", orderby AS "OrderBy", isactive AS "IsActive"`,
      [id, title, orderBy, isActive, data.UserID]
    );
    await client.query("COMMIT");
    return { success: true, message: "HLP master field created successfully", data: result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create HLP Master Field Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to create HLP master field at this time.", 503);
  } finally { client.release(); }
};

const updateMasterField = async (data) => {
  if (!positiveInteger(data.ID)) return fail("HLP master field ID must be a positive integer");
  if (masterAuditFields.some((field) => Object.prototype.hasOwnProperty.call(data, field))) return fail("Audit fields cannot be supplied by the client");
  const sets = []; const values = [];
  if (Object.prototype.hasOwnProperty.call(data, "Title")) {
    const title = typeof data.Title === "string" ? data.Title.trim() : "";
    if (!title) return fail("Title is required");
    values.push(title); sets.push(`title = $${values.length}`);
  }
  try {
    if (Object.prototype.hasOwnProperty.call(data, "OrderBy")) { values.push(parseOrderBy(data.OrderBy)); sets.push(`orderby = $${values.length}`); }
    if (Object.prototype.hasOwnProperty.call(data, "IsActive")) { values.push(parseIsActive(data.IsActive)); sets.push(`isactive = $${values.length}`); }
  } catch (error) { return fail(error.message); }
  if (!sets.length) return fail("At least one master field value is required for update");
  const client = await pool.connect();
  try {
    values.push(data.UserID); sets.push(`modifyby = $${values.length}`, "modifydatetime = CURRENT_TIMESTAMP");
    values.push(Number(data.ID));
    const result = await client.query(
      `UPDATE hlpreport_master_list SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING id AS "ID", title AS "Title", orderby AS "OrderBy", isactive AS "IsActive"`, values
    );
    if (!result.rowCount) return fail("HLP master field not found", 404);
    return { success: true, message: "HLP master field updated successfully", data: result.rows[0] };
  } catch (error) {
    console.error("Update HLP Master Field Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to update HLP master field at this time.", 503);
  } finally { client.release(); }
};

const deleteMasterField = async (data) => {
  if (!positiveInteger(data.ID)) return fail("HLP master field ID must be a positive integer");
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE hlpreport_master_list SET isactive = FALSE, modifyby = $1, modifydatetime = CURRENT_TIMESTAMP
        WHERE id = $2 RETURNING id AS "ID"`, [data.UserID, Number(data.ID)]
    );
    if (!result.rowCount) return fail("HLP master field not found", 404);
    return { success: true, message: "HLP master field deactivated successfully", data: result.rows[0] };
  } catch (error) {
    console.error("Deactivate HLP Master Field Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to deactivate HLP master field at this time.", 503);
  } finally { client.release(); }
};

const createReport = async (data) => {
  const { UserID, OrganizationID, EntryDate, Details } = data;
  if (!positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
  if (!isRealDate(EntryDate)) return fail("EntryDate must be a valid date in YYYY-MM-DD format");
  if (!Array.isArray(Details) || Details.length === 0) return fail("Details must be a non-empty array");
  const protectedFields = ["CreatedBy", "CreatedDateTime", "ModifyBy", "ModifyDateTime"];
  if (protectedFields.some((field) => Object.prototype.hasOwnProperty.call(data, field))) return fail("Audit fields cannot be supplied by the client");

  const prepared = [];
  const ids = new Set();
  try {
    for (const detail of Details) {
      if (!detail || !positiveInteger(detail.MasterID)) return fail("Each detail must contain a valid MasterID");
      const masterID = Number(detail.MasterID);
      if (ids.has(masterID)) return fail(`Duplicate MasterID is not allowed: ${masterID}`);
      if (protectedFields.some((field) => Object.prototype.hasOwnProperty.call(detail, field)) || Object.prototype.hasOwnProperty.call(detail, "Title")) {
        return fail("Detail titles and audit fields cannot be supplied by the client");
      }
      ids.add(masterID);
      prepared.push({ MasterID: masterID, YOD: normalizeValue(detail.YOD, "YOD"), LYOD: normalizeValue(detail.LYOD, "LYOD") });
    }
  } catch (error) { return fail(error.message, error.statusCode || 400); }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const denied = await validateOrganization(client, UserID, OrganizationID);
    if (denied) { await client.query("ROLLBACK"); return denied; }
    const duplicate = await client.query(
      "SELECT 1 FROM hlpreport_entry_master WHERE organizationid = $1 AND entrydate = $2 LIMIT 1",
      [Number(OrganizationID), EntryDate]
    );
    if (duplicate.rowCount) { await client.query("ROLLBACK"); return fail("An HLP report already exists for the selected organization and date.", 409); }

    const masterResult = await client.query(
      `SELECT id, title FROM hlpreport_master_list WHERE id = ANY($1::bigint[]) AND isactive = TRUE`,
      [[...ids]]
    );
    const titleByID = new Map(masterResult.rows.map((row) => [Number(row.id), row.title]));
    const invalidID = [...ids].find((id) => !titleByID.has(id));
    if (invalidID) { await client.query("ROLLBACK"); return fail(`Invalid HLP report MasterID: ${invalidID}`); }

    await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_entry_master_id'))");
    const entryID = Number((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM hlpreport_entry_master")).rows[0].id);
    await client.query(
      `INSERT INTO hlpreport_entry_master (id, organizationid, entrydate, createdby, createddatetime)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [entryID, Number(OrganizationID), EntryDate, UserID]
    );
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_entry_details_id'))");
    let detailID = Number((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM hlpreport_entry_details")).rows[0].id);
    for (const detail of prepared) {
      await client.query(
        `INSERT INTO hlpreport_entry_details (id, masterid, title, yod, lyod, createdby, createddatetime)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [detailID++, entryID, titleByID.get(detail.MasterID), detail.YOD, detail.LYOD, UserID]
      );
    }
    await client.query("COMMIT");
    return { success: true, message: "HLP report created successfully", data: { ID: entryID, EntryDate: formatDate(EntryDate) } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create HLP Report Error:", error.message);
    if (error.code === "23505") return fail("An HLP report already exists for the selected organization and date.", 409);
    return retryableDatabaseResponse(error) || fail("Unable to create HLP report at this time.", 503);
  } finally { client.release(); }
};

const updateReport = async (data) => {
  const { UserID, ID, Details } = data;
  if (!positiveInteger(ID)) return fail("HLP report ID must be a positive integer");
  if (!Array.isArray(Details) || Details.length === 0) return fail("Details must be a non-empty array");
  const protectedFields = ["OrganizationID", "EntryDate", "CreatedBy", "CreatedDateTime", "ModifyBy", "ModifyDateTime"];
  if (protectedFields.some((field) => Object.prototype.hasOwnProperty.call(data, field))) return fail("Organization, date, and audit fields cannot be changed through the HLP report update API");

  const prepared = [];
  const ids = new Set();
  try {
    for (const detail of Details) {
      if (!detail || !positiveInteger(detail.MasterID)) return fail("Each detail must contain a valid MasterID");
      const masterID = Number(detail.MasterID);
      if (ids.has(masterID)) return fail(`Duplicate MasterID is not allowed: ${masterID}`);
      if (["Title", "CreatedBy", "CreatedDateTime", "ModifyBy", "ModifyDateTime"].some((field) => Object.prototype.hasOwnProperty.call(detail, field))) {
        return fail("Detail titles and audit fields cannot be supplied by the client");
      }
      ids.add(masterID);
      prepared.push({ MasterID: masterID, YOD: normalizeValue(detail.YOD, "YOD"), LYOD: normalizeValue(detail.LYOD, "LYOD") });
    }
  } catch (error) { return fail(error.message, error.statusCode || 400); }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entry = await client.query(
      "SELECT id, organizationid FROM hlpreport_entry_master WHERE id = $1 FOR UPDATE",
      [Number(ID)]
    );
    if (!entry.rowCount) { await client.query("ROLLBACK"); return fail("HLP report not found", 404); }
    const denied = await validateOrganization(client, UserID, entry.rows[0].organizationid);
    if (denied) { await client.query("ROLLBACK"); return denied; }

    const masterResult = await client.query(
      "SELECT id, title FROM hlpreport_master_list WHERE id = ANY($1::bigint[]) AND isactive = TRUE",
      [[...ids]]
    );
    const titleByID = new Map(masterResult.rows.map((row) => [Number(row.id), row.title]));
    const invalidID = [...ids].find((masterID) => !titleByID.has(masterID));
    if (invalidID) { await client.query("ROLLBACK"); return fail(`Invalid HLP report MasterID: ${invalidID}`); }

    await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_entry_details_id'))");
    let nextDetailID = Number((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM hlpreport_entry_details")).rows[0].id);
    for (const detail of prepared) {
      const title = titleByID.get(detail.MasterID);
      const updated = await client.query(
        `UPDATE hlpreport_entry_details
            SET yod = $1, lyod = $2, modifyby = $3, modifydatetime = CURRENT_TIMESTAMP
          WHERE masterid = $4 AND title = $5`,
        [detail.YOD, detail.LYOD, UserID, Number(ID), title]
      );
      if (!updated.rowCount) {
        await client.query(
          `INSERT INTO hlpreport_entry_details
             (id, masterid, title, yod, lyod, createdby, createddatetime, modifyby, modifydatetime)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $6, CURRENT_TIMESTAMP)`,
          [nextDetailID++, Number(ID), title, detail.YOD, detail.LYOD, UserID]
        );
      }
    }
    await client.query(
      `UPDATE hlpreport_entry_master
          SET modifyby = $1, modifydatetime = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [UserID, Number(ID)]
    );
    await client.query("COMMIT");
    return { success: true, message: "HLP report updated successfully", data: { ID: Number(ID) } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update HLP Report Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to update HLP report at this time.", 503);
  } finally { client.release(); }
};

const numericValue = (value) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value).trim()) && Number.isFinite(Number(value));
const getMonthlyReport = async ({ OrganizationID, Year, Month }) => {
  const year = Number(Year); const month = Number(Month);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return fail("Year must be between 1 and 9999");
  if (!Number.isInteger(month) || month < 1 || month > 12) return fail("Month must be between 1 and 12");
  const client = await pool.connect();
  try {
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "" && !positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
    const masters = (await getMasterRows(client, false)).rows;
    const queryValues = [year, month];
    const organizationClause = OrganizationID === undefined || OrganizationID === null || String(OrganizationID).trim() === ""
      ? "" : `AND em.organizationid = $${queryValues.push(Number(OrganizationID))}`;
    const values = await client.query(
      `SELECT EXTRACT(DAY FROM em.entrydate)::int AS day, d.title AS "Title", d.yod AS "YOD"
         FROM hlpreport_entry_master em
         JOIN hlpreport_entry_details d ON d.masterid = em.id
        WHERE em.entrydate >= make_date($1, $2, 1)
          AND em.entrydate < make_date($1, $2, 1) + INTERVAL '1 month'
          ${organizationClause}`,
      queryValues
    );
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const byTitle = new Map(values.rows.map((row) => [`${row.Title}|${row.day}`, row.YOD]));
    const historicalTitles = new Set(values.rows.map((row) => row.Title));
    const rows = masters.filter((master) => master.IsActive || historicalTitles.has(master.Title)).map((master) => {
      const row = { ID: master.ID, Title: master.Title }; const populated = [];
      for (let day = 1; day <= days; day += 1) {
        const value = byTitle.has(`${master.Title}|${day}`) ? byTitle.get(`${master.Title}|${day}`) : null;
        row[String(day)] = value;
        if (value !== null && value !== undefined && String(value).trim() !== "") populated.push(value);
      }
      row.Total = populated.every(numericValue) ? populated.reduce((sum, value) => sum + Number(value), 0) : null;
      return row;
    });
    return { success: true, message: "HLP monthly report fetched successfully", data: rows };
  } catch (error) {
    console.error("Get HLP Monthly Report Error:", error.message);
    return fail("Unable to fetch HLP monthly report at this time.", 503);
  } finally { client.release(); }
};

const getLastYearReport = async ({ OrganizationID, EntryDate }) => {
  if (!isRealDate(EntryDate)) return fail("EntryDate must be a valid date in YYYY-MM-DD format");
  const client = await pool.connect();
  try {
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "" && !positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
    const queryValues = [EntryDate];
    const organizationClause = OrganizationID === undefined || OrganizationID === null || String(OrganizationID).trim() === ""
      ? "" : `AND organizationid = $${queryValues.push(Number(OrganizationID))}`;
    const entry = await client.query(
      `SELECT id FROM hlpreport_entry_master WHERE entrydate = $1 ${organizationClause} ORDER BY id LIMIT 1`,
      queryValues
    );
    if (!entry.rowCount) return fail("HLP report was not found for the selected date.", 404);
    const result = await client.query(
      `SELECT ml.id AS "MasterID", d.title AS "Title", d.yod AS "YOD", d.lyod AS "LYOD"
         FROM hlpreport_entry_details d
         LEFT JOIN LATERAL (
           SELECT id, orderby FROM hlpreport_master_list
            WHERE title = d.title ORDER BY isactive DESC, id DESC LIMIT 1
         ) ml ON TRUE
        WHERE d.masterid = $1
        ORDER BY ml.orderby NULLS LAST, ml.id NULLS LAST, d.id`,
      [entry.rows[0].id]
    );
    return { success: true, message: "HLP last-year report fetched successfully", data: { ID: Number(entry.rows[0].id), EntryDate: formatDate(EntryDate), Details: result.rows } };
  } catch (error) {
    console.error("Get HLP Last Year Report Error:", error.message);
    return fail("Unable to fetch HLP last-year report at this time.", 503);
  } finally { client.release(); }
};

module.exports = { getMasterList, createMasterField, updateMasterField, deleteMasterField, createReport, updateReport, getMonthlyReport, getLastYearReport, isRealDate, numericValue };
