const { pool } = require("../../db");
const { SORT_COLUMNS, REPORT_SORT_COLUMNS, FIELD_AUDIT_COLUMNS } = require("../../config/guestGlitchConstants");

const COLUMN_MAP = Object.freeze({
  EntryDate: "entrydate", Status: "status", ResolvedBy: "resolvedby",
  ReceivedBy: "receivedby", InformedTo: "informedto", GuestName: "guestname",
  RoomNumber: "roomnumber", Time: "time", Complaint: "complaint",
  ServiceRecovery: "servicerecovery", DetailedInvestigation: "detailedinvestigation",
  InternalActionTaken: "internalactiontaken", CompanyName: "companyname", Rate: "rate",
  CheckInDate: "checkindate", CheckOutDate: "checkoutdate",
  GMComment: "gmcomment", ProcessLapse: "processlapse", Department: "department",
  SRA_Room: "sra_room", SRA_Food: "sra_food", SRA_Other: "sra_other",
  RaiseSource: "raisesource", ComplaintSource: "complaintsource",
  AttachmentTitle: "attachmenttitle", Attachment: "attachment", GuestStatus: "gueststatus",
  ProcessLapseCategory: "processlapsecategory",
  InternalActionTakenCategory: "internalactiontakencategory", GetMetJson: "getmetjson",
  DepartmentIDs: "departmentids", ReceivedByIDs: "receivedbyids",
  InformedToIDs: "informedtoids", DepartmentHODComments: "departmenthodcomments",
  CurrentWorkflowStage: "currentworkflowstage",
});

const JSON_FIELDS = new Set(["GetMetJson", "DepartmentIDs", "ReceivedByIDs", "InformedToIDs", "DepartmentHODComments"]);

const getClient = () => pool.connect();

const resolveOrganizations = async (userID) => {
  const result = await pool.query(
    `SELECT uom.organizationid, om.organizationname, um.usertype, um.departmentid
     FROM user_org_mapping uom
     INNER JOIN user_master um ON um.userid = uom.userid
     INNER JOIN organization_master om ON om.organizationid = uom.organizationid
     WHERE uom.userid = $1
       AND uom.isactive = TRUE AND uom.isdeleted = FALSE
       AND om.isactive = TRUE AND om.activationstatus = TRUE AND om.isdeleted = FALSE
       AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE
     ORDER BY uom.organizationid;`,
    [userID]
  );
  return result.rows;
};

const workflowVisibilitySQL = (values, data) => {
  values.push(String(data.UserID), String(data.UserType || "").trim().toUpperCase(), data.DepartmentID || null);
  const user = `$${values.length - 2}`, type = `$${values.length - 1}`, department = `$${values.length}`;
  return `(gg.createdby = ${user} OR EXISTS (
    SELECT 1 FROM guest_glitch_flow_config current_stage
    JOIN guest_glitch_flow_config reached_stage
      ON reached_stage.organizationid = current_stage.organizationid
     AND reached_stage.stageorder <= current_stage.stageorder
     AND reached_stage.isactive = TRUE AND reached_stage.isdeleted = FALSE
    JOIN guest_glitch_flow_config_detail fd ON fd.flowconfigid = reached_stage.flowconfigid
    WHERE current_stage.organizationid = gg.organizationid
      AND current_stage.stagekey = gg.currentworkflowstage
      AND current_stage.isactive = TRUE AND current_stage.isdeleted = FALSE
      AND fd.isactive = TRUE AND fd.isdeleted = FALSE AND fd.canview = TRUE
      AND ((fd.actortype = 'CREATOR' AND gg.createdby = ${user})
        OR (fd.actortype = 'USER_ID' AND fd.actorvalue = ${user})
        OR (fd.actortype = 'USER_TYPE' AND UPPER(fd.actorvalue) = ${type})
        OR (fd.actortype = 'DEPARTMENT_ID' AND fd.actorvalue = (${department})::text))
  ))`;
};

