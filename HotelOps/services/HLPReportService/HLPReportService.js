const { pool } = require("../../db");
const { formatDate } = require("../../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");
const { generatePdf } = require("../../utils/pdfHelper");
const { generateCSV, generateExcel } = require("../../utils/exportHelper");
const ExcelJS = require("exceljs");
const { Readable } = require("stream");
const generateOrganizationLogoUrl = require("../../AzurConfigration/ITAdmin/OrganizationMaster/AzureGetData");
// Missing logo configuration must not prevent an otherwise valid PDF.
const safeOrganizationLogoUrl = (blobName) => {
  if (!blobName) return null;
  try { return generateOrganizationLogoUrl(blobName); } catch (_error) { return null; }
};

// Shared column definition for HLP detail/comparison PDF tables.
const hlpColumns = (withSerial = false) => [
  ...(withSerial ? [{ key: "Serial", header: "Sr. No.", width: 42, align: "center" }] : []),
  { key: "Title", header: "Title", width: "*", align: "left", noWrap: false },
  { key: "YOD", header: "Yesterday (YOD)", width: 105, align: "center" },
  { key: "LYOD", header: "Last Year Same Day (LYOD)", width: 140, align: "center" },
];

const fail = (message, statusCode = 400) => ({ success: false, statusCode, message });
const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
// Validate the actual calendar date instead of allowing Date normalization.
const isRealDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
// Empty metric values become null; populated YOD/LYOD values remain text snapshots.
const normalizeValue = (value, field) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > 30) throw Object.assign(new Error(`${field} must not exceed 30 characters`), { statusCode: 400 });
  return normalized;
};

// Enforce the authenticated user's active mapping to the selected organization.
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

// Reports may include inactive historical fields; entry screens request active fields.
const getMasterRows = (client, organizationID, activeOnly = true) => client.query(
  `SELECT id AS "ID", title AS "Title", orderby AS "OrderBy"
          ${activeOnly ? "" : ', isactive AS "IsActive"'}
     FROM hlpreport_master_list
    WHERE organizationid = $1 ${activeOnly ? "AND isactive = TRUE" : ""}
    ORDER BY orderby NULLS LAST, id`,
  [Number(organizationID)]
);

// Master-page list exposes only active field configuration in display order.
const getMasterList = async ({ UserID, OrganizationID } = {}) => {
  const client = await pool.connect();
  try {
    if (OrganizationID === undefined || OrganizationID === null || String(OrganizationID).trim() === "") {
      const organizationIDs = await getAccessibleOrganizationIDs(client, UserID);
      if (!organizationIDs.length) return fail("No active organization is assigned to the authenticated user.", 403);
      if (organizationIDs.length > 1) return fail("Please select an organization to view HLP master fields.", 400);
      [OrganizationID] = organizationIDs;
    } else if (!positiveInteger(OrganizationID)) {
      return fail("Organization ID must be a positive integer");
    }
    const denied = await validateOrganization(client, UserID, OrganizationID);
    if (denied) return denied;
    const result = await getMasterRows(client, OrganizationID);
    return {
      success: true,
      message: "HLP report master list fetched successfully",
      data: result.rows,
    };
  } catch (error) {
    console.error("Get HLP Master List Error:", error.message);
    return fail("Unable to fetch HLP master list at this time.", 503);
  } finally { client.release(); }
};

const getAccessibleOrganizationIDs = async (client, userID) => {
  const result = await client.query(
    `SELECT uom.organizationid
       FROM user_org_mapping uom
       JOIN organization_master om ON om.organizationid = uom.organizationid
      WHERE uom.userid = $1 AND uom.isactive = TRUE AND uom.isdeleted = FALSE
        AND om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
      ORDER BY uom.organizationid`,
    [userID]
  );
  return result.rows.map((row) => Number(row.organizationid));
};

