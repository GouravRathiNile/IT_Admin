const { pool } = require("../../db");
const { formatDate } = require("../../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");
const { generatePdf } = require("../../utils/pdfHelper");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");
const safeOrganizationLogoUrl = (blobName) => {
  if (!blobName) return null;
  try { return generateOrganizationLogoUrl(blobName); } catch (_error) { return null; }
};

const hlpColumns = (withSerial = false) => [
  ...(withSerial ? [{ key: "Serial", header: "Sr. No.", width: 42, align: "center" }] : []),
  { key: "Title", header: "Title", width: "*", align: "left", noWrap: false },
  { key: "YOD", header: "Yesterday (YOD)", width: 105, align: "center" },
  { key: "LYOD", header: "Last Year Same Day (LYOD)", width: 140, align: "center" },
];

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
  `SELECT id AS "ID", title AS "Title", orderby AS "OrderBy"
          ${activeOnly ? "" : ', isactive AS "IsActive"'}
     FROM hlpreport_master_list
    ${activeOnly ? "WHERE isactive = TRUE" : ""}
    ORDER BY orderby NULLS LAST, id`
);

const getMasterList = async () => {
  const client = await pool.connect();
  try {
    const result = await getMasterRows(client);
    return {
      success: true,
      message: "HLP report master list fetched successfully",
      data: result.rows.map((row) => ({ ...row, YOD: "", LYOD: "" })),
    };
  } catch (error) {
    console.error("Get HLP Master List Error:", error.message);
    return fail("Unable to fetch HLP master list at this time.", 503);
  } finally { client.release(); }
};

const masterAuditFields = ["CreatedBy", "CreatedDateTime", "ModifyBy", "ModifyDateTime"];
const hasUnexpectedFields = (data, allowed) => Object.keys(data).some((field) => !allowed.includes(field));