const getFirstWorkflowStage = async (client, organizationID) => {
  const result = await client.query(
    `SELECT stagekey, stagename, stageorder, isfinalstage
     FROM guest_glitch_flow_config
     WHERE organizationid = $1 AND isactive = TRUE AND isdeleted = FALSE
     ORDER BY stageorder, flowconfigid LIMIT 1;`, [organizationID]
  );
  return result.rows[0] || null;
};

const getWorkflowStageState = async (client, organizationID, stageKey) => {
  const result = await client.query(
    `SELECT fc.stagekey, fc.stagename, fc.stageorder, fc.isfinalstage,
       (SELECT n.stagekey FROM guest_glitch_flow_config n
        WHERE n.organizationid = fc.organizationid AND n.isactive = TRUE AND n.isdeleted = FALSE
          AND n.stageorder > fc.stageorder ORDER BY n.stageorder LIMIT 1) AS nextstage
     FROM guest_glitch_flow_config fc
     WHERE fc.organizationid = $1 AND fc.stagekey = $2
       AND fc.isactive = TRUE AND fc.isdeleted = FALSE LIMIT 1;`, [organizationID, stageKey]
  );
  return result.rows[0] || null;
};

const getWorkflowAccess = async (client, record, data) => {
  const result = await client.query(
    `SELECT current_stage.stagekey, current_stage.stagename, current_stage.stageorder, current_stage.isfinalstage,
       next_stage.stagekey AS nextstage,
       ($3::text = $6::text OR BOOL_OR(fd.canview)) AS canview,
       BOOL_OR(fd.canedit) AS canedit,
       BOOL_OR(fd.canproceed AND reached_stage.stagekey = current_stage.stagekey) AS canproceed,
       COALESCE(jsonb_agg(DISTINCT field.value) FILTER (WHERE field.value IS NOT NULL), '[]'::jsonb) AS editablefields,
       COALESCE(jsonb_agg(DISTINCT required.value) FILTER (WHERE required.value IS NOT NULL AND reached_stage.stagekey = current_stage.stagekey), '[]'::jsonb) AS requiredactionfields
     FROM guest_glitch_flow_config current_stage
     JOIN guest_glitch_flow_config reached_stage ON reached_stage.organizationid = current_stage.organizationid
       AND reached_stage.stageorder <= current_stage.stageorder
       AND reached_stage.isactive = TRUE AND reached_stage.isdeleted = FALSE
     JOIN guest_glitch_flow_config_detail fd ON fd.flowconfigid = reached_stage.flowconfigid
     LEFT JOIN LATERAL jsonb_array_elements_text(fd.editablefields) field(value) ON fd.canedit = TRUE
     LEFT JOIN LATERAL jsonb_array_elements_text(fd.requiredactionfields) required(value) ON fd.canproceed = TRUE AND reached_stage.stagekey = current_stage.stagekey
     LEFT JOIN LATERAL (
       SELECT n.stagekey FROM guest_glitch_flow_config n
       WHERE n.organizationid = current_stage.organizationid AND n.isactive = TRUE AND n.isdeleted = FALSE
         AND n.stageorder > current_stage.stageorder ORDER BY n.stageorder LIMIT 1
     ) next_stage ON TRUE
     WHERE current_stage.organizationid = $1 AND current_stage.stagekey = $2
       AND current_stage.isactive = TRUE AND current_stage.isdeleted = FALSE
       AND fd.isactive = TRUE AND fd.isdeleted = FALSE
       AND ((fd.actortype = 'CREATOR' AND $3::text = $6::text)
         OR (fd.actortype = 'USER_ID' AND fd.actorvalue = $3::text)
         OR (fd.actortype = 'USER_TYPE' AND UPPER(fd.actorvalue) = UPPER($4))
         OR (fd.actortype = 'DEPARTMENT_ID' AND fd.actorvalue = $5::text))
     GROUP BY current_stage.flowconfigid, next_stage.stagekey;`,
    [record.organizationid, record.currentworkflowstage, data.UserID, data.UserType || "", data.DepartmentID || null, record.createdby]
  );
  return result.rows[0] || null;
};

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
  const organizationIDs = Array.isArray(organizationID) ? organizationID : [organizationID];
  const result = await client.query(
    `SELECT * FROM guest_glitch_entry_master
     WHERE id = $1 AND organizationid = ANY($2::bigint[]) ${includeDeleted ? "" : "AND isdeleted = FALSE"}
     LIMIT 1 ${lock ? "FOR UPDATE" : ""};`,
    [id, organizationIDs]
  );
  return result.rows[0] || null;
};