// Entry-page list overlays exact-date YOD/LYOD values on active master fields.
const getHLPList = async ({ UserID, OrganizationID, EntryDate } = {}) => {
  if (EntryDate === undefined || EntryDate === null || String(EntryDate).trim() === "") return fail("Entry date is required");
  if (!positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
  if (!isRealDate(EntryDate)) return fail("EntryDate must be a valid date in YYYY-MM-DD format");
  const client = await pool.connect();
  try {
    const denied = await validateOrganization(client, UserID, OrganizationID);
    if (denied) return denied;
    const result = await client.query(
      `SELECT ml.id AS "ID", ml.title AS "Title", ml.orderby AS "OrderBy",
              COALESCE(detail.yod, '') AS "YOD", COALESCE(detail.lyod, '') AS "LYOD"
         FROM hlpreport_master_list ml
         LEFT JOIN hlpreport_entry_master em
           ON em.organizationid = $1 AND em.entrydate = $2
         LEFT JOIN LATERAL (
           SELECT d.yod, d.lyod
             FROM hlpreport_entry_details d
            WHERE d.entryid = em.id AND d.masterid = ml.id
            ORDER BY d.id DESC LIMIT 1
         ) detail ON TRUE
        WHERE ml.organizationid = $1 AND ml.isactive = TRUE
        ORDER BY ml.orderby NULLS LAST, ml.id`,
      [Number(OrganizationID), EntryDate]
    );
    return {
      success: true,
      message: "HLP list fetched successfully",
      data: result.rows.map((row) => ({ ...row, YOD: row.YOD ?? "", LYOD: row.LYOD ?? "" })),
    };
  } catch (error) {
    console.error("Get HLP List Error:", error.message);
    return fail("Unable to fetch HLP list at this time.", 503);
  } finally { client.release(); }
};

const masterAuditFields = ["CreatedBy", "CreatedDateTime", "ModifyBy", "ModifyDateTime"];
const hasUnexpectedFields = (data, allowed) => Object.keys(data).some((field) => !allowed.includes(field));

// Add a new field at the end of the active master-list ordering.
const normalizeMasterFields = (data) => {
  const source = Array.isArray(data.Fields) ? data.Fields : [{ Title: data.Title }];
  if (!source.length) return { error: fail("Fields must be a non-empty array") };
  const fields = []; const titles = new Set();
  for (const item of source) {
    if (!item || hasUnexpectedFields(item, ["Title"])) return { error: fail("Each master field must contain only Title") };
    const title = typeof item.Title === "string" ? item.Title.trim() : "";
    if (!title) return { error: fail("Each master field Title is required") };
    if (title.length > 250) return { error: fail("Master field Title must not exceed 250 characters") };
    const key = title.toLowerCase();
    if (titles.has(key)) return { error: fail(`Duplicate master field Title is not allowed: ${title}`) };
    titles.add(key); fields.push({ Title: title });
  }
  return { fields };
};

const createMasterField = async (data, options = {}) => {
  if (!positiveInteger(data.OrganizationID)) return fail("Organization ID must be a positive integer");
  if (masterAuditFields.some((field) => Object.prototype.hasOwnProperty.call(data, field))) return fail("Audit fields cannot be supplied by the client");
  if (hasUnexpectedFields(data, ["OrganizationID", "Title", "Fields", "UserID"])) return fail("Only OrganizationID and Title or Fields can be supplied when creating HLP master fields");
  if (data.Title !== undefined && data.Fields !== undefined) return fail("Supply either Title or Fields, not both");
  const normalized = normalizeMasterFields(data);
  if (normalized.error) return normalized.error;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const denied = await validateOrganization(client, data.UserID, data.OrganizationID);
    if (denied) { await client.query("ROLLBACK"); return denied; }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hlpreport_master_list_order:${Number(data.OrganizationID)}`]);
    await client.query("UPDATE hlpreport_master_list SET orderby = NULL WHERE organizationid = $1 AND isactive = FALSE AND orderby IS NOT NULL", [Number(data.OrganizationID)]);
    const duplicate = await client.query(
      `SELECT title FROM hlpreport_master_list
        WHERE organizationid = $1 AND isactive = TRUE AND LOWER(title) = ANY($2::text[])`,
      [Number(data.OrganizationID), normalized.fields.map((item) => item.Title.toLowerCase())]
    );
    if (duplicate.rowCount && !options.skipExisting) {
      await client.query("ROLLBACK");
      return fail(`Master field already exists: ${duplicate.rows[0].title}`, 409);
    }
    const existingTitles = new Set(duplicate.rows.map((row) => String(row.title).trim().toLowerCase()));
    const fieldsToCreate = options.skipExisting
      ? normalized.fields.filter((item) => !existingTitles.has(item.Title.toLowerCase()))
      : normalized.fields;
    if (!fieldsToCreate.length) {
      await client.query("COMMIT");
      return {
        success: true,
        message: "All imported HLP master fields already exist. No new fields were added.",
        data: [],
      };
    }
    let orderBy = Number((await client.query("SELECT COALESCE(MAX(orderby), 0) + 1 AS orderby FROM hlpreport_master_list WHERE organizationid = $1 AND isactive = TRUE", [Number(data.OrganizationID)])).rows[0].orderby);
    const created = [];
    for (const field of fieldsToCreate) {
      const result = await client.query(
        `INSERT INTO hlpreport_master_list (organizationid, title, orderby, isactive, createdby, createddatetime)
         VALUES ($1, $2, $3, TRUE, $4, CURRENT_TIMESTAMP)
         RETURNING id AS "ID", title AS "Title", orderby AS "OrderBy"`,
        [Number(data.OrganizationID), field.Title, orderBy++, data.UserID]
      );
      created.push(result.rows[0]);
    }
    await client.query("COMMIT");
    const skippedCount = normalized.fields.length - fieldsToCreate.length;
    const message = options.skipExisting
      ? `HLP master fields imported successfully. ${created.length} added, ${skippedCount} skipped.`
      : (created.length === 1 ? "HLP master field created successfully" : "HLP master fields created successfully");
    return { success: true, message, data: created.length === 1 && !Array.isArray(data.Fields) ? created[0] : created };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create HLP Master Field Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to create HLP master field at this time.", 503);
  } finally { client.release(); }
};

// Rename one active master field while deriving modification audit server-side.
const updateMasterField = async (data) => {
  if (!positiveInteger(data.ID)) return fail("HLP master field ID must be a positive integer");
  if (masterAuditFields.some((field) => Object.prototype.hasOwnProperty.call(data, field))) return fail("Audit fields cannot be supplied by the client");
  if (hasUnexpectedFields(data, ["ID", "Title", "UserID"])) return fail("Only ID and Title can be supplied when updating an HLP master field");
  const title = typeof data.Title === "string" ? data.Title.trim() : "";
  if (!title) return fail("Title is required");
  const client = await pool.connect();
  try {
    const field = await client.query(
      "SELECT organizationid FROM hlpreport_master_list WHERE id = $1 AND isactive = TRUE LIMIT 1",
      [Number(data.ID)]
    );
    if (!field.rowCount) return fail("HLP master field not found", 404);
    const organizationID = Number(field.rows[0].organizationid);
    const denied = await validateOrganization(client, data.UserID, organizationID);
    if (denied) return denied;
    const duplicate = await client.query(
      `SELECT 1 FROM hlpreport_master_list
        WHERE organizationid = $1 AND isactive = TRUE AND LOWER(title) = LOWER($2) AND id <> $3 LIMIT 1`,
      [organizationID, title, Number(data.ID)]
    );
    if (duplicate.rowCount) return fail(`Master field already exists: ${title}`, 409);
    const result = await client.query(
      `UPDATE hlpreport_master_list
       SET title = $1, modifyby = $2, modifydatetime = CURRENT_TIMESTAMP
       WHERE id = $3 AND organizationid = $4 AND isactive = TRUE
       RETURNING id AS "ID", title AS "Title", orderby AS "OrderBy"`, [title, data.UserID, Number(data.ID), organizationID]
    );
    if (!result.rowCount) return fail("HLP master field not found", 404);
    return { success: true, message: "HLP master field updated successfully", data: result.rows[0] };
  } catch (error) {
    console.error("Update HLP Master Field Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to update HLP master field at this time.", 503);
  } finally { client.release(); }
};

// Soft-deactivate a field and compact the remaining active display order.
const deleteMasterField = async (data) => {
  if (!positiveInteger(data.ID)) return fail("HLP master field ID must be a positive integer");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const field = await client.query(
      "SELECT organizationid FROM hlpreport_master_list WHERE id = $1 AND isactive = TRUE FOR UPDATE",
      [Number(data.ID)]
    );
    if (!field.rowCount) { await client.query("ROLLBACK"); return fail("HLP master field not found", 404); }
    const organizationID = Number(field.rows[0].organizationid);
    const denied = await validateOrganization(client, data.UserID, organizationID);
    if (denied) { await client.query("ROLLBACK"); return denied; }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hlpreport_master_list_order:${organizationID}`]);
    const result = await client.query(
      `UPDATE hlpreport_master_list SET isactive = FALSE, orderby = NULL, modifyby = $1, modifydatetime = CURRENT_TIMESTAMP
        WHERE id = $2 AND organizationid = $3 AND isactive = TRUE RETURNING id AS "ID"`, [data.UserID, Number(data.ID), organizationID]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return fail("HLP master field not found", 404); }
    await client.query("UPDATE hlpreport_master_list SET orderby = -orderby WHERE organizationid = $1 AND isactive = TRUE", [organizationID]);
    await client.query(
      `WITH ordered AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY orderby DESC NULLS LAST, id)::integer AS new_order
         FROM hlpreport_master_list WHERE organizationid = $1 AND isactive = TRUE
       )
       UPDATE hlpreport_master_list ml SET orderby = ordered.new_order
       FROM ordered WHERE ml.id = ordered.id`, [organizationID]
    );
    await client.query("COMMIT");
    return { success: true, message: "HLP master field deactivated successfully", data: result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Deactivate HLP Master Field Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to deactivate HLP master field at this time.", 503);
  } finally { client.release(); }
};