const createMasterField = async (data) => {
  const title = typeof data.Title === "string" ? data.Title.trim() : "";
  if (!title) return fail("Title is required");
  if (masterAuditFields.some((field) => Object.prototype.hasOwnProperty.call(data, field))) return fail("Audit fields cannot be supplied by the client");
  if (hasUnexpectedFields(data, ["Title", "UserID"])) return fail("Only Title can be supplied when creating an HLP master field");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_master_list_order'))");
    await client.query("UPDATE hlpreport_master_list SET orderby = NULL WHERE isactive = FALSE AND orderby IS NOT NULL");
    const id = Number((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM hlpreport_master_list")).rows[0].id);
    const orderBy = Number((await client.query("SELECT COALESCE(MAX(orderby), 0) + 1 AS orderby FROM hlpreport_master_list WHERE isactive = TRUE")).rows[0].orderby);
    const result = await client.query(
      `INSERT INTO hlpreport_master_list (id, title, orderby, isactive, createdby, createddatetime)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       RETURNING id AS "ID", title AS "Title", orderby AS "OrderBy"`,
      [id, title, orderBy, true, data.UserID]
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
  if (hasUnexpectedFields(data, ["ID", "Title", "UserID"])) return fail("Only ID and Title can be supplied when updating an HLP master field");
  const title = typeof data.Title === "string" ? data.Title.trim() : "";
  if (!title) return fail("Title is required");
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE hlpreport_master_list
       SET title = $1, modifyby = $2, modifydatetime = CURRENT_TIMESTAMP
       WHERE id = $3 AND isactive = TRUE
       RETURNING id AS "ID", title AS "Title", orderby AS "OrderBy"`, [title, data.UserID, Number(data.ID)]
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
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_master_list_order'))");
    const result = await client.query(
      `UPDATE hlpreport_master_list SET isactive = FALSE, orderby = NULL, modifyby = $1, modifydatetime = CURRENT_TIMESTAMP
        WHERE id = $2 RETURNING id AS "ID"`, [data.UserID, Number(data.ID)]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return fail("HLP master field not found", 404); }
    await client.query("UPDATE hlpreport_master_list SET orderby = -orderby WHERE isactive = TRUE");
    await client.query(
      `WITH ordered AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY orderby DESC NULLS LAST, id)::integer AS new_order
         FROM hlpreport_master_list WHERE isactive = TRUE
       )
       UPDATE hlpreport_master_list ml SET orderby = ordered.new_order
       FROM ordered WHERE ml.id = ordered.id`
    );
    await client.query("COMMIT");
    return { success: true, message: "HLP master field deactivated successfully", data: result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
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
const hasMonthlyReportData = (rows) => (rows || []).some((row) => Object.entries(row).some(([key, value]) =>
  !["ID", "Title", "Total"].includes(key) && value !== null && value !== undefined && String(value).trim() !== ""
));
const getMonthlyReport = async ({ OrganizationID, OrganizationIDs, Year, Month }) => {
  const year = Number(Year); const month = Number(Month);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return fail("Year must be between 1 and 9999");
  if (!Number.isInteger(month) || month < 1 || month > 12) return fail("Month must be between 1 and 12");
  const client = await pool.connect();
  try {
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "" && !positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
    const masters = (await getMasterRows(client, false)).rows;
    const queryValues = [year, month];
    let organizationClause = "";
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "") {
      organizationClause = `AND em.organizationid = $${queryValues.push(Number(OrganizationID))}`;
    } else if (Array.isArray(OrganizationIDs)) {
      organizationClause = `AND em.organizationid = ANY($${queryValues.push(OrganizationIDs.map(Number))}::bigint[])`;
    }
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

const getLastYearReport = async ({ OrganizationID, OrganizationIDs, EntryDate }) => {
  if (!isRealDate(EntryDate)) return fail("EntryDate must be a valid date in YYYY-MM-DD format");
  const client = await pool.connect();
  try {
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "" && !positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
    const queryValues = [EntryDate];
    let organizationClause = "";
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "") {
      organizationClause = `AND organizationid = $${queryValues.push(Number(OrganizationID))}`;
    } else if (Array.isArray(OrganizationIDs)) {
      organizationClause = `AND organizationid = ANY($${queryValues.push(OrganizationIDs.map(Number))}::bigint[])`;
    }
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

const generateReportPdf = async ({ UserID, ID }) => {
  if (!positiveInteger(ID)) return fail("HLP report ID must be a positive integer");
  const client = await pool.connect();
  try {
    const entry = await client.query(
      `SELECT em.id, em.organizationid, em.entrydate, em.createdby, em.createddatetime,
              em.modifyby, em.modifydatetime, om.organizationname, logo.logoname,
              COALESCE(NULLIF(creator.fullname, ''), creator.username, em.createdby::text) AS createdbyname
         FROM hlpreport_entry_master em
         LEFT JOIN organization_master om ON om.organizationid = em.organizationid
         LEFT JOIN user_master creator ON creator.userid = em.createdby
         LEFT JOIN LATERAL (
           SELECT logoname FROM organization_master_logo
            WHERE organizationid = em.organizationid AND isdeleted = FALSE
            ORDER BY logoid LIMIT 1
         ) logo ON TRUE
        WHERE em.id = $1`,
      [Number(ID)]
    );
    if (!entry.rowCount) return fail("HLP report not found", 404);
    const record = entry.rows[0];
    const denied = await validateOrganization(client, UserID, record.organizationid);
    if (denied) return denied;
    const details = await client.query(
      `SELECT title AS "Title", yod AS "YOD", lyod AS "LYOD"
         FROM hlpreport_entry_details
        WHERE masterid = $1
        ORDER BY id`,
      [Number(ID)]
    );
    const buffer = await generatePdf({
      title: "HLP REPORT", reportName: "HLP Report", organizationId: record.organizationid,
      logoUrl: safeOrganizationLogoUrl(record.logoname),
      metadata: [
        { label: "Report ID", value: Number(record.id) }, { label: "Organization", value: record.organizationname },
        { label: "Entry Date", value: formatDate(record.entrydate) }, { label: "Created By", value: record.createdbyname },
      ],
      columns: hlpColumns(true), rows: details.rows.map((row, index) => ({ ...row, Serial: index + 1 })),
    });
    return {
      success: true,
      message: "HLP report PDF generated successfully",
      pdfBase64: buffer.toString("base64"),
      filename: `HLP-Report-${Number(ID)}.pdf`,
    };
  } catch (error) {
    console.error("Generate HLP Report PDF Error:", error.message);
    return fail("Unable to generate HLP report PDF at this time.", 503);
  } finally { client.release(); }
};

const reportOrganizationMetadata = async (organizationID) => {
  if (organizationID === undefined || organizationID === null || String(organizationID).trim() === "") return { Name: "All Organizations", LogoUrl: null };
  const result = await pool.query(
    `SELECT om.organizationname, logo.logoname
       FROM organization_master om
       LEFT JOIN LATERAL (
         SELECT logoname FROM organization_master_logo
          WHERE organizationid = om.organizationid AND isdeleted = FALSE
          ORDER BY logoid LIMIT 1
       ) logo ON TRUE
      WHERE om.organizationid = $1 LIMIT 1`,
    [Number(organizationID)]
  );
  const row = result.rows[0];
  return { Name: row?.organizationname || null, LogoUrl: safeOrganizationLogoUrl(row?.logoname) };
};

const reorderMasterFields = async (data) => {
  if (hasUnexpectedFields(data, ["items", "UserID"])) return fail("Only items can be supplied for HLP master field reorder");
  if (!Array.isArray(data.items) || data.items.length === 0) return fail("items must be a non-empty array");
  const ids = new Set(); const orders = new Set();
  for (const item of data.items) {
    if (!item || hasUnexpectedFields(item, ["ID", "OrderBy"]) || !positiveInteger(item.ID)) return fail("Each reorder item must contain a valid ID");
    if (!positiveInteger(item.OrderBy)) return fail("Each reorder item must contain a valid OrderBy");
    if (ids.has(Number(item.ID))) return fail(`Duplicate HLP master field ID is not allowed: ${item.ID}`);
    if (orders.has(Number(item.OrderBy))) return fail(`Duplicate OrderBy is not allowed: ${item.OrderBy}`);
    ids.add(Number(item.ID)); orders.add(Number(item.OrderBy));
  }
  if ([...orders].sort((a, b) => a - b).some((order, index) => order !== index + 1)) return fail("OrderBy values must be a continuous sequence starting from 1");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_master_list_order'))");
    await client.query("UPDATE hlpreport_master_list SET orderby = NULL WHERE isactive = FALSE AND orderby IS NOT NULL");
    const current = await client.query("SELECT id FROM hlpreport_master_list WHERE isactive = TRUE ORDER BY id FOR UPDATE");
    const currentIDs = current.rows.map((row) => Number(row.id));
    if (currentIDs.length !== ids.size || currentIDs.some((id) => !ids.has(id))) {
      await client.query("ROLLBACK");
      return fail("items must contain the complete active HLP master list with valid IDs");
    }
    await client.query("UPDATE hlpreport_master_list SET orderby = -id WHERE isactive = TRUE");
    const orderedItems = [...data.items].sort((a, b) => Number(a.OrderBy) - Number(b.OrderBy));
    await client.query(
      `UPDATE hlpreport_master_list ml SET orderby = ordering.orderby,
         modifyby = $3, modifydatetime = CURRENT_TIMESTAMP
       FROM unnest($1::bigint[], $2::integer[]) AS ordering(id, orderby)
       WHERE ml.id = ordering.id AND ml.isactive = TRUE`,
      [orderedItems.map((item) => Number(item.ID)), orderedItems.map((item) => Number(item.OrderBy)), data.UserID]
    );
    await client.query("COMMIT");
    return { success: true, message: "HLP master fields reordered successfully" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Reorder HLP Master Fields Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to reorder HLP master fields at this time.", 503);
  } finally { client.release(); }
};

const generateMonthlyReportPdf = async (data) => {
  try {
    const report = await getMonthlyReport(data);
    if (!report.success) return report;
    const rows = report.data || [];
    if (!hasMonthlyReportData(rows)) return fail("No HLP monthly report data found.", 404);
    const organization = await reportOrganizationMetadata(data.OrganizationID);
    const days = new Date(Date.UTC(Number(data.Year), Number(data.Month), 0)).getUTCDate();
    const dayWidth = Math.min(20, Math.floor((826 - 68 - 34 - ((days + 2) * 2) - 18) / days));
    const wrapTitle = (row) => {
      const title = String(row.Title || "-"); if (title.length <= 14 || !title.includes(" ")) return title;
      const words = title.split(/\s+/); let split = 1; let distance = Infinity;
      for (let i = 1; i < words.length; i += 1) { const next = Math.abs(words.slice(0, i).join(" ").length - title.length / 2); if (next < distance) { distance = next; split = i; } }
      return `${words.slice(0, split).join(" ")}\n${words.slice(split).join(" ")}`;
    };
    const buffer = await generatePdf({
      title: "HLP MONTHLY REPORT", reportName: "HLP Monthly Report", orientation: "landscape",
      logoUrl: organization.LogoUrl, pageMargins: [8, 18, 8, 32],
      metadata: [{ label: "Organization", value: organization.Name }, { label: "Month", value: formatDate(`${data.Year}-${String(data.Month).padStart(2, "0")}-01`, "MMMM YYYY") }],
      columns: [
        { key: "Title", header: "Title", width: 68, align: "left", value: wrapTitle, noWrap: false, style: "monthlyTitle" },
        ...Array.from({ length: days }, (_, index) => ({ key: String(index + 1), header: String(index + 1), width: dayWidth, align: "center" })),
        { key: "Total", header: "Total", width: 34, align: "center", bold: true },
      ], rows,
      styles: { pdfTableHeader: { fontSize: 7, bold: true, color: "#FFFFFF" }, pdfTableCell: { fontSize: 7 }, monthlyTitle: { fontSize: 7, bold: true, lineHeight: 1 } },
      tableOptions: { layout: { fillColor: (row) => row === 0 ? "#082B5C" : "#FFFFFF", paddingLeft: () => 1, paddingRight: () => 1, paddingTop: () => 3, paddingBottom: () => 3 }, table: { keepWithHeaderRows: 1 } },
    });
    const period = `${String(data.Year).padStart(4, "0")}-${String(data.Month).padStart(2, "0")}`;
    return {
      success: true, message: "HLP monthly report PDF generated successfully",
      pdfBase64: buffer.toString("base64"), filename: `HLP-Monthly-Report-${period}.pdf`,
    };
  } catch (error) {
    console.error("Generate HLP Monthly Report PDF Error:", error.message);
    return fail("Unable to generate HLP monthly report PDF at this time.", 503);
  }
};

const generateLastYearReportPdf = async (data) => {
  try {
    const report = await getLastYearReport(data);
    if (!report.success) return report;
    const organization = await reportOrganizationMetadata(data.OrganizationID);
    const buffer = await generatePdf({
      title: "HLP LAST YEAR SAME DAY REPORT", reportName: "HLP Last Year Report", logoUrl: organization.LogoUrl,
      metadata: [{ label: "Organization", value: organization.Name }, { label: "Entry Date", value: formatDate(data.EntryDate) }],
      columns: hlpColumns(false).map((column) => column.key === "Title" ? column : { ...column, width: column.key === "YOD" ? 120 : 150 }),
      rows: report.data?.Details || [],
    });
    const period = String(data.EntryDate).slice(0, 7);
    return {
      success: true, message: "HLP last-year report PDF generated successfully",
      pdfBase64: buffer.toString("base64"), filename: `HLP-Last-Year-Report-${period}.pdf`,
    };
  } catch (error) {
    console.error("Generate HLP Last Year Report PDF Error:", error.message);
    return fail("Unable to generate HLP last-year report PDF at this time.", 503);
  }
};

module.exports = { getMasterList, createMasterField, updateMasterField, reorderMasterFields, deleteMasterField, createReport, updateReport, getMonthlyReport, getLastYearReport, generateReportPdf, generateMonthlyReportPdf, generateLastYearReportPdf, isRealDate, numericValue, hasMonthlyReportData };