// const updateChangedFields = async (client, id, organizationID, changed, userID, username, ip) => {
//   const assignments = [];
//   const values = [];
//   const add = (sql, value) => { values.push(value); assignments.push(`${sql} = $${values.length}`); };

//   for (const [field, value] of Object.entries(changed)) {
//     const column = COLUMN_MAP[field];
//     if (!column) continue;
//     add(column, JSON_FIELDS.has(field) ? JSON.stringify(value) : value);
//     const audit = FIELD_AUDIT_COLUMNS[field];
//     if (audit) {
//       add(audit[0], userID);
//       assignments.push(`${audit[1]} = CURRENT_TIMESTAMP`);
//     }
//   }
//   add("modifyby", String(userID));
//   add("updatedby", username);
//   add("modifiedip", ip);
//   assignments.push("modifydate = CURRENT_TIMESTAMP");
//   values.push(id, organizationID);
//   const result = await client.query(
//     `UPDATE guest_glitch_entry_master SET ${assignments.join(", ")}
//      WHERE id = $${values.length - 1} AND organizationid = $${values.length} AND isdeleted = FALSE
//      RETURNING id;`,
//     values
//   );
//   return result.rows[0] || null;
// };

const updateChangedFields = async (
  client,
  id,
  organizationID,
  changed,
  userID,
  username,
  ip
) => {
  const assignments = [];
  const values = [];

  const add = (sql, value) => {
    values.push(value);
    assignments.push(`${sql} = $${values.length}`);
  };

  for (const [field, value] of Object.entries(changed)) {

    // UpdatedBy is an audit field.
    // It is handled separately below from the authenticated user.
    if (field === "UpdatedBy") {
      continue;
    }

    const column = COLUMN_MAP[field];

    if (!column) continue;

    add(
      column,
      JSON_FIELDS.has(field)
        ? JSON.stringify(value)
        : value
    );

    const audit = FIELD_AUDIT_COLUMNS[field];

    if (audit) {
      add(audit[0], userID);
      assignments.push(`${audit[1]} = CURRENT_TIMESTAMP`);
    }
  }

  // Audit fields - assigned exactly once
  add("modifyby", String(userID));
  add("updatedby", username);
  add("modifiedip", ip);

  assignments.push("modifydate = CURRENT_TIMESTAMP");

  values.push(id, organizationID);

  const result = await client.query(
    `UPDATE guest_glitch_entry_master
     SET ${assignments.join(", ")}
     WHERE id = $${values.length - 1}
       AND organizationid = $${values.length}
       AND isdeleted = FALSE
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

// const list = async (data, organizationID) => {
//   const filters = ["gg.organizationid = $1", "gg.isdeleted = FALSE"];
//   const values = [organizationID];
//   const add = (condition, value) => { values.push(value); filters.push(condition.replace("?", `$${values.length}`)); };
//   if (data.search) add("(gg.guestname ILIKE ? OR gg.roomnumber ILIKE ? OR gg.complaint ILIKE ? OR gg.companyname ILIKE ?)", `%${data.search}%`);
//   if (data.search) {
//     const p = `$${values.length}`;
//     filters[filters.length - 1] = `(gg.guestname ILIKE ${p} OR gg.roomnumber ILIKE ${p} OR gg.complaint ILIKE ${p} OR gg.companyname ILIKE ${p})`;
//   }
//   if (data.fromDate) add("gg.entrydate >= ?", data.fromDate);
//   if (data.toDate) add("gg.entrydate <= ?", data.toDate);
//   const scalarFilters = { status: "gg.status", roomNumber: "gg.roomnumber", complaint: "gg.complaint", guestStatus: "gg.gueststatus", companyName: "gg.companyname", complaintSource: "gg.complaintsource", raiseSource: "gg.raisesource", createdBy: "gg.createdby", updatedBy: "gg.updatedby" };
//   for (const [field, column] of Object.entries(scalarFilters)) if (data[field]) add(`${column} ILIKE ?`, `%${data[field]}%`);
//   for (const [field, column] of [["departmentIds", "departmentids"], ["receivedByIds", "receivedbyids"], ["informedToIds", "informedtoids"]]) {
//     if (data[field]?.length) {
//       add(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(gg.${column}) AS selected_id(value) WHERE selected_id.value::bigint = ANY(?::bigint[]))`, data[field]);
//     }
//   }
//   const where = filters.join(" AND ");
//   const count = await pool.query(`SELECT COUNT(*)::bigint AS total FROM guest_glitch_entry_master gg WHERE ${where};`, values);
//   const page = Number(data.page), pageSize = Number(data.pageSize), offset = (page - 1) * pageSize;
//   const sortColumn = SORT_COLUMNS[data.sortBy];
//   const direction = String(data.sortDirection).toUpperCase() === "ASC" ? "ASC" : "DESC";
//   const queryValues = [...values, pageSize, offset];
//   const rows = await pool.query(
//     `SELECT gg.* FROM guest_glitch_entry_master gg WHERE ${where}
//      ORDER BY ${sortColumn} ${direction}, gg.id DESC
//      LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length};`,
//     queryValues
//   );
//   return { rows: rows.rows, total: Number(count.rows[0].total) };
// };
const list = async (data, organizationID) => {
  const organizationIDs = Array.isArray(organizationID) ? organizationID : [organizationID];
  const filters = [
    "gg.organizationid = ANY($1::bigint[])",
    "gg.isdeleted = FALSE",
  ];

  const values = [organizationIDs];
  filters.push(workflowVisibilitySQL(values, data));

  const add = (condition, value) => {
    values.push(value);
    filters.push(
      condition.replace("?", `$${values.length}`)
    );
  };

  // ---------------------------------------------------------
  // General search
  // ---------------------------------------------------------
  if (data.search) {
    values.push(`%${data.search}%`);
    const p = `$${values.length}`;

    filters.push(`
      (
        gg.guestname ILIKE ${p}
        OR gg.roomnumber ILIKE ${p}
        OR gg.complaint ILIKE ${p}
        OR gg.companyname ILIKE ${p}
      )
    `);
  }

  // ---------------------------------------------------------
  // Date filters
  // ---------------------------------------------------------
  if (data.fromDate) {
    add("gg.entrydate >= ?", data.fromDate);
  }

  if (data.toDate) {
    add("gg.entrydate <= ?", data.toDate);
  }

  // ---------------------------------------------------------
  // Scalar filters
  // ---------------------------------------------------------
  const scalarFilters = {
    status: "gg.status",
    guestStatus: "gg.gueststatus",
    roomNumber: "gg.roomnumber",
    guestName: "gg.guestname",
    complaint: "gg.complaint",
    complaintSource: "gg.complaintsource",
    raiseSource: "gg.raisesource",
    processLapse: "gg.processlapse",
    processLapseCategory: "gg.processlapsecategory",
    companyName: "gg.companyname",
    internalActionTaken: "gg.internalactiontaken",
    internalActionTakenCategory:
      "gg.internalactiontakencategory",
    createdBy: "gg.createdby",
    updatedBy: "gg.updatedby",
  };

  for (const [field, column] of Object.entries(scalarFilters)) {
    if (data[field]) {
      add(`${column} ILIKE ?`, `%${data[field]}%`);
    }
  }

  // ---------------------------------------------------------
  // Check-in / Check-out date filters
  // ---------------------------------------------------------
  if (data.checkInDate) {
    add("gg.checkindate >= ?", data.checkInDate);
  }

  if (data.checkOutDate) {
    add("gg.checkoutdate <= ?", data.checkOutDate);
  }

  // ---------------------------------------------------------
  // Department / user multi-select filters
  // ---------------------------------------------------------
  for (const [field, column] of [
    ["departmentIds", "departmentids"],
    ["receivedByIds", "receivedbyids"],
    ["informedToIds", "informedtoids"],
  ]) {
    if (data[field]?.length) {
      add(
        `
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            COALESCE(gg.${column}, '[]'::jsonb)
          ) AS selected_id(value)
          WHERE selected_id.value::bigint =
                ANY(?::bigint[])
        )
        `,
        data[field]
      );
    }
  }

  const where = filters.join(" AND ");

  // ---------------------------------------------------------
  // Count
  // ---------------------------------------------------------
  const count = await pool.query(
    `
    SELECT COUNT(*)::bigint AS total
    FROM guest_glitch_entry_master gg
    WHERE ${where};
    `,
    values
  );

  const page = Number(data.page);
  const pageSize = Number(data.pageSize);
  const offset = (page - 1) * pageSize;

  const sortColumn =
    SORT_COLUMNS[data.sortBy] || SORT_COLUMNS.EntryDate;

  const direction =
    String(data.sortDirection).toUpperCase() === "ASC"
      ? "ASC"
      : "DESC";

  const queryValues = [
    ...values,
    pageSize,
    offset,
  ];

  // ---------------------------------------------------------
  // IMPORTANT:
  // Do NOT use SELECT gg.*
  // ---------------------------------------------------------
  const result = await pool.query(
    `
    SELECT
      gg.id,
      gg.organizationid,
      om.organizationname,

      gg.entrydate,
      gg.time,

      gg.roomnumber,
      gg.guestname,
      gg.gueststatus,

      gg.departmentids,
      gg.receivedbyids,
      gg.informedtoids,

      gg.complaint,
      gg.status,
      gg.currentworkflowstage,

      gg.complaintsource,
      gg.raisesource,

      gg.processlapse,
      gg.processlapsecategory,

      gg.servicerecovery,

      gg.internalactiontaken,
      gg.internalactiontakencategory,

      gg.companyname,

      gg.checkindate,
      gg.checkoutdate,

      gg.createdby,
      gg.updatedby

    FROM guest_glitch_entry_master gg

    INNER JOIN organization_master om
      ON om.organizationid = gg.organizationid

    WHERE ${where}

    ORDER BY
      ${sortColumn} ${direction},
      gg.id DESC

    LIMIT $${queryValues.length - 1}
    OFFSET $${queryValues.length};
    `,
    queryValues
  );

  return {
    rows: result.rows,
    total: Number(count.rows[0].total),
  };
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
  const organizationIDs = Array.isArray(organizationID) ? organizationID : [organizationID];
  const filters = ["gg.organizationid = ANY($1::bigint[])", "gg.isdeleted = FALSE"];
  const values = [organizationIDs];
  filters.push(workflowVisibilitySQL(values, data));
  const add = (sql, value) => { values.push(value); filters.push(sql.replace("?", `$${values.length}`)); };
  if (data.search) {
    values.push(`%${data.search}%`);
    const p = `$${values.length}`;
    filters.push(`(gg.guestname ILIKE ${p} OR gg.roomnumber ILIKE ${p} OR gg.complaint ILIKE ${p} OR gg.companyname ILIKE ${p})`);
  }
  if (data.fromDate) add("gg.entrydate >= ?", data.fromDate);
  if (data.toDate) add("gg.entrydate <= ?", data.toDate);
  for (const [field, column] of Object.entries({
    status: "gg.status", guestStatus: "gg.gueststatus", roomNumber: "gg.roomnumber",
    guestName: "gg.guestname", complaint: "gg.complaint",
    complaintSource: "gg.complaintsource", raiseSource: "gg.raisesource",
    processLapse: "gg.processlapse", processLapseCategory: "gg.processlapsecategory",
    companyName: "gg.companyname", internalActionTaken: "gg.internalactiontaken",
    internalActionTakenCategory: "gg.internalactiontakencategory",
    createdBy: "gg.createdby", updatedBy: "gg.updatedby",
  })) {
    if (data[field]) add(`${column} ILIKE ?`, `%${data[field]}%`);
  }
  if (data.checkInDate) add("gg.checkindate >= ?", data.checkInDate);
  if (data.checkOutDate) add("gg.checkoutdate <= ?", data.checkOutDate);
  for (const [field, column] of [["departmentIds", "departmentids"], ["receivedByIds", "receivedbyids"], ["informedToIds", "informedtoids"]]) {
    if (data[field]?.length) add(
      `EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(gg.${column}, '[]'::jsonb)) selected(value) WHERE selected.value::bigint = ANY(?::bigint[]))`,
      data[field]
    );
  }
  return { filters, values };
};

// const reportList = async (data, organizationID) => {
//   const { filters, values } = buildReportFilters(data, organizationID);
//   const where = filters.join(" AND ");
//   const count = await pool.query(`SELECT COUNT(*)::bigint total FROM guest_glitch_entry_master gg WHERE ${where};`, values);
//   const limit = Number(data.pageSize), offset = (Number(data.page) - 1) * limit;
//   const queryValues = [...values, limit, offset];
//   const sort = REPORT_SORT_COLUMNS[data.sortBy];
//   const direction = String(data.sortDirection).toUpperCase() === "ASC" ? "ASC" : "DESC";
//   const result = await pool.query(
//     `SELECT gg.*, om.organizationname AS hotel
//      FROM guest_glitch_entry_master gg
//      INNER JOIN organization_master om ON om.organizationid = gg.organizationid
//      WHERE ${where}
//      ORDER BY ${sort} ${direction}, gg.id DESC
//      LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length};`, queryValues
//   );
//   return { rows: result.rows, total: Number(count.rows[0].total) };
// };
const reportList = async (data, organizationID, paginate = true) => {
  const { filters, values } = buildReportFilters(
    data,
    organizationID
  );

  const where = filters.join(" AND ");

  const count = paginate ? await pool.query(
    `
    SELECT COUNT(*)::bigint AS total
    FROM guest_glitch_entry_master gg
    WHERE ${where};
    `,
    values
  ) : null;

  const limit = Number(data.pageSize);
  const offset =
    (Number(data.page) - 1) * limit;

  const queryValues = paginate ? [...values, limit, offset] : values;
  const paginationSQL = paginate
    ? `LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length}`
    : "";

  const sort =
    REPORT_SORT_COLUMNS[data.sortBy] ||
    REPORT_SORT_COLUMNS.EntryDate;

  const direction =
    String(data.sortDirection).toUpperCase() === "ASC"
      ? "ASC"
      : "DESC";

  const result = await pool.query(
    `
    SELECT
      gg.*,
      om.organizationname AS hotel
    FROM guest_glitch_entry_master gg

    LEFT JOIN organization_master om
      ON om.organizationid = gg.organizationid

    WHERE ${where}

    ORDER BY
      ${sort} ${direction},
      gg.id DESC

    ${paginationSQL};
    `,
    queryValues
  );

  return {
    rows: result.rows,
    total: paginate ? Number(count.rows[0].total) : result.rows.length,
  };
};

const findReportByID = async (client, id, organizationID, lock = false) => {
  const organizationIDs = Array.isArray(organizationID) ? organizationID : [organizationID];
  const result = await client.query(
    `SELECT gg.*, om.organizationname AS hotel
     FROM guest_glitch_entry_master gg
     INNER JOIN organization_master om ON om.organizationid = gg.organizationid
     WHERE gg.id = $1 AND gg.organizationid = ANY($2::bigint[]) AND gg.isdeleted = FALSE
     LIMIT 1 ${lock ? "FOR UPDATE OF gg" : ""};`, [id, organizationIDs]
  );
  return result.rows[0] || null;
};

// const resolveSelections = async (client, organizationID, rows) => {
//   const unique = (field) => [...new Set(rows.flatMap((row) => row[field] || []).map(Number))];
//   const [departments, users] = await Promise.all([
//     validateDepartments(client, organizationID, unique("departmentids")),
//     validateUsers(client, organizationID, [...new Set([...unique("receivedbyids"), ...unique("informedtoids")])]),
//   ]);
//   const departmentMap = new Map(departments.map((item) => [Number(item.departmentid), item.departmentname]));
//   const userMap = new Map(users.map((item) => [Number(item.userid), item.fullname || item.username]));
//   return rows.map((row) => ({
//     departments: (row.departmentids || []).map(Number).map((id) => ({ID: id, Name: departmentMap.get(id) || null})),
//     receivedByUsers: (row.receivedbyids || []).map(Number).map((id) => ({ID: id, Name: userMap.get(id) || null})),
//     informedToUsers: (row.informedtoids || []).map(Number).map((id) => ({ID: id, Name: userMap.get(id) || null})),
//     // departments: (row.departmentids || []).map(Number).map((id) => ({ id, name: departmentMap.get(id) || null })),
//     // receivedByUsers: (row.receivedbyids || []).map(Number).map((id) => ({ id, name: userMap.get(id) || null })),
//     // informedToUsers: (row.informedtoids || []).map(Number).map((id) => ({ id, name: userMap.get(id) || null })),
//   }));
// };

const resolveSelections = async (client, organizationID, rows = []) => {
  const unique = (field) =>
    [
      ...new Set(
        rows
          .flatMap((row) => row[field] || [])
          .map(Number)
          .filter(Number.isFinite)
      ),
    ];

  const [departments, users] = await Promise.all([
    validateDepartments(
      client,
      organizationID,
      unique("departmentids")
    ),

    validateUsers(
      client,
      organizationID,
      [
        ...new Set([
          ...unique("receivedbyids"),
          ...unique("informedtoids"),
        ]),
      ]
    ),
  ]);

  const departmentMap = new Map(
    departments.map((item) => [
      Number(item.departmentid),
      item.departmentname,
    ])
  );

  const userMap = new Map(
    users.map((item) => [
      Number(item.userid),
      item.fullname || item.username,
    ])
  );

  return rows.map((row) => ({
    departments: (row.departmentids || [])
      .map(Number)
      .map((id) => ({
        ID: id,
        Name: departmentMap.get(id) || null,
      })),

    receivedByUsers: (row.receivedbyids || [])
      .map(Number)
      .map((id) => ({
        ID: id,
        Name: userMap.get(id) || null,
      })),

    informedToUsers: (row.informedtoids || [])
      .map(Number)
      .map((id) => ({
        ID: id,
        Name: userMap.get(id) || null,
      })),
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

const getWorkflowConfig = async (client, organizationID) => {
  const result = await client.query(
    `SELECT fc.flowconfigid, fc.stagekey, fc.stagename, fc.stageorder, fc.isfinalstage,
       fc.isactive, fd.flowconfigdetailid, fd.actortype, fd.actorvalue,
       fd.canview, fd.canedit, fd.canproceed, fd.editablefields, fd.requiredactionfields
     FROM guest_glitch_flow_config fc
     LEFT JOIN guest_glitch_flow_config_detail fd ON fd.flowconfigid = fc.flowconfigid
       AND fd.isdeleted = FALSE
     WHERE fc.organizationid = $1 AND fc.isdeleted = FALSE
     ORDER BY fc.stageorder, fc.flowconfigid, fd.flowconfigdetailid;`, [organizationID]
  );
  return result.rows;
};

const replaceWorkflowConfig = async (client, data) => {
  await client.query(
    `UPDATE guest_glitch_flow_config SET isdeleted = TRUE, deletedby = $1,
       deleteddate = CURRENT_TIMESTAMP, modifiedby = $1, modifieddate = CURRENT_TIMESTAMP
     WHERE organizationid = $2 AND isdeleted = FALSE;`, [data.UserID, data.OrganizationID]
  );
  for (const stage of data.Stages) {
    const stageResult = await client.query(
      `INSERT INTO guest_glitch_flow_config
       (organizationid, stagekey, stagename, stageorder, isfinalstage, isactive, createdby)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING flowconfigid;`,
      [data.OrganizationID, stage.StageKey, stage.StageName, stage.StageOrder,
        stage.IsFinalStage === true, stage.IsActive !== false, data.UserID]
    );
    for (const actor of stage.Actors) {
      await client.query(
        `INSERT INTO guest_glitch_flow_config_detail
         (flowconfigid, actortype, actorvalue, canview, canedit, canproceed,
          editablefields, requiredactionfields, isactive, createdby)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10);`,
        [stageResult.rows[0].flowconfigid, actor.ActorType,
          actor.ActorType === "CREATOR" ? null : String(actor.ActorValue).trim(),
          actor.CanView !== false, actor.CanEdit === true, actor.CanProceed === true,
          JSON.stringify(actor.EditableFields || []), JSON.stringify(actor.RequiredActionFields || []),
          actor.IsActive !== false, data.UserID]
      );
    }
  }
};

const findWorkflowStagesInUseOutside = async (client, organizationID, stageKeys) => {
  const result = await client.query(
    `SELECT DISTINCT currentworkflowstage FROM guest_glitch_entry_master
     WHERE organizationid = $1 AND isdeleted = FALSE AND currentworkflowstage IS NOT NULL
       AND NOT (currentworkflowstage = ANY($2::text[]));`, [organizationID, stageKeys]
  );
  return result.rows.map((row) => row.currentworkflowstage);
};

const deleteWorkflowConfig = async (client, organizationID, userID) => {
  const result = await client.query(
    `UPDATE guest_glitch_flow_config SET isdeleted = TRUE, deletedby = $1,
       deleteddate = CURRENT_TIMESTAMP, modifiedby = $1, modifieddate = CURRENT_TIMESTAMP
     WHERE organizationid = $2 AND isdeleted = FALSE RETURNING flowconfigid;`,
    [userID, organizationID]
  );
  return result.rowCount;
};

const validateWorkflowUserTypes = async (client, organizationID, values) => {
  if (!values.length) return [];
  const result = await client.query(
    `SELECT DISTINCT UPPER(um.usertype) AS usertype FROM user_master um
     INNER JOIN user_org_mapping uom ON uom.userid = um.userid
     WHERE uom.organizationid = $1 AND UPPER(um.usertype) = ANY($2::text[])
       AND uom.isactive = TRUE AND uom.isdeleted = FALSE
       AND um.isactive = TRUE AND um.isdeleted = FALSE AND um.islocked = FALSE;`,
    [organizationID, values.map((value) => String(value).toUpperCase())]
  );
  return result.rows.map((row) => row.usertype);
};

module.exports = {
  COLUMN_MAP, getClient, resolveOrganizations, validateDepartments, validateUsers, findOption, insert,
  findByID, updateChangedFields, softDelete, list, listOptions, upsertOption,
  reportList, findReportByID, resolveSelections,
  getFirstWorkflowStage, getWorkflowStageState, getWorkflowAccess, getWorkflowConfig, replaceWorkflowConfig, deleteWorkflowConfig,
  validateWorkflowUserTypes,
  findWorkflowStagesInUseOutside,
};