// Transactional create-or-update keyed by OrganizationID + EntryDate.
// EntryID links a detail to its report; MasterID links it to master configuration.
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
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`hlp_report:${Number(OrganizationID)}:${EntryDate}`]
    );
    const existing = await client.query(
      "SELECT id FROM hlpreport_entry_master WHERE organizationid = $1 AND entrydate = $2 LIMIT 1 FOR UPDATE",
      [Number(OrganizationID), EntryDate]
    );

    const masterResult = await client.query(
      `SELECT id, title FROM hlpreport_master_list
        WHERE id = ANY($1::bigint[]) AND organizationid = $2 AND isactive = TRUE`,
      [[...ids], Number(OrganizationID)]
    );
    const titleByID = new Map(masterResult.rows.map((row) => [Number(row.id), row.title]));
    const invalidID = [...ids].find((id) => !titleByID.has(id));
    if (invalidID) { await client.query("ROLLBACK"); return fail(`Invalid HLP report MasterID: ${invalidID}`); }

    if (existing.rowCount) {
      const entryID = Number(existing.rows[0].id);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('hlpreport_entry_details_id'))");
      let nextDetailID = Number((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM hlpreport_entry_details")).rows[0].id);
      for (const detail of prepared) {
        const title = titleByID.get(detail.MasterID);
        const updated = await client.query(
          `UPDATE hlpreport_entry_details
              SET yod = $1, lyod = $2, modifyby = $3, modifydatetime = CURRENT_TIMESTAMP
            WHERE entryid = $4 AND masterid = $5`,
          [detail.YOD, detail.LYOD, UserID, entryID, detail.MasterID]
        );
        if (!updated.rowCount) {
          await client.query(
            `INSERT INTO hlpreport_entry_details
               (id, entryid, masterid, title, yod, lyod, createdby, createddatetime, modifyby, modifydatetime)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP)`,
            [nextDetailID++, entryID, detail.MasterID, title, detail.YOD, detail.LYOD, UserID]
          );
        }
      }
      await client.query(
        `UPDATE hlpreport_entry_master
            SET modifyby = $1, modifydatetime = CURRENT_TIMESTAMP
          WHERE id = $2`,
        [UserID, entryID]
      );
      await client.query("COMMIT");
      return {
        success: true,
        message: "HLP report updated successfully",
        data: { ID: entryID, EntryDate: formatDate(EntryDate) },
        _httpStatus: 200,
      };
    }

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
        `INSERT INTO hlpreport_entry_details (id, entryid, masterid, title, yod, lyod, createdby, createddatetime)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [detailID++, entryID, detail.MasterID, titleByID.get(detail.MasterID), detail.YOD, detail.LYOD, UserID]
      );
    }
    await client.query("COMMIT");
    return { success: true, message: "HLP report created successfully", data: { ID: entryID, EntryDate: formatDate(EntryDate) } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create HLP Report Error:", error.message);
    if (error.code === "23505") return fail("Unable to save HLP report because it was changed concurrently. Please try again.", 409);
    return retryableDatabaseResponse(error) || fail("Unable to create HLP report at this time.", 503);
  } finally { client.release(); }
};

// Backward-compatible ID-based partial update that preserves omitted details.
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
      "SELECT id, title FROM hlpreport_master_list WHERE id = ANY($1::bigint[]) AND organizationid = $2 AND isactive = TRUE",
      [[...ids], Number(entry.rows[0].organizationid)]
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
          WHERE entryid = $4 AND masterid = $5`,
        [detail.YOD, detail.LYOD, UserID, Number(ID), detail.MasterID]
      );
      if (!updated.rowCount) {
        await client.query(
          `INSERT INTO hlpreport_entry_details
             (id, entryid, masterid, title, yod, lyod, createdby, createddatetime, modifyby, modifydatetime)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP)`,
          [nextDetailID++, Number(ID), detail.MasterID, title, detail.YOD, detail.LYOD, UserID]
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
// Pivot stored daily YOD values into one row per title and one column per month day.
const getMonthlyReport = async ({ UserID, OrganizationID, OrganizationIDs, Year, Month }, valueField = "YOD") => {
  // valueField is internal-only and restricted to stored HLP day-value columns.
  const reportValueField = valueField === "LYOD" ? "lyod" : "yod";
  const year = Number(Year); const month = Number(Month);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return fail("Year must be between 1 and 9999");
  if (!Number.isInteger(month) || month < 1 || month > 12) return fail("Month must be between 1 and 12");
  const client = await pool.connect();
  try {
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "" && !positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "") {
      const denied = await validateOrganization(client, UserID, OrganizationID);
      if (denied) return denied;
    } else if (!Array.isArray(OrganizationIDs)) {
      OrganizationIDs = await getAccessibleOrganizationIDs(client, UserID);
      if (!OrganizationIDs.length) return fail("No active organization is assigned to the authenticated user.", 403);
    }
    const queryValues = [year, month];
    let organizationClause = "";
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "") {
      organizationClause = `AND em.organizationid = $${queryValues.push(Number(OrganizationID))}`;
    } else if (Array.isArray(OrganizationIDs)) {
      organizationClause = `AND em.organizationid = ANY($${queryValues.push(OrganizationIDs.map(Number))}::bigint[])`;
    }
    const masterOrganizationIDs = OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== ""
      ? [Number(OrganizationID)] : (Array.isArray(OrganizationIDs) ? OrganizationIDs.map(Number) : []);
    const mastersResult = masterOrganizationIDs.length
      ? await client.query(
        `SELECT DISTINCT ON (LOWER(title)) id AS "ID", title AS "Title", orderby AS "OrderBy", isactive AS "IsActive"
           FROM hlpreport_master_list
          WHERE organizationid = ANY($1::bigint[])
          ORDER BY LOWER(title), isactive DESC, orderby NULLS LAST, id`,
        [masterOrganizationIDs]
      )
      : { rows: [] };
    const masters = mastersResult.rows;
    const values = await client.query(
      `SELECT EXTRACT(DAY FROM em.entrydate)::int AS day, d.title AS "Title", d.${reportValueField} AS "Value"
         FROM hlpreport_entry_master em
         JOIN hlpreport_entry_details d ON d.entryid = em.id
        WHERE em.entrydate >= make_date($1, $2, 1)
          AND em.entrydate < make_date($1, $2, 1) + INTERVAL '1 month'
          ${organizationClause}`,
      queryValues
    );
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const byTitle = new Map(values.rows.map((row) => [`${row.Title}|${row.day}`, row.Value]));
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
    return {
      success: true,
      message: reportValueField === "lyod"
        ? "HLP last-year report fetched successfully"
        : "HLP monthly report fetched successfully",
      data: rows,
    };
  } catch (error) {
    console.error("Get HLP Monthly Report Error:", error.message);
    return fail("Unable to fetch HLP monthly report at this time.", 503);
  } finally { client.release(); }
};

// Return stored YOD/LYOD values for the exact selected date without date arithmetic.
const getLastYearReport = async ({ UserID, OrganizationID, OrganizationIDs, EntryDate }) => {
  if (!isRealDate(EntryDate)) return fail("EntryDate must be a valid date in YYYY-MM-DD format");
  const client = await pool.connect();
  try {
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "" && !positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
    if (OrganizationID !== undefined && OrganizationID !== null && String(OrganizationID).trim() !== "") {
      const denied = await validateOrganization(client, UserID, OrganizationID);
      if (denied) return denied;
    } else if (!Array.isArray(OrganizationIDs)) {
      OrganizationIDs = await getAccessibleOrganizationIDs(client, UserID);
      if (!OrganizationIDs.length) return fail("No active organization is assigned to the authenticated user.", 403);
    }
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
      `SELECT d.masterid AS "MasterID", d.title AS "Title", d.yod AS "YOD", d.lyod AS "LYOD"
         FROM hlpreport_entry_details d
         LEFT JOIN hlpreport_master_list ml ON ml.id = d.masterid AND ml.organizationid = (
           SELECT organizationid FROM hlpreport_entry_master WHERE id = $1
         )
        WHERE d.entryid = $1
        ORDER BY ml.orderby NULLS LAST, d.masterid, d.id`,
      [entry.rows[0].id]
    );
    return { success: true, message: "HLP last-year report fetched successfully", data: { ID: Number(entry.rows[0].id), EntryDate: formatDate(EntryDate), Details: result.rows } };
  } catch (error) {
    console.error("Get HLP Last Year Report Error:", error.message);
    return fail("Unable to fetch HLP last-year report at this time.", 503);
  } finally { client.release(); }
};

// Generate one report PDF after validating access to its organization.
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
        WHERE entryid = $1
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

// Resolve safe display metadata shared by the aggregate PDF outputs.
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

// Atomically replace the order of all active master fields.
const reorderMasterFields = async (data) => {
  if (hasUnexpectedFields(data, ["OrganizationID", "items", "UserID"])) return fail("Only OrganizationID and items can be supplied for HLP master field reorder");
  if (!positiveInteger(data.OrganizationID)) return fail("Organization ID must be a positive integer");
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
    const denied = await validateOrganization(client, data.UserID, data.OrganizationID);
    if (denied) { await client.query("ROLLBACK"); return denied; }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hlpreport_master_list_order:${Number(data.OrganizationID)}`]);
    await client.query("UPDATE hlpreport_master_list SET orderby = NULL WHERE organizationid = $1 AND isactive = FALSE AND orderby IS NOT NULL", [Number(data.OrganizationID)]);
    const current = await client.query("SELECT id FROM hlpreport_master_list WHERE organizationid = $1 AND isactive = TRUE ORDER BY id FOR UPDATE", [Number(data.OrganizationID)]);
    const currentIDs = current.rows.map((row) => Number(row.id));
    if (currentIDs.length !== ids.size || currentIDs.some((id) => !ids.has(id))) {
      await client.query("ROLLBACK");
      return fail("items must contain the complete active HLP master list with valid IDs");
    }
    await client.query("UPDATE hlpreport_master_list SET orderby = -id WHERE organizationid = $1 AND isactive = TRUE", [Number(data.OrganizationID)]);
    const orderedItems = [...data.items].sort((a, b) => Number(a.OrderBy) - Number(b.OrderBy));
    await client.query(
      `UPDATE hlpreport_master_list ml SET orderby = ordering.orderby,
         modifyby = $3, modifydatetime = CURRENT_TIMESTAMP
       FROM unnest($1::bigint[], $2::integer[]) AS ordering(id, orderby)
       WHERE ml.id = ordering.id AND ml.organizationid = $4 AND ml.isactive = TRUE`,
      [orderedItems.map((item) => Number(item.ID)), orderedItems.map((item) => Number(item.OrderBy)), data.UserID, Number(data.OrganizationID)]
    );
    await client.query("COMMIT");
    return { success: true, message: "HLP master fields reordered successfully" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Reorder HLP Master Fields Error:", error.message);
    return retryableDatabaseResponse(error) || fail("Unable to reorder HLP master fields at this time.", 503);
  } finally { client.release(); }
};

// Build the Last Year page with the same month/day pivot contract as MonthlyReport,
// selecting stored LYOD values instead of YOD values.
const getLastYearMonthlyReport = async (data) => getMonthlyReport(data, "LYOD");

const MASTER_EXPORT_COLUMNS = Object.freeze([
  { key: "Title", header: "Title", width: 40 },
  { key: "OrderBy", header: "OrderBy", width: 14 },
]);

// Export only the selected organization's active master configuration.
const exportMasterFields = async ({ UserID, OrganizationID, Format } = {}) => {
  const format = String(Format || "excel").trim().toLowerCase();
  if (!positiveInteger(OrganizationID)) return fail("Organization ID must be a positive integer");
  if (!['csv', 'excel'].includes(format)) return fail("Export format must be csv or excel");
  const client = await pool.connect();
  try {
    const denied = await validateOrganization(client, UserID, OrganizationID);
    if (denied) return denied;
    const rows = (await getMasterRows(client, OrganizationID)).rows;
    const buffer = format === "csv"
      ? generateCSV(rows, MASTER_EXPORT_COLUMNS)
      : await generateExcel(rows, MASTER_EXPORT_COLUMNS, "HLP Master Fields");
    return {
      success: true,
      message: "HLP master fields exported successfully",
      fileBase64: buffer.toString("base64"),
      contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `HLP-Master-Fields-${Number(OrganizationID)}.${format === "csv" ? "csv" : "xlsx"}`,
    };
  } catch (error) {
    console.error("Export HLP Master Fields Error:", error.message);
    return fail("Unable to export HLP master fields at this time.", 503);
  } finally { client.release(); }
};

const readImportedMasterFields = async (file) => {
  const filename = String(file?.originalname || "").toLowerCase();
  const mimeType = String(file?.mimetype || "").toLowerCase();
  const buffer = Buffer.from(file?.bufferBase64 || "", "base64");
  if (!buffer.length) throw Object.assign(new Error("A CSV or Excel file is required"), { statusCode: 400 });
  const workbook = new ExcelJS.Workbook();
  if (filename.endsWith(".csv") || mimeType === "text/csv") {
    if (buffer.includes(0)) throw Object.assign(new Error("The uploaded CSV file is invalid"), { statusCode: 400 });
    await workbook.csv.read(Readable.from([buffer]));
  } else if (filename.endsWith(".xlsx") || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) throw Object.assign(new Error("The uploaded XLSX file is invalid"), { statusCode: 400 });
    await workbook.xlsx.load(buffer);
  } else {
    throw Object.assign(new Error("Only CSV and XLSX files are supported"), { statusCode: 400 });
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw Object.assign(new Error("The import file does not contain a worksheet"), { statusCode: 400 });
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => headers.set(String(cell.value || "").trim().toLowerCase(), column));
  const titleColumn = headers.get("title"); const orderColumn = headers.get("orderby");
  if (!titleColumn || !orderColumn) throw Object.assign(new Error("Import file must contain Title and OrderBy columns"), { statusCode: 400 });
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const title = String(row.getCell(titleColumn).text || "").trim();
    const orderBy = Number(String(row.getCell(orderColumn).text || "").trim());
    if (!title && !row.getCell(orderColumn).text) return;
    rows.push({ Title: title, OrderBy: orderBy });
  });
  if (!rows.length) throw Object.assign(new Error("Import file does not contain any master fields"), { statusCode: 400 });
  const orders = new Set();
  for (const row of rows) {
    if (!row.Title) throw Object.assign(new Error("Every imported master field requires a Title"), { statusCode: 400 });
    if (!positiveInteger(row.OrderBy)) throw Object.assign(new Error("Every imported master field requires a valid OrderBy"), { statusCode: 400 });
    if (orders.has(row.OrderBy)) throw Object.assign(new Error(`Duplicate imported OrderBy is not allowed: ${row.OrderBy}`), { statusCode: 400 });
    orders.add(row.OrderBy);
  }
  const sorted = [...rows].sort((a, b) => a.OrderBy - b.OrderBy);
  if (sorted.some((row, index) => row.OrderBy !== index + 1)) {
    throw Object.assign(new Error("Imported OrderBy values must be a continuous sequence starting from 1"), { statusCode: 400 });
  }
  return sorted.map(({ Title }) => ({ Title }));
};

// Imported ordering is preserved relative to the target organization's list;
// createMasterField supplies new IDs and performs the insert transaction.
const importMasterFields = async (data = {}) => {
  try {
    const fields = await readImportedMasterFields(data.File);
    return createMasterField(
      { UserID: data.UserID, OrganizationID: data.OrganizationID, Fields: fields },
      { skipExisting: true }
    );
  } catch (error) {
    return fail(error.message || "Unable to import HLP master fields", error.statusCode || 400);
  }
};

// Render either YOD or LYOD monthly pivot data with the same landscape layout.
const generateMonthlyPivotPdf = async (data, lastYear = false) => {
  try {
    const report = lastYear
      ? await getLastYearMonthlyReport(data)
      : await getMonthlyReport(data);
    if (!report.success) return report;
    const rows = report.data || [];
    if (!hasMonthlyReportData(rows)) {
      return fail(lastYear ? "No HLP last-year report data found." : "No HLP monthly report data found.", 404);
    }
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
      title: lastYear ? "HLP LAST YEAR REPORT" : "HLP MONTHLY REPORT",
      reportName: lastYear ? "HLP Last Year Report" : "HLP Monthly Report",
      orientation: "landscape",
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
      success: true,
      message: lastYear ? "HLP last-year report PDF generated successfully" : "HLP monthly report PDF generated successfully",
      pdfBase64: buffer.toString("base64"),
      filename: lastYear ? `HLP-Last-Year-Report-${period}.pdf` : `HLP-Monthly-Report-${period}.pdf`,
    };
  } catch (error) {
    console.error(lastYear ? "Generate HLP Last Year Report PDF Error:" : "Generate HLP Monthly Report PDF Error:", error.message);
    return fail(lastYear ? "Unable to generate HLP last-year report PDF at this time." : "Unable to generate HLP monthly report PDF at this time.", 503);
  }
};

const generateMonthlyReportPdf = async (data) => generateMonthlyPivotPdf(data, false);
const generateLastYearReportPdf = async (data) => generateMonthlyPivotPdf(data, true);

module.exports = { getMasterList, getHLPList, createMasterField, updateMasterField, reorderMasterFields, deleteMasterField, exportMasterFields, importMasterFields, createReport, updateReport, getMonthlyReport, getLastYearMonthlyReport, getLastYearReport, generateReportPdf, generateMonthlyReportPdf, generateLastYearReportPdf, isRealDate, numericValue, hasMonthlyReportData };
