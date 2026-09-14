const { pool } = require("../../db");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");
const { formatDate } = require("../../utils/dateFormatter");
const generateUrl = require("../../AzurConfigration/Engineering/AzureGetData");
const { generatePdf, loadLogo } = require("../../utils/pdfHelper");

// ============================================================Response Helpers
const fail = (message, statusCode = 400) => ({
  success: false,
  statusCode,
  message,
});
const ok = (message, data, extra = {}) => ({
  success: true,
  message,
  ...extra,
  data,
});
const databaseFailure = (error, operation) => {
  console.error(`${operation} Error:`, error.message);

  return (
    retryableDatabaseResponse(error) ||
    fail(`Unable to ${operation.toLowerCase()} at this time.`, 500)
  );
};

// ============================================================================================Equipment Entries
// ============================Document Mapper Helper
const mapDocument = (row) => ({
  EquipmentDocumentID: Number(row.equipmentdocumentid),
  FileName: row.filename,
  FileUrl: row.filepath ? generateUrl(row.filepath) : null,
});
// =============================Equipment Mapper Helper
const mapEquipment = (row) => ({
  EquipmentID: Number(row.equipmentid),

  OrganizationID: Number(row.organizationid),
  OrganizationShortName: row.organizationshortname || null,

  DepartmentID: row.departmentid ? Number(row.departmentid) : null,
  DepartmentName: row.departmentname,

  Description: row.description,

  SerialNumber: row.serialnumber,

  TypeOfMachine: row.typeofmachine,

  Capacity: row.capacity,

  ModelNumber: row.modelnumber,

  Make: row.make,

  Area: row.area,

  CommissioningDate: formatDate(row.commissioningdate),

  WarrantyStartDate: formatDate(row.warrantystartdate),

  WarrantyEndDate: formatDate(row.warrantyenddate),

  WarrantyStatus: row.warrantystatus,

  AMCType: row.amctype,

  AMCStartDate: formatDate(row.amcstartdate),

  AMCEndDate: formatDate(row.amcenddate),

  AMCStatus: row.amcstatus,

  AMCYearlyExpense:
    row.amcyearlyexpense == null ? null : Number(row.amcyearlyexpense),

  IsMandatoryAMC: row.ismandatoryamc,

  ScheduleOfServicing: row.scheduleofservicing,

  ScheduleDay: row.scheduleday,

  ResponsiblePerson:
    row.responsibleperson == null ? null : Number(row.responsibleperson),

  ResponsiblePersonName: row.responsiblepersonname || null,

  Status: row.status,

  Remarks: row.remarks,

  CreatedDate: formatDate(row.createddate),

  Documents: [],
});
// ============================Attach Documents Helper
const attachDocuments = async (equipments) => {
  if (!equipments.length) {
    return [];
  }

  const ids = equipments.map((item) => Number(item.EquipmentID));

  const result = await pool.query(
    `
        SELECT *

        FROM Engineering_Equipment_Documents

        WHERE EquipmentID =
              ANY($1::bigint[])
          AND IsDeleted = FALSE

        ORDER BY
          EquipmentID,
          EquipmentDocumentID;
        `,
    [ids],
  );

  const documentMap = new Map();

  for (const row of result.rows) {
    const id = Number(row.equipmentid);

    if (!documentMap.has(id)) {
      documentMap.set(id, []);
    }

    documentMap.get(id).push(mapDocument(row));
  }

  return equipments.map((equipment) => ({
    ...equipment,

    Documents: documentMap.get(equipment.EquipmentID) || [],
  }));
};
// ============================================================CREATE Equipment
const createEquipment = async (data) => {
  const client = await pool.connect();

  try {
    const organizationID = Number(data.OrganizationID);
    const departmentID = Number(data.DepartmentID);

    await client.query("BEGIN");

    // ========================================================
    // Is Mandatory AMC - Default FALSE
    // ========================================================

    const isMandatoryAMC =
      data.IsMandatoryAMC === true ||
      data.IsMandatoryAMC === "true" ||
      data.IsMandatoryAMC === 1 ||
      data.IsMandatoryAMC === "1";

    // ========================================================
    // Insert Equipment Master
    // ========================================================

    const result = await client.query(
      `
      INSERT INTO Engineering_Equipment_Entry_Master
      (
        OrganizationID,
        DepartmentID,
        Description,
        SerialNumber,
        TypeOfMachine,
        Capacity,
        ModelNumber,
        Make,
        Area,
        CommissioningDate,

        WarrantyStartDate,
        WarrantyEndDate,
        WarrantyStatus,

        AMCType,
        AMCStartDate,
        AMCEndDate,
        AMCStatus,
        AMCYearlyExpense,
        IsMandatoryAMC,

        ScheduleOfServicing,
        ScheduleDay,
        ResponsiblePerson,

        Remarks,
        IsDeleted,

        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12,$13,
        $14,$15,$16,$17,$18,$19,
        $20,$21,$22,
        $23,
        FALSE,
        $24,
        CURRENT_TIMESTAMP
      )
      RETURNING EquipmentID;
      `,
      [
        organizationID,
        departmentID,

        String(data.Description).trim(),
        String(data.SerialNumber).trim(),

        data.TypeOfMachine || null,
        data.Capacity || null,
        data.ModelNumber || null,
        data.Make || null,

        String(data.Area).trim(),

        data.CommissioningDate || null,

        data.WarrantyStartDate || null,
        data.WarrantyEndDate || null,
        data.WarrantyStatus || null,

        data.AMCType || null,
        data.AMCStartDate || null,
        data.AMCEndDate || null,
        data.AMCStatus || null,
        String(data.AMCYearlyExpense ?? "").trim() === ""
          ? null
          : data.AMCYearlyExpense,

        isMandatoryAMC,

        data.ScheduleOfServicing || null,
        data.ScheduleDay || null,

        String(data.ResponsiblePerson ?? "").trim() === ""
          ? null
          : data.ResponsiblePerson,

        data.Remarks || null,

        data.UserID,
      ],
    );

    const equipmentID = Number(result.rows[0].equipmentid);

    // ========================================================
    // Insert Documents
    // ========================================================

    const documents = Array.isArray(data.Documents) ? data.Documents : [];

    for (const document of documents) {
      await client.query(
        `
        INSERT INTO Engineering_Equipment_Documents
        (
          EquipmentID,
          OrganizationID,
          FileName,
          FilePath,
          FileType,
          FileSize,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,
          FALSE,
          $7,
          CURRENT_TIMESTAMP
        );
        `,
        [
          equipmentID,
          organizationID,
          document.FileName || null,
          document.FilePath || null,
          document.FileType || null,
          document.FileSize || null,
          data.UserID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok("Engineering equipment created successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Create Engineering equipment");
  } finally {
    client.release();
  }
};
// ============================================================ Equipment LIST
const getAllEquipment = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(Math.max(Number(data.PageSize) || 10, 1), 100);

    const offset = (page - 1) * pageSize;

    const values = [organizationID];

    const conditions = ["e.OrganizationID = $1", "e.IsDeleted = FALSE"];

    // ========================================================
    // DepartmentID Filter
    // ========================================================

    if (data.DepartmentID) {
      values.push(Number(data.DepartmentID));

      conditions.push(`e.DepartmentID = $${values.length}`);
    }

    // ========================================================
    // Other Filters
    // ========================================================

    for (const [parameter, column, operator] of [
      ["WarrantyStatus", "WarrantyStatus", "="],
      ["AMCStatus", "AMCStatus", "="],
      ["SerialNo", "SerialNumber", "ILIKE"],
      ["Area", "Area", "ILIKE"],
      ["Equipment", "Description", "ILIKE"],
    ]) {
      const value = String(data[parameter] ?? "").trim();

      if (!value) continue;

      values.push(operator === "ILIKE" ? `%${value}%` : value);

      conditions.push(`e.${column} ${operator} $${values.length}`);
    }

    // ========================================================
    // Search
    // ========================================================

    if (data.Search) {
      values.push(`%${String(data.Search).trim()}%`);

      conditions.push(
        `
        (
          e.Description ILIKE $${values.length}
          OR e.SerialNumber ILIKE $${values.length}
          OR e.ModelNumber ILIKE $${values.length}
          OR e.Make ILIKE $${values.length}
          OR e.Area ILIKE $${values.length}
        )
        `,
      );
    }

    const where = conditions.join(" AND ");

    // ========================================================
    // Total Count
    // ========================================================

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS TotalCount
      FROM Engineering_Equipment_Entry_Master e
      WHERE ${where};
      `,
      values,
    );

    const totalCount = Number(countResult.rows[0].totalcount);

    // ========================================================
    // Equipment List
    // ========================================================

    const listValues = [...values, pageSize, offset];

    const result = await pool.query(
      `
  SELECT
    e.*,

    om.ShortName AS OrganizationShortName,

    d.DepartmentName AS DepartmentName,

    u.FullName AS ResponsiblePersonName

  FROM Engineering_Equipment_Entry_Master e

  LEFT JOIN Organization_Master om
    ON om.OrganizationID = e.OrganizationID
   AND om.IsDeleted = FALSE

  LEFT JOIN department_master d
    ON d.DepartmentID = e.DepartmentID
   AND d.OrganizationID = e.OrganizationID
   AND d.IsDeleted = FALSE

  LEFT JOIN user_master u
    ON u.UserID = e.ResponsiblePerson
   AND u.IsDeleted = FALSE

  WHERE ${where}

  ORDER BY e.EquipmentID DESC

  LIMIT $${listValues.length - 1}
  OFFSET $${listValues.length};
  `,
      listValues,
    );

    let records = result.rows.map(mapEquipment);

    return ok("Engineering equipment fetched successfully.", records, {
      TotalCount: totalCount,
      PageCount: records.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering equipment");
  }
};
// ============================================================GET Equipment BY ID
const getEquipmentById = async (data) => {
  try {
    const equipmentID = Number(data.EquipmentID);

    if (!Number.isInteger(equipmentID) || equipmentID <= 0) {
      return fail("Valid EquipmentID is required.", 400);
    }

    const result = await pool.query(
      `
      SELECT
        e.*,

        om.ShortName AS OrganizationShortName,

        d.DepartmentName AS DepartmentName,

        u.FullName AS ResponsiblePersonName

      FROM Engineering_Equipment_Entry_Master e

      LEFT JOIN Organization_Master om
        ON om.OrganizationID = e.OrganizationID
       AND om.IsDeleted = FALSE

      LEFT JOIN department_master d
        ON d.DepartmentID = e.DepartmentID
       AND d.OrganizationID = e.OrganizationID
       AND d.IsDeleted = FALSE

      LEFT JOIN user_master u
        ON u.UserID = e.ResponsiblePerson
       AND u.IsDeleted = FALSE

      WHERE
        e.EquipmentID = $1
        AND e.IsDeleted = FALSE

      LIMIT 1;
      `,
      [equipmentID],
    );

    if (!result.rows.length) {
      return fail("Engineering equipment not found.", 404);
    }

    let records = [mapEquipment(result.rows[0])];

    // Detail API me documents bhi aayenge
    records = await attachDocuments(records);

    return ok("Engineering equipment fetched successfully.", records[0]);
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering equipment");
  }
};
// ============================================================UPDATE Equipment
const updateFields = {
  DepartmentID: "DepartmentID",

  Description: "Description",

  SerialNumber: "SerialNumber",

  TypeOfMachine: "TypeOfMachine",

  Capacity: "Capacity",

  ModelNumber: "ModelNumber",

  Make: "Make",

  Area: "Area",

  CommissioningDate: "CommissioningDate",

  WarrantyStartDate: "WarrantyStartDate",

  WarrantyEndDate: "WarrantyEndDate",

  WarrantyStatus: "WarrantyStatus",

  AMCType: "AMCType",

  AMCStartDate: "AMCStartDate",

  AMCEndDate: "AMCEndDate",

  AMCStatus: "AMCStatus",

  AMCYearlyExpense: "AMCYearlyExpense",

  IsMandatoryAMC: "IsMandatoryAMC",

  ScheduleOfServicing: "ScheduleOfServicing",

  ScheduleDay: "ScheduleDay",

  ResponsiblePerson: "ResponsiblePerson",

  Remarks: "Remarks",
};
const updateEquipment = async (data) => {
  const client = await pool.connect();

  try {
    const equipmentID = Number(data.EquipmentID);
    const organizationID = Number(data.OrganizationID);

    if (!Number.isInteger(equipmentID) || equipmentID <= 0) {
      return fail("Valid EquipmentID is required.", 400);
    }

    await client.query("BEGIN");

    // ========================================================
    // Check Equipment
    // ========================================================

    const existing = await client.query(
      `
      SELECT EquipmentID
      FROM Engineering_Equipment_Entry_Master
      WHERE EquipmentID = $1
        AND OrganizationID = $2
        AND IsDeleted = FALSE
      FOR UPDATE;
      `,
      [equipmentID, organizationID],
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");

      return fail("Engineering equipment not found.", 404);
    }

    // ========================================================
    // Update Fields
    // ========================================================

    const changes =
      data.Changes && typeof data.Changes === "object" ? data.Changes : {};

    const assignments = [];
    const values = [];

    for (const [field, column] of Object.entries(updateFields)) {
      if (!Object.prototype.hasOwnProperty.call(changes, field)) {
        continue;
      }

      let value = changes[field];

      // ======================================================
      // Boolean
      // ======================================================

      if (field === "IsMandatoryAMC") {
        value =
          value === true || value === "true" || value === 1 || value === "1";
      }

      // ======================================================
      // Numeric Blank -> NULL
      // ======================================================

      const isBlankNumeric =
        (field === "AMCYearlyExpense" ||
          field === "ResponsiblePerson" ||
          field === "DepartmentID") &&
        String(value ?? "").trim() === "";

      if (isBlankNumeric) {
        value = null;
      }

      // ======================================================
      // Other Blank Values -> NULL
      // ======================================================

      if (value === "") {
        value = null;
      }

      values.push(value);

      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length) {
      values.push(data.UserID);
      const modifiedByIndex = values.length;

      values.push(equipmentID);
      const equipmentIndex = values.length;

      values.push(organizationID);
      const organizationIndex = values.length;

      await client.query(
        `
        UPDATE Engineering_Equipment_Entry_Master

        SET
          ${assignments.join(", ")},

          ModifiedBy = $${modifiedByIndex},
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE EquipmentID = $${equipmentIndex}
          AND OrganizationID = $${organizationIndex}
          AND IsDeleted = FALSE;
        `,
        values,
      );
    }

    // ========================================================
    // Soft Delete Selected Documents
    // ========================================================

    const deleteIDs = Array.isArray(data.DeleteDocumentIDs)
      ? data.DeleteDocumentIDs.map(Number).filter(
          (id) => Number.isInteger(id) && id > 0,
        )
      : [];

    if (deleteIDs.length) {
      await client.query(
        `
        UPDATE Engineering_Equipment_Documents

        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE EquipmentID = $2
          AND OrganizationID = $3
          AND EquipmentDocumentID = ANY($4::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.UserID, equipmentID, organizationID, deleteIDs],
      );
    }

    // ========================================================
    // Add New Documents
    // ========================================================

    const documents = Array.isArray(data.Documents) ? data.Documents : [];

    for (const document of documents) {
      await client.query(
        `
        INSERT INTO Engineering_Equipment_Documents
        (
          EquipmentID,
          OrganizationID,
          FileName,
          FilePath,
          FileType,
          FileSize,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,
          FALSE,
          $7,
          CURRENT_TIMESTAMP
        );
        `,
        [
          equipmentID,
          organizationID,

          document.FileName || null,
          document.FilePath || null,
          document.FileType || null,
          document.FileSize || null,

          data.UserID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok("Engineering equipment updated successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Update Engineering equipment");
  } finally {
    client.release();
  }
};
// ============================================================DELETE Equipment
const deleteEquipment = async (data) => {
  const client = await pool.connect();

  try {
    const equipmentID = Number(data.EquipmentID);

    if (!Number.isInteger(equipmentID) || equipmentID <= 0) {
      return fail("Valid EquipmentID is required.", 400);
    }

    await client.query("BEGIN");

    // ========================================================
    // Soft Delete Equipment
    // ========================================================

    const result = await client.query(
      `
      UPDATE Engineering_Equipment_Entry_Master

      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP

      WHERE EquipmentID = $2
        AND IsDeleted = FALSE

      RETURNING EquipmentID;
      `,
      [data.UserID, equipmentID],
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");

      return fail("Engineering equipment not found.", 404);
    }

    // ========================================================
    // Soft Delete Equipment Documents
    // ========================================================

    await client.query(
      `
      UPDATE Engineering_Equipment_Documents

      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP

      WHERE EquipmentID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, equipmentID],
    );

    // ========================================================
    // Soft Delete Maintenance Details
    // ========================================================

    await client.query(
      `
      UPDATE Engineering_Maintenance_Details

      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP

      WHERE EquipmentID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, equipmentID],
    );

    // ========================================================
    // Commit
    // ========================================================

    await client.query("COMMIT");

    return ok("Engineering equipment deleted successfully.", {
      EquipmentID: equipmentID,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Delete Engineering equipment");
  } finally {
    client.release();
  }
};
// ============================================================GET Equipment Descriptions(Names)
const getEquipmentDescriptions = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    if (!Number.isInteger(organizationID) || organizationID <= 0) {
      return fail("Valid OrganizationID is required.", 400);
    }

    const result = await pool.query(
      `
      SELECT Description
      FROM Engineering_Equipment_Entry_Master
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
        AND Description IS NOT NULL
        AND TRIM(Description) <> ''
      ORDER BY Description ASC;
      `,
      [organizationID],
    );

    const records = result.rows.map((row) => ({
      Equipment: row.description,
    }));

    return ok("Equipment descriptions fetched successfully.", records, {
      Count: records.length,
    });
  } catch (error) {
    return databaseFailure(error, "Fetch equipment descriptions");
  }
};
// ============================================================GET Serial Number
const getEquipmentSerialNumbers = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    if (!Number.isInteger(organizationID) || organizationID <= 0) {
      return fail("Valid OrganizationID is required.", 400);
    }

    const result = await pool.query(
      `
      SELECT DISTINCT SerialNumber
      FROM Engineering_Equipment_Entry_Master
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
        AND SerialNumber IS NOT NULL
        AND TRIM(SerialNumber) <> ''
      ORDER BY SerialNumber ASC;
      `,
      [organizationID],
    );

    const records = result.rows.map((row) => ({
      SerialNumber: row.serialnumber,
    }));

    return ok("Equipment serial numbers fetched successfully.", records, {
      Count: records.length,
    });
  } catch (error) {
    return databaseFailure(error, "Fetch equipment serial numbers");
  }
};
// ============================================================GET Areas
const getEquipmentAreas = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    if (!Number.isInteger(organizationID) || organizationID <= 0) {
      return fail("Valid OrganizationID is required.", 400);
    }

    const result = await pool.query(
      `
      SELECT DISTINCT Area
      FROM Engineering_Equipment_Entry_Master
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
        AND Area IS NOT NULL
        AND TRIM(Area) <> ''
      ORDER BY Area ASC;
      `,
      [organizationID],
    );

    const records = result.rows.map((row) => ({
      Area: row.area,
    }));

    return ok("Equipment areas fetched successfully.", records, {
      Count: records.length,
    });
  } catch (error) {
    return databaseFailure(error, "Fetch equipment areas");
  }
};
// ============================================================================================Breakdown of Equipment Entries
// =============================Breakdown Mapper Helper
const mapBreakdown = (row) => ({
  BreakdownID: Number(row.breakdownid),

  OrganizationID: Number(row.organizationid),

  OrganizationShortName: row.organizationshortname || null,

  EquipmentID: Number(row.equipmentid),

  BreakdownDate: formatDate(row.breakdowndate),

  BreakdownTime: row.breakdowntime || null,

  BreakdownReason: row.breakdownreason || null,

  PartsUsed: row.partsused || null,

  Parts: Array.isArray(row.parts)
    ? row.parts.map((part) => ({
        BreakdownPartID: Number(part.BreakdownPartID),

        Item: part.Item || null,

        Qty: part.Qty !== null ? Number(part.Qty) : null,

        Amount: part.Amount !== null ? Number(part.Amount) : null,
      }))
    : [],

  RepairedStatus: row.repairedstatus,

  RepairedDate: formatDate(row.repaireddate),

  RepairedByID: row.repairedbyid ? Number(row.repairedbyid) : null,

  RepairedByName: row.repairedbyname || null,

  Amount: row.amount !== null ? Number(row.amount) : null,

  CreatedDate: formatDate(row.createddate),
});
// ============================================================CREATE Breakdown
const createBreakdown = async (data) => {
  const client = await pool.connect();

  try {
    const organizationID = Number(data.OrganizationID);
    const equipmentID = Number(data.EquipmentID);

    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO Engineering_Breakdown_Entry
      (
        OrganizationID,
        EquipmentID,

        BreakdownDate,
        BreakdownTime,
        BreakdownReason,
        PartsUsed,

        RepairedStatus,
        RepairedDate,
        RepairedByID,

        Amount,

        IsDeleted,

        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,$2,
        $3,$4,$5,$6,
        $7,$8,$9,
        $10,
        FALSE,
        $11,
        CURRENT_TIMESTAMP
      )
      RETURNING BreakdownID;
      `,
      [
        organizationID,
        equipmentID,

        data.BreakdownDate || null,
        data.BreakdownTime || null,
        data.BreakdownReason || null,
        data.PartsUsed || null,

        data.RepairedStatus || "Pending",
        data.RepairedDate || null,
        data.RepairedByID || null,

        data.Amount ?? null,

        data.UserID,
      ],
    );

    const breakdownID = Number(result.rows[0].breakdownid);

    // ========================================================
    // Parts
    // ========================================================

    const parts = Array.isArray(data.Parts) ? data.Parts : [];

    for (const part of parts) {
      await client.query(
        `
        INSERT INTO Engineering_Breakdown_Parts_Details
        (
          BreakdownID,
          OrganizationID,

          Item,
          Qty,
          Amount,

          IsDeleted,

          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,$2,
          $3,$4,$5,
          FALSE,
          $6,
          CURRENT_TIMESTAMP
        );
        `,
        [
          breakdownID,
          organizationID,

          part.Item || null,
          part.Qty ?? null,
          part.Amount ?? null,

          data.UserID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok("Engineering breakdown created successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Create Engineering breakdown");
  } finally {
    client.release();
  }
};
// ============================================================Breakdown List
const getAllBreakdowns = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(Math.max(Number(data.PageSize) || 10, 1), 100);

    const offset = (page - 1) * pageSize;

    const values = [organizationID];

    const conditions = ["b.OrganizationID = $1", "b.IsDeleted = FALSE"];

    // EquipmentID Filter
    if (data.EquipmentID) {
      values.push(Number(data.EquipmentID));

      conditions.push(`b.EquipmentID = $${values.length}`);
    }

    // Repaired Status Filter
    if (data.RepairedStatus) {
      values.push(data.RepairedStatus);

      conditions.push(`b.RepairedStatus = $${values.length}`);
    }

    // From Date
    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(`b.BreakdownDate >= $${values.length}`);
    }

    // To Date
    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(`b.BreakdownDate <= $${values.length}`);
    }

    // Search
    if (data.Search) {
      values.push(`%${String(data.Search).trim()}%`);

      conditions.push(
        `
        (
          b.BreakdownReason ILIKE $${values.length}
          OR b.PartsUsed ILIKE $${values.length}
          OR EXISTS
          (
            SELECT 1
            FROM Engineering_Breakdown_Parts_Details bp
            WHERE bp.BreakdownID = b.BreakdownID
              AND bp.IsDeleted = FALSE
              AND bp.Item ILIKE $${values.length}
          )
        )
        `,
      );
    }

    const where = conditions.join(" AND ");

    // ========================================================
    // Count
    // ========================================================

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS TotalCount
      FROM Engineering_Breakdown_Entry b
      WHERE ${where};
      `,
      values,
    );

    const totalCount = Number(countResult.rows[0].totalcount);

    // ========================================================
    // List
    // ========================================================

    const listValues = [...values, pageSize, offset];

    const result = await pool.query(
      `
      SELECT
        b.*,

        om.ShortName AS OrganizationShortName,

        u.FullName AS RepairedByName,

        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'BreakdownPartID', bp.BreakdownPartID,
                'Item', bp.Item,
                'Qty', bp.Qty,
                'Amount', bp.Amount
              )
              ORDER BY bp.BreakdownPartID
            )
            FROM Engineering_Breakdown_Parts_Details bp
            WHERE bp.BreakdownID = b.BreakdownID
              AND bp.IsDeleted = FALSE
          ),
          '[]'::json
        ) AS Parts

      FROM Engineering_Breakdown_Entry b

      LEFT JOIN Organization_Master om
        ON om.OrganizationID = b.OrganizationID
       AND om.IsDeleted = FALSE

      LEFT JOIN user_master u
        ON u.UserID = b.RepairedByID
       AND u.IsDeleted = FALSE

      WHERE ${where}

      ORDER BY b.BreakdownID DESC

      LIMIT $${listValues.length - 1}
      OFFSET $${listValues.length};
      `,
      listValues,
    );

    const records = result.rows.map(mapBreakdown);

    return ok("Engineering breakdown fetched successfully.", records, {
      TotalCount: totalCount,
      PageCount: records.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering breakdown");
  }
};
// ============================================================Get Breakdown by Id
const getBreakdownById = async (data) => {
  try {
    const breakdownID = Number(data.BreakdownID);

    if (!Number.isInteger(breakdownID) || breakdownID <= 0) {
      return fail("Valid BreakdownID is required.", 400);
    }

    const result = await pool.query(
      `
      SELECT
        b.*,

        om.ShortName AS OrganizationShortName,

        e.Description AS EquipmentName,
        e.SerialNumber AS SerialNumber,

        u.FullName AS RepairedByName

      FROM Engineering_Breakdown_Entry b

      LEFT JOIN Organization_Master om
        ON om.OrganizationID = b.OrganizationID
       AND om.IsDeleted = FALSE

      LEFT JOIN Engineering_Equipment_Entry_Master e
        ON e.EquipmentID = b.EquipmentID
       AND e.IsDeleted = FALSE

      LEFT JOIN user_master u
        ON u.UserID = b.RepairedByID
       AND u.IsDeleted = FALSE

      WHERE b.BreakdownID = $1
        AND b.IsDeleted = FALSE

      LIMIT 1;
      `,
      [breakdownID],
    );

    if (!result.rows.length) {
      return fail("Engineering breakdown not found.", 404);
    }

    const record = mapBreakdown(result.rows[0]);

    // ========================================================
    // Parts
    // ========================================================

    const partsResult = await pool.query(
      `
      SELECT
        BreakdownPartID,
        BreakdownID,
        OrganizationID,
        Item,
        Qty,
        Amount

      FROM Engineering_Breakdown_Parts_Details

      WHERE BreakdownID = $1
        AND IsDeleted = FALSE

      ORDER BY BreakdownPartID ASC;
      `,
      [breakdownID],
    );

    record.Parts = partsResult.rows.map((row) => ({
      BreakdownPartID: Number(row.breakdownpartid),

      BreakdownID: Number(row.breakdownid),

      OrganizationID: Number(row.organizationid),

      Item: row.item || null,

      Qty: row.qty !== null ? Number(row.qty) : null,

      Amount: row.amount !== null ? Number(row.amount) : null,
    }));

    return ok("Engineering breakdown fetched successfully.", record);
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering breakdown");
  }
};
// ============================================================Update Breakdown
const breakdownUpdateFields = {
  EquipmentID: "EquipmentID",
  BreakdownDate: "BreakdownDate",
  BreakdownTime: "BreakdownTime",
  BreakdownReason: "BreakdownReason",
  PartsUsed: "PartsUsed",
  RepairedStatus: "RepairedStatus",
  RepairedDate: "RepairedDate",
  RepairedByID: "RepairedByID",
  Amount: "Amount",
};
const updateBreakdown = async (data) => {
  const client = await pool.connect();

  try {
    const breakdownID = Number(data.BreakdownID);

    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT
        BreakdownID,
        OrganizationID

      FROM Engineering_Breakdown_Entry

      WHERE BreakdownID = $1
        AND IsDeleted = FALSE

      FOR UPDATE;
      `,
      [breakdownID],
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");

      return fail("Engineering breakdown not found.", 404);
    }

    const organizationID = Number(existing.rows[0].organizationid);

    const changes =
      data.Changes && typeof data.Changes === "object" ? data.Changes : {};

    const assignments = [];
    const values = [];

    for (const [field, column] of Object.entries(breakdownUpdateFields)) {
      if (!Object.prototype.hasOwnProperty.call(changes, field)) {
        continue;
      }

      let value = changes[field];

      if (value === "" || value === undefined) {
        value = null;
      }

      values.push(value);

      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length) {
      values.push(data.UserID);

      const modifiedByIndex = values.length;

      values.push(breakdownID);

      const breakdownIndex = values.length;

      await client.query(
        `
        UPDATE Engineering_Breakdown_Entry

        SET
          ${assignments.join(", ")},

          ModifiedBy =
            $${modifiedByIndex},

          ModifiedDate =
            CURRENT_TIMESTAMP

        WHERE BreakdownID =
          $${breakdownIndex}

          AND IsDeleted = FALSE;
        `,
        values,
      );
    }

    // ========================================================
    // Delete Existing Selected Parts
    // ========================================================

    const deletePartIDs = Array.isArray(data.DeletePartIDs)
      ? data.DeletePartIDs.map(Number).filter(
          (id) => Number.isInteger(id) && id > 0,
        )
      : [];

    if (deletePartIDs.length) {
      await client.query(
        `
        UPDATE Engineering_Breakdown_Parts_Details

        SET
          IsDeleted = TRUE,

          DeletedBy = $1,

          DeletedDate =
            CURRENT_TIMESTAMP

        WHERE BreakdownID = $2

          AND BreakdownPartID =
            ANY($3::bigint[])

          AND IsDeleted = FALSE;
        `,
        [data.UserID, breakdownID, deletePartIDs],
      );
    }

    // ========================================================
    // Add New Parts
    // ========================================================

    const parts = Array.isArray(data.Parts) ? data.Parts : [];

    for (const part of parts) {
      await client.query(
        `
        INSERT INTO Engineering_Breakdown_Parts_Details
        (
          BreakdownID,
          OrganizationID,

          Item,
          Qty,
          Amount,

          IsDeleted,

          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,$2,
          $3,$4,$5,
          FALSE,
          $6,
          CURRENT_TIMESTAMP
        );
        `,
        [
          breakdownID,
          organizationID,

          part.Item || null,
          part.Qty ?? null,
          part.Amount ?? null,

          data.UserID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok("Engineering breakdown updated successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Update Engineering breakdown");
  } finally {
    client.release();
  }
};
// ============================================================Delete Breakdown
const deleteBreakdown = async (data) => {
  const client = await pool.connect();

  try {
    const breakdownID = Number(data.BreakdownID);

    if (!Number.isInteger(breakdownID) || breakdownID <= 0) {
      return fail("Valid BreakdownID is required.", 400);
    }

    await client.query("BEGIN");

    // ========================================================
    // Delete Breakdown
    // ========================================================

    const result = await client.query(
      `
      UPDATE Engineering_Breakdown_Entry

      SET
        IsDeleted = TRUE,

        DeletedBy = $1,

        DeletedDate =
          CURRENT_TIMESTAMP

      WHERE BreakdownID = $2
        AND IsDeleted = FALSE

      RETURNING BreakdownID;
      `,
      [data.UserID, breakdownID],
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");

      return fail("Engineering breakdown not found.", 404);
    }

    // ========================================================
    // Delete Parts
    // ========================================================

    await client.query(
      `
      UPDATE Engineering_Breakdown_Parts_Details

      SET
        IsDeleted = TRUE,

        DeletedBy = $1,

        DeletedDate =
          CURRENT_TIMESTAMP

      WHERE BreakdownID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, breakdownID],
    );

    await client.query("COMMIT");

    return ok("Engineering breakdown deleted successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Delete Engineering breakdown");
  } finally {
    client.release();
  }
};
// ============================================================Update Breakdown Status
const updateBreakdownStatus = async (data) => {
  try {
    const breakdownID = Number(data.BreakdownID);

    if (!Number.isInteger(breakdownID) || breakdownID <= 0) {
      return fail("Valid BreakdownID is required.", 400);
    }

    if (!data.RepairedStatus || !String(data.RepairedStatus).trim()) {
      return fail("RepairedStatus is required.", 400);
    }

    const repairedStatus = String(data.RepairedStatus).trim();

    const result = await pool.query(
      `
      UPDATE Engineering_Breakdown_Entry
      SET
        RepairedStatus = $1,
        RepairedDate = CURRENT_DATE,
        RepairedByID = $2
      WHERE BreakdownID = $3
        AND IsDeleted = FALSE
      RETURNING BreakdownID;
      `,
      [repairedStatus, data.UserID, breakdownID],
    );

    if (!result.rows.length) {
      return fail("Engineering breakdown not found.", 404);
    }

    return ok("Breakdown status updated successfully.");
  } catch (error) {
    return databaseFailure(error, "Update Engineering breakdown status");
  }
};
// ============================================================================================Vendor of Equipment
// =============================Vendor Mapper Helper
const mapVendor = (row) => ({
  VendorID: Number(row.vendorid),
  OrganizationID: Number(row.organizationid),
  EquipmentID: Number(row.equipmentid),

  Name: row.name || null,
  Address: row.address || null,

  MobileNumber: row.mobilenumber || null,
  SecondMobileNumber: row.secondmobilenumber || null,
  LandlineNumber: row.landlinenumber || null,

  City: row.city || null,
  Country: row.country || null,
  PinCode: row.pincode || null,
  Email: row.email || null,

  CreatedDate: formatDate(row.createddate),
});
// ============================================================create Vendor
const createVendor = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);
    const equipmentID = Number(data.EquipmentID);

    await pool.query(
      `
      INSERT INTO Engineering_Vendor_Entry
      (
        OrganizationID,
        EquipmentID,
        Name,
        Address,
        MobileNumber,
        SecondMobileNumber,
        LandlineNumber,
        City,
        Country,
        PinCode,
        Email,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        FALSE,$12,CURRENT_TIMESTAMP
      );
      `,
      [
        organizationID,
        equipmentID,
        data.Name,
        data.Address || null,
        data.MobileNumber || null,
        data.SecondMobileNumber || null,
        data.LandlineNumber || null,
        data.City || null,
        data.Country || null,
        data.PinCode || null,
        data.Email || null,
        data.UserID,
      ],
    );

    return ok("Engineering vendor created successfully.");
  } catch (error) {
    return databaseFailure(error, "Create Engineering vendor");
  }
};
// ============================================================Vendors List
const getAllVendors = async (data) => {
  try {
    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(Math.max(Number(data.PageSize) || 10, 1), 100);

    const offset = (page - 1) * pageSize;

    const values = [];
    const conditions = ["v.IsDeleted = FALSE"];

    if (data.OrganizationID) {
      values.push(Number(data.OrganizationID));

      conditions.push(`v.OrganizationID = $${values.length}`);
    }

    if (data.EquipmentID) {
      values.push(Number(data.EquipmentID));

      conditions.push(`v.EquipmentID = $${values.length}`);
    }

    if (data.Search && String(data.Search).trim()) {
      values.push(`%${String(data.Search).trim()}%`);

      const index = values.length;

      conditions.push(`
        (
          v.Name ILIKE $${index}
          OR v.MobileNumber ILIKE $${index}
          OR v.SecondMobileNumber ILIKE $${index}
          OR v.LandlineNumber ILIKE $${index}
          OR v.City ILIKE $${index}
          OR v.Country ILIKE $${index}
          OR v.PinCode ILIKE $${index}
          OR v.Email ILIKE $${index}
        )
      `);
    }

    const where = conditions.join(" AND ");

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::bigint AS TotalCount
      FROM Engineering_Vendor_Entry v
      WHERE ${where};
      `,
      values,
    );

    const totalCount = Number(countResult.rows[0].totalcount);

    const totalPages = Math.ceil(totalCount / pageSize);

    const listValues = [...values, pageSize, offset];

    const limitIndex = values.length + 1;
    const offsetIndex = values.length + 2;

    const result = await pool.query(
      `
      SELECT
        v.*
      FROM Engineering_Vendor_Entry v
      WHERE ${where}
      ORDER BY v.VendorID DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
      `,
      listValues,
    );

    return ok("Engineering vendors fetched successfully.", {
      TotalCount: totalCount,
      PageCount: result.rows.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: totalPages,
      data: result.rows.map(mapVendor),
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering vendors");
  }
};
// ============================================================Get Vendor by ID
const getVendorById = async (data) => {
  try {
    const vendorID = Number(data.VendorID);

    if (!Number.isInteger(vendorID) || vendorID <= 0) {
      return fail("Valid VendorID is required.", 400);
    }

    const result = await pool.query(
      `
      SELECT
        v.*
      FROM Engineering_Vendor_Entry v
      WHERE v.VendorID = $1
        AND v.IsDeleted = FALSE
      LIMIT 1;
      `,
      [vendorID],
    );

    if (!result.rows.length) {
      return fail("Engineering vendor not found.", 404);
    }

    return ok(
      "Engineering vendor fetched successfully.",
      mapVendor(result.rows[0]),
    );
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering vendor");
  }
};
// ============================================================Update Vendor
const vendorUpdateFields = {
  OrganizationID: "OrganizationID",
  EquipmentID: "EquipmentID",
  Name: "Name",
  Address: "Address",
  MobileNumber: "MobileNumber",
  SecondMobileNumber: "SecondMobileNumber",
  LandlineNumber: "LandlineNumber",
  City: "City",
  Country: "Country",
  PinCode: "PinCode",
  Email: "Email",
};
const updateVendor = async (data) => {
  try {
    const vendorID = Number(data.VendorID);

    if (!Number.isInteger(vendorID) || vendorID <= 0) {
      return fail("Valid VendorID is required.", 400);
    }

    const changes =
      data.Changes && typeof data.Changes === "object" ? data.Changes : {};

    const setParts = [];
    const values = [];

    for (const [key, column] of Object.entries(vendorUpdateFields)) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        values.push(
          changes[key] === "" || changes[key] === undefined
            ? null
            : changes[key],
        );

        setParts.push(`${column} = $${values.length}`);
      }
    }

    if (!setParts.length) {
      return fail("No valid changes provided.", 400);
    }

    values.push(data.UserID);

    setParts.push(`ModifiedBy = $${values.length}`);

    setParts.push("ModifiedDate = CURRENT_TIMESTAMP");

    values.push(vendorID);

    const vendorIndex = values.length;

    const result = await pool.query(
      `
      UPDATE Engineering_Vendor_Entry
      SET
        ${setParts.join(", ")}
      WHERE VendorID = $${vendorIndex}
        AND IsDeleted = FALSE
      RETURNING VendorID;
      `,
      values,
    );

    if (!result.rows.length) {
      return fail("Engineering vendor not found.", 404);
    }

    return ok("Engineering vendor updated successfully.");
  } catch (error) {
    return databaseFailure(error, "Update Engineering vendor");
  }
};
// ============================================================Delete Vendor
const deleteVendor = async (data) => {
  try {
    const vendorID = Number(data.VendorID);

    if (!Number.isInteger(vendorID) || vendorID <= 0) {
      return fail("Valid VendorID is required.", 400);
    }

    const result = await pool.query(
      `
      UPDATE Engineering_Vendor_Entry
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE VendorID = $2
        AND IsDeleted = FALSE
      RETURNING VendorID;
      `,
      [data.UserID, vendorID],
    );

    if (!result.rows.length) {
      return fail("Engineering vendor not found.", 404);
    }

    return ok("Engineering vendor deleted successfully.");
  } catch (error) {
    return databaseFailure(error, "Delete Engineering vendor");
  }
};
// ============================================================================================Maintenance of Equipment
// =========================================================================Maintenance Checklist Master
// =============================Maintenance Checklist Mapper Helper
const mapMaintenanceChecklist = (row) => ({
  ChecklistID: Number(row.checklistid),
  Title: row.title || null,
  // IsActive: row.isactive,
  CreatedDate: formatDate(row.createddate),
});
// ============================================================Create Maintenance Checklist
const createMaintenanceChecklist = async (data) => {
  try {
    await pool.query(
      `
      INSERT INTO Engineering_Maintenance_Checklist_Master
      (
        Title,
        IsActive,
        IsDeleted,
        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,
        $2,
        FALSE,
        $3,
        CURRENT_TIMESTAMP
      );
      `,
      [
        data.Title,
        data.IsActive !== undefined ? data.IsActive : true,
        data.UserID,
      ],
    );

    return ok("Maintenance checklist created successfully.");
  } catch (error) {
    return databaseFailure(error, "Create Maintenance checklist");
  }
};
// ============================================================Maintenance Checklist List
const getAllMaintenanceChecklists = async (data) => {
  try {
    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(Math.max(Number(data.PageSize) || 10, 1), 100);

    const offset = (page - 1) * pageSize;

    const values = [];
    const conditions = ["m.IsDeleted = FALSE"];

    if (data.IsActive !== undefined && data.IsActive !== "") {
      values.push(String(data.IsActive).toLowerCase() === "true");

      conditions.push(`m.IsActive = $${values.length}`);
    }

    if (data.Search && String(data.Search).trim()) {
      values.push(`%${String(data.Search).trim()}%`);

      conditions.push(`m.Title ILIKE $${values.length}`);
    }

    const where = conditions.join(" AND ");

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::bigint AS TotalCount
      FROM Engineering_Maintenance_Checklist_Master m
      WHERE ${where};
      `,
      values,
    );

    const totalCount = Number(countResult.rows[0].totalcount);

    const totalPages = Math.ceil(totalCount / pageSize);

    const listValues = [...values, pageSize, offset];

    const limitIndex = values.length + 1;
    const offsetIndex = values.length + 2;

    const result = await pool.query(
      `
      SELECT
        m.*
      FROM Engineering_Maintenance_Checklist_Master m
      WHERE ${where}
      ORDER BY m.ChecklistID DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
      `,
      listValues,
    );

    return ok("Maintenance checklists fetched successfully.", {
      TotalCount: totalCount,
      PageCount: result.rows.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: totalPages,
      data: result.rows.map(mapMaintenanceChecklist),
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Maintenance checklists");
  }
};
// ============================================================Update Maintenance Checklist
const maintenanceChecklistUpdateFields = {
  Title: "Title",
  IsActive: "IsActive",
};
const updateMaintenanceChecklist = async (data) => {
  try {
    const checklistID = Number(data.ChecklistID);

    if (!Number.isInteger(checklistID) || checklistID <= 0) {
      return fail("Valid ChecklistID is required.", 400);
    }

    const changes =
      data.Changes && typeof data.Changes === "object" ? data.Changes : {};

    const setParts = [];
    const values = [];

    for (const [key, column] of Object.entries(
      maintenanceChecklistUpdateFields,
    )) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        values.push(changes[key]);

        setParts.push(`${column} = $${values.length}`);
      }
    }

    if (!setParts.length) {
      return fail("No valid changes provided.", 400);
    }

    values.push(data.UserID);

    setParts.push(`ModifiedBy = $${values.length}`);

    setParts.push("ModifiedDate = CURRENT_TIMESTAMP");

    values.push(checklistID);

    const checklistIndex = values.length;

    const result = await pool.query(
      `
      UPDATE Engineering_Maintenance_Checklist_Master
      SET
        ${setParts.join(", ")}
      WHERE ChecklistID = $${checklistIndex}
        AND IsDeleted = FALSE
      RETURNING ChecklistID;
      `,
      values,
    );

    if (!result.rows.length) {
      return fail("Maintenance checklist not found.", 404);
    }

    return ok("Maintenance checklist updated successfully.");
  } catch (error) {
    return databaseFailure(error, "Update Maintenance checklist");
  }
};
// ============================================================Delete Maintenance Checklist
const deleteMaintenanceChecklist = async (data) => {
  try {
    const checklistID = Number(data.ChecklistID);

    if (!Number.isInteger(checklistID) || checklistID <= 0) {
      return fail("Valid ChecklistID is required.", 400);
    }

    const result = await pool.query(
      `
      UPDATE Engineering_Maintenance_Checklist_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE ChecklistID = $2
        AND IsDeleted = FALSE
      RETURNING ChecklistID;
      `,
      [data.UserID, checklistID],
    );

    if (!result.rows.length) {
      return fail("Maintenance checklist not found.", 404);
    }

    return ok("Maintenance checklist deleted successfully.");
  } catch (error) {
    return databaseFailure(error, "Delete Maintenance checklist");
  }
};
// =========================================================================Maintenance Details
// =============================Maintenance Details Mapper Helper
const mapMaintenance = (row) => ({
  MaintenanceID: Number(row.maintenanceid),
  OrganizationID: Number(row.organizationid),
  EquipmentID: Number(row.equipmentid),

  Maintenance: row.maintenance || null,
  MaintenanceDay: row.maintenanceday || null,
  MaintenanceDate: formatDate(row.maintenancedate),

  MaintenanceBy: row.maintenanceby || null,
  ServicedBy: row.servicedby ? Number(row.servicedby) : null,

  ServicedByName: row.servicedbyname || null,

  EngineerAssigned: row.engineerassigned ? Number(row.engineerassigned) : null,

  EngineerAssignedName: row.engineerassignedname || null,

  Status: row.status || null,

  CreatedDate: formatDate(row.createddate),

  Checklists: Array.isArray(row.checklists)
    ? row.checklists.map((item) => ({
        ChecklistID: Number(item.ChecklistID),

        Title: item.Title || null,

        IsChecked: item.IsChecked === true,
      }))
    : [],

  Documents: Array.isArray(row.documents)
    ? row.documents.map((doc) => ({
        MaintenanceDocumentID: Number(doc.MaintenanceDocumentID),

        FileName: doc.FileName || null,

        FileUrl: doc.FilePath ? generateUrl(doc.FilePath) : null,
      }))
    : [],
});
// =============================Create + Update Who deside WHat to do create or update
const saveMaintenance = async (data) => {
  try {
    const maintenanceID = Number(data.MaintenanceID);

    // CREATE
    if (
      !data.MaintenanceID ||
      !Number.isInteger(maintenanceID) ||
      maintenanceID <= 0
    ) {
      return await createMaintenance(data);
    }

    // UPDATE
    return await updateMaintenance({
      MaintenanceID: maintenanceID,
      Changes: data.Changes || {},
      Checklists: data.Checklists || [],
      DeleteChecklistEntryIDs: data.DeleteChecklistEntryIDs || [],
      Documents: data.Documents || [],
      DeleteDocumentIDs: data.DeleteDocumentIDs || [],
      UserID: data.UserID,
    });
  } catch (error) {
    return databaseFailure(error, "Save Engineering maintenance");
  }
};
// ============================================================Create Maintenance Details
const createMaintenance = async (data) => {
  const client = await pool.connect();

  try {
    const organizationID = Number(data.OrganizationID);

    const equipmentID = Number(data.EquipmentID);

    await client.query("BEGIN");

    // =====================================================
    // MAIN MAINTENANCE
    // =====================================================
    const status =
      data.Status && String(data.Status).trim()
        ? String(data.Status).trim()
        : "Pending";

    const result = await client.query(
      `
  INSERT INTO Engineering_Maintenance_Details
  (
    OrganizationID,
    EquipmentID,
    Maintenance,
    MaintenanceDay,
    MaintenanceDate,
    MaintenanceBy,
    ServicedBy,
    EngineerAssigned,
    Status,
    IsDeleted,
    CreatedBy,
    CreatedDate
  )
  VALUES
  (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,
    FALSE,$10,CURRENT_TIMESTAMP
  )
  RETURNING MaintenanceID;
  `,
      [
        organizationID,
        equipmentID,
        data.Maintenance || null,
        data.MaintenanceDay || null,
        data.MaintenanceDate || null,
        data.MaintenanceBy || null,
        data.ServicedBy || null,
        data.EngineerAssigned || null,
        status,
        data.UserID,
      ],
    );

    const maintenanceID = Number(result.rows[0].maintenanceid);

    // =====================================================
    // CHECKLIST
    // =====================================================

    const checklists = Array.isArray(data.Checklists) ? data.Checklists : [];

    for (const checklist of checklists) {
      await client.query(
        `
        INSERT INTO
        Engineering_Maintenance_Checklist_Entry_Details
        (
          MaintenanceID,
          ChecklistID,
          OrganizationID,
          IsChecked,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,$2,$3,$4,
          FALSE,$5,CURRENT_TIMESTAMP
        );
        `,
        [
          maintenanceID,
          checklist.ChecklistID,
          organizationID,
          checklist.IsChecked === true,
          data.UserID,
        ],
      );
    }

    // =====================================================
    // DOCUMENTS
    // =====================================================

    const documents = Array.isArray(data.Documents) ? data.Documents : [];

    for (const doc of documents) {
      await client.query(
        `
        INSERT INTO Engineering_Maintenance_Documents
        (
          MaintenanceID,
          OrganizationID,
          FileName,
          FilePath,
          FileType,
          FileSize,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,
          FALSE,$7,CURRENT_TIMESTAMP
        );
        `,
        [
          maintenanceID,
          organizationID,
          doc.FileName || null,
          doc.FilePath || null,
          doc.FileType || null,
          doc.FileSize || null,
          data.UserID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok("Engineering maintenance created successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Create Engineering maintenance");
  } finally {
    client.release();
  }
};
// ============================================================Maintenance Details List
const getAllMaintenance = async (data) => {
  try {
    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(Math.max(Number(data.PageSize) || 10, 1), 100);

    const equipmentID = Number(data.EquipmentID);

    // =====================================================
    // CHECK EQUIPMENT SCHEDULE
    // =====================================================
    let masterChecklists = [];
    let virtualMaintenance = null;
    const masterChecklistResult = await pool.query(
      `
    SELECT
      ChecklistID,
      Title
    FROM Engineering_Maintenance_Checklist_Master
    WHERE
      IsActive = TRUE
      AND IsDeleted = FALSE
    ORDER BY ChecklistID ASC;
    `,
    );

    masterChecklists = masterChecklistResult.rows.map((item) => ({
      ChecklistID: Number(item.checklistid),
      Title: item.title || null,
      IsChecked: false,
    }));
    if (Number.isInteger(equipmentID) && equipmentID > 0) {
      const equipmentResult = await pool.query(
        `
          SELECT
            EquipmentID,
            OrganizationID,
            ScheduleOfServicing,
            ScheduleDay,

            EXTRACT(
              MONTH FROM CURRENT_DATE
            )::int AS CurrentMonth,

            EXTRACT(
              YEAR FROM CURRENT_DATE
            )::int AS CurrentYear

          FROM Engineering_Equipment_Entry_Master

          WHERE
            EquipmentID = $1
            AND IsDeleted = FALSE

          LIMIT 1;
          `,
        [equipmentID],
      );

      if (equipmentResult.rows.length) {
        const equipment = equipmentResult.rows[0];

        const schedule = String(equipment.scheduleofservicing || "")
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, "");

        // ScheduleDay varchar hai,
        // isliye number extract kar rahe hain.
        // Example:
        // "15" -> 15
        // "Day-15" -> 15

        const dayMatch = String(equipment.scheduleday || "").match(/\d+/);

        const scheduleDay = dayMatch ? Number(dayMatch[0]) : null;

        const currentMonth = Number(equipment.currentmonth);

        const currentYear = Number(equipment.currentyear);

        // =================================================
        // CHECK CURRENT MONTH IS SCHEDULED OR NOT
        // =================================================

        let isDueMonth = false;

        switch (schedule) {
          // ===============================================
          // MONTHLY
          // Jan, Feb, Mar ... Dec
          // ===============================================

          case "monthly":
            isDueMonth = true;
            break;

          // ===============================================
          // BI-MONTHLY
          // Jan, Mar, May, Jul, Sep, Nov
          // ===============================================

          case "bimonth":
          case "bimonthly":
            isDueMonth = [1, 3, 5, 7, 9, 11].includes(currentMonth);
            break;

          // ===============================================
          // QUARTERLY
          // Jan, Apr, Jul, Oct
          // ===============================================

          case "quarterly":
          case "quarter":
            isDueMonth = [1, 4, 7, 10].includes(currentMonth);
            break;

          // ===============================================
          // SIX MONTHLY
          // Jan, Jul
          // ===============================================

          case "sixmonth":
          case "sixmonthly":
          case "6month":
          case "6monthly":
            isDueMonth = [1, 7].includes(currentMonth);
            break;

          // ===============================================
          // YEARLY
          // January only
          // ===============================================

          case "yearly":
          case "annual":
          case "annually":
            isDueMonth = currentMonth === 1;
            break;

          default:
            isDueMonth = false;
            break;
        }

        // =================================================
        // VALID SCHEDULE DAY
        // =================================================

        if (isDueMonth && Number.isInteger(scheduleDay) && scheduleDay > 0) {
          // Current month ke maximum days
          // Example February = 28/29
          // September = 30

          const maxDay = new Date(currentYear, currentMonth, 0).getDate();

          const finalScheduleDay = Math.min(scheduleDay, maxDay);

          const monthText = String(currentMonth).padStart(2, "0");

          const dayText = String(finalScheduleDay).padStart(2, "0");

          const scheduledDate = `${currentYear}-${monthText}-${dayText}`;

          // ===============================================
          // CHECK CURRENT MONTH MAINTENANCE ALREADY EXISTS
          // ===============================================

          const existingMaintenance = await pool.query(
            `
              SELECT
                MaintenanceID

              FROM Engineering_Maintenance_Details

              WHERE
                EquipmentID = $1

                AND IsDeleted = FALSE

                AND MaintenanceDate >=
                  DATE_TRUNC(
                    'month',
                    CURRENT_DATE
                  )::date

                AND MaintenanceDate <
                  (
                    DATE_TRUNC(
                      'month',
                      CURRENT_DATE
                    )
                    + INTERVAL '1 month'
                  )::date

              LIMIT 1;
              `,
            [equipmentID],
          );

          // ===============================================
          // CREATE VIRTUAL PENDING ROW
          // ===============================================

          if (!existingMaintenance.rows.length) {
            virtualMaintenance = {
              MaintenanceID: 0,

              OrganizationID: Number(equipment.organizationid),

              EquipmentID: equipmentID,

              Maintenance: null,

              MaintenanceDay: null,

              MaintenanceDate: formatDate(scheduledDate),

              MaintenanceBy: null,

              ServicedBy: null,

              ServicedByName: null,

              EngineerAssigned: null,

              EngineerAssignedName: null,

              Status: "Pending",

              CreatedDate: null,
              Checklists: masterChecklists,
              Documents: [],
            };
          }
        }
      }
    }

    // =====================================================
    // FILTER CONDITIONS
    // =====================================================

    const values = [];

    const conditions = ["m.IsDeleted = FALSE"];

    // =====================================================
    // ORGANIZATION
    // =====================================================

    if (data.OrganizationID) {
      values.push(Number(data.OrganizationID));

      conditions.push(`m.OrganizationID = $${values.length}`);
    }

    // =====================================================
    // EQUIPMENT
    // =====================================================

    if (data.EquipmentID) {
      values.push(Number(data.EquipmentID));

      conditions.push(`m.EquipmentID = $${values.length}`);
    }

    // =====================================================
    // STATUS
    // =====================================================

    if (data.Status && String(data.Status).trim()) {
      values.push(String(data.Status).trim());

      conditions.push(`m.Status = $${values.length}`);
    }

    // =====================================================
    // FROM DATE
    // =====================================================

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(`m.MaintenanceDate >= $${values.length}`);
    }

    // =====================================================
    // TO DATE
    // =====================================================

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(`m.MaintenanceDate <= $${values.length}`);
    }

    // =====================================================
    // SEARCH
    // =====================================================

    if (data.Search && String(data.Search).trim()) {
      values.push(`%${String(data.Search).trim()}%`);

      const index = values.length;

      conditions.push(`
        (
          m.Maintenance ILIKE $${index}

          OR m.MaintenanceBy
            ILIKE $${index}

          OR EXISTS
          (
            SELECT 1

            FROM user_master searchUser

            WHERE
              searchUser.UserID =
                m.ServicedBy

              AND searchUser.IsDeleted =
                FALSE

              AND searchUser.FullName
                ILIKE $${index}
          )
        )
      `);
    }

    const where = conditions.join(" AND ");

    // =====================================================
    // COUNT EXISTING RECORDS
    // =====================================================

    const countResult = await pool.query(
      `
        SELECT
          COUNT(*)::bigint
            AS TotalCount

        FROM Engineering_Maintenance_Details m

        WHERE ${where};
        `,
      values,
    );

    const databaseTotalCount = Number(countResult.rows[0].totalcount);

    // Virtual maintenance bhi count me include
    const totalCount = databaseTotalCount + (virtualMaintenance ? 1 : 0);

    const totalPages = Math.ceil(totalCount / pageSize);

    // =====================================================
    // PAGINATION
    //
    // Virtual row page 1 par first row hogi.
    // Isliye existing DB pagination ko adjust
    // kar rahe hain.
    // =====================================================

    let databaseLimit = pageSize;

    let databaseOffset = (page - 1) * pageSize;

    if (virtualMaintenance) {
      if (page === 1) {
        databaseLimit = Math.max(pageSize - 1, 0);

        databaseOffset = 0;
      } else {
        databaseLimit = pageSize;

        databaseOffset = Math.max((page - 1) * pageSize - 1, 0);
      }
    }

    // =====================================================
    // LIST
    // =====================================================

    const listValues = [...values, databaseLimit, databaseOffset];

    const limitIndex = values.length + 1;

    const offsetIndex = values.length + 2;

    const result = await pool.query(
      `
  SELECT
    m.*,

    u.FullName AS EngineerAssignedName,
    sb.FullName AS ServicedByName,

    COALESCE(
      (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'ChecklistEntryID',
              c.ChecklistEntryID,

            'ChecklistID',
              cm.ChecklistID,

            'Title',
              cm.Title,

            'IsChecked',
              COALESCE(c.IsChecked, FALSE)
          )
          ORDER BY cm.ChecklistID
        )

        FROM Engineering_Maintenance_Checklist_Master cm

        LEFT JOIN Engineering_Maintenance_Checklist_Entry_Details c
          ON c.ChecklistID = cm.ChecklistID
          AND c.MaintenanceID = m.MaintenanceID
          AND c.IsDeleted = FALSE

        WHERE
          cm.IsActive = TRUE
          AND cm.IsDeleted = FALSE
      ),
      '[]'::json
    ) AS Checklists,

    COALESCE(
      (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'MaintenanceDocumentID',
              d.MaintenanceDocumentID,

            'FileName',
              d.FileName,

            'FilePath',
              d.FilePath,

            'FileType',
              d.FileType,

            'FileSize',
              d.FileSize
          )
          ORDER BY d.MaintenanceDocumentID
        )

        FROM Engineering_Maintenance_Documents d

        WHERE
          d.MaintenanceID = m.MaintenanceID
          AND d.IsDeleted = FALSE
      ),
      '[]'::json
    ) AS Documents

  FROM Engineering_Maintenance_Details m

  LEFT JOIN user_master u
    ON u.UserID = m.EngineerAssigned
    AND u.IsDeleted = FALSE

  LEFT JOIN user_master sb
    ON sb.UserID = m.ServicedBy
    AND sb.IsDeleted = FALSE

  WHERE ${where}

  ORDER BY m.MaintenanceID DESC

  LIMIT $${limitIndex}
  OFFSET $${offsetIndex};
  `,
      listValues,
    );

    // =====================================================
    // MAP DATABASE RECORDS
    // =====================================================

    const records = result.rows.map(mapMaintenance);

    // =====================================================
    // ADD VIRTUAL SCHEDULED MAINTENANCE
    //
    // Only page 1
    // =====================================================

    if (virtualMaintenance && page === 1) {
      records.unshift(virtualMaintenance);
    }

    // =====================================================
    // RESPONSE
    // =====================================================

    return ok("Engineering maintenance fetched successfully.", {
      TotalCount: totalCount,

      PageCount: records.length,

      CurrentPage: page,

      PageSize: pageSize,

      TotalPages: totalPages,

      data: records,
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering maintenance");
  }
};
// ============================================================Get Maintenance Details By Id
const getMaintenanceById = async (data) => {
  try {
    const maintenanceID = Number(data.MaintenanceID);

    if (!Number.isInteger(maintenanceID) || maintenanceID <= 0) {
      return fail("Valid MaintenanceID is required.", 400);
    }

    const result = await pool.query(
      `
        SELECT
          m.*,
          u.FullName AS EngineerAssignedName,
  sb.FullName AS ServicedByName

        FROM Engineering_Maintenance_Details m

        LEFT JOIN user_master u
          ON u.UserID =
             m.EngineerAssigned
          AND u.IsDeleted = FALSE
LEFT JOIN user_master sb
  ON sb.UserID = m.ServicedBy
  AND sb.IsDeleted = FALSE
        WHERE
          m.MaintenanceID = $1
          AND m.IsDeleted = FALSE

        LIMIT 1;
        `,
      [maintenanceID],
    );

    if (!result.rows.length) {
      return fail("Engineering maintenance not found.", 404);
    }

    const record = mapMaintenance(result.rows[0]);

    // =====================================================
    // CHECKLIST
    // =====================================================

    const checklistResult = await pool.query(
      `
        SELECT
          c.ChecklistEntryID,
          c.MaintenanceID,
          c.ChecklistID,
          c.OrganizationID,
          c.IsChecked,
          cm.Title

        FROM
          Engineering_Maintenance_Checklist_Entry_Details c

        LEFT JOIN
          Engineering_Maintenance_Checklist_Master cm
          ON cm.ChecklistID =
             c.ChecklistID
          AND cm.IsDeleted = FALSE

        WHERE
          c.MaintenanceID = $1
          AND c.IsDeleted = FALSE

        ORDER BY
          c.ChecklistEntryID ASC;
        `,
      [maintenanceID],
    );

    record.Checklists = checklistResult.rows.map((row) => ({
      ChecklistID: Number(row.checklistid),

      Title: row.title || null,

      IsChecked: row.ischecked === true,
    }));

    // =====================================================
    // DOCUMENTS
    // =====================================================

    const documentResult = await pool.query(
      `
        SELECT
          MaintenanceDocumentID,
          MaintenanceID,
          OrganizationID,
          FileName,
          FilePath,
          FileType,
          FileSize

        FROM
          Engineering_Maintenance_Documents

        WHERE
          MaintenanceID = $1
          AND IsDeleted = FALSE

        ORDER BY
          MaintenanceDocumentID ASC;
        `,
      [maintenanceID],
    );

    record.Documents = documentResult.rows.map((row) => ({
      MaintenanceDocumentID: Number(row.maintenancedocumentid),

      MaintenanceID: Number(row.maintenanceid),

      OrganizationID: Number(row.organizationid),

      FileName: row.filename || null,

      FilePath: row.filepath || null,

      FileType: row.filetype || null,

      FileSize: row.filesize !== null ? Number(row.filesize) : null,

      FileUrl: row.filepath ? generateUrl(row.filepath) : null,
    }));

    return ok("Engineering maintenance fetched successfully.", record);
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering maintenance");
  }
};
// ============================================================Update Maintenance Details
const maintenanceUpdateFields = {
  OrganizationID: "OrganizationID",

  EquipmentID: "EquipmentID",

  Maintenance: "Maintenance",

  MaintenanceDay: "MaintenanceDay",

  MaintenanceBy: "MaintenanceBy",

  ServicedBy: "ServicedBy",

  EngineerAssigned: "EngineerAssigned",

  Status: "Status",
};
const updateMaintenance = async (data) => {
  const client = await pool.connect();

  try {
    const maintenanceID = Number(data.MaintenanceID);

    if (!Number.isInteger(maintenanceID) || maintenanceID <= 0) {
      return fail("Valid MaintenanceID is required.", 400);
    }

    await client.query("BEGIN");

    // =====================================================
    // LOCK / CHECK
    // =====================================================

    const existing = await client.query(
      `
        SELECT
          OrganizationID
        FROM Engineering_Maintenance_Details
        WHERE
          MaintenanceID = $1
          AND IsDeleted = FALSE
        FOR UPDATE;
        `,
      [maintenanceID],
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");

      return fail("Engineering maintenance not found.", 404);
    }

    const organizationID = Number(existing.rows[0].organizationid);

    // =====================================================
    // MAIN UPDATE
    // =====================================================

    const changes =
      data.Changes && typeof data.Changes === "object" ? data.Changes : {};

    const setParts = [];
    const values = [];

    for (const [key, column] of Object.entries(maintenanceUpdateFields)) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        let value = changes[key];

        if (value === "" || value === undefined) {
          value = null;
        }

        values.push(value);

        setParts.push(`${column} = $${values.length}`);
      }
    }

    if (setParts.length) {
      values.push(data.UserID);

      setParts.push(`ModifiedBy = $${values.length}`);

      setParts.push("ModifiedDate = CURRENT_TIMESTAMP");

      values.push(maintenanceID);

      await client.query(
        `
        UPDATE Engineering_Maintenance_Details
        SET
          ${setParts.join(", ")}
        WHERE
          MaintenanceID =
            $${values.length}
          AND IsDeleted = FALSE;
        `,
        values,
      );
    }

    // =====================================================
    // DELETE CHECKLIST ENTRIES
    // =====================================================

    const deleteChecklistEntryIDs = Array.isArray(data.DeleteChecklistEntryIDs)
      ? data.DeleteChecklistEntryIDs
      : [];

    if (deleteChecklistEntryIDs.length) {
      await client.query(
        `
        UPDATE
          Engineering_Maintenance_Checklist_Entry_Details

        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate =
            CURRENT_TIMESTAMP

        WHERE
          MaintenanceID = $2
          AND ChecklistEntryID =
            ANY($3::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.UserID, maintenanceID, deleteChecklistEntryIDs],
      );
    }

    // =====================================================
    // ADD / UPDATE CHECKLIST
    // =====================================================

    const checklists = Array.isArray(data.Checklists) ? data.Checklists : [];

    for (const item of checklists) {
      // Existing checklist entry
      if (item.ChecklistEntryID) {
        await client.query(
          `
          UPDATE
            Engineering_Maintenance_Checklist_Entry_Details

          SET
            IsChecked = $1,
            ModifiedBy = $2,
            ModifiedDate =
              CURRENT_TIMESTAMP

          WHERE
            ChecklistEntryID = $3
            AND MaintenanceID = $4
            AND IsDeleted = FALSE;
          `,
          [
            item.IsChecked === true,
            data.UserID,
            item.ChecklistEntryID,
            maintenanceID,
          ],
        );
      }

      // New checklist
      else if (item.ChecklistID) {
        await client.query(
          `
          INSERT INTO
            Engineering_Maintenance_Checklist_Entry_Details
          (
            MaintenanceID,
            ChecklistID,
            OrganizationID,
            IsChecked,
            IsDeleted,
            CreatedBy,
            CreatedDate
          )
          VALUES
          (
            $1,$2,$3,$4,
            FALSE,$5,
            CURRENT_TIMESTAMP
          );
          `,
          [
            maintenanceID,
            item.ChecklistID,
            organizationID,
            item.IsChecked === true,
            data.UserID,
          ],
        );
      }
    }

    // =====================================================
    // DELETE DOCUMENTS
    // =====================================================

    const deleteDocumentIDs = Array.isArray(data.DeleteDocumentIDs)
      ? data.DeleteDocumentIDs
      : [];

    if (deleteDocumentIDs.length) {
      await client.query(
        `
        UPDATE
          Engineering_Maintenance_Documents

        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate =
            CURRENT_TIMESTAMP

        WHERE
          MaintenanceID = $2
          AND MaintenanceDocumentID =
            ANY($3::bigint[])
          AND IsDeleted = FALSE;
        `,
        [data.UserID, maintenanceID, deleteDocumentIDs],
      );
    }

    // =====================================================
    // NEW DOCUMENTS
    // =====================================================

    const documents = Array.isArray(data.Documents) ? data.Documents : [];

    for (const doc of documents) {
      await client.query(
        `
        INSERT INTO
          Engineering_Maintenance_Documents
        (
          MaintenanceID,
          OrganizationID,
          FileName,
          FilePath,
          FileType,
          FileSize,
          IsDeleted,
          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,
          FALSE,$7,
          CURRENT_TIMESTAMP
        );
        `,
        [
          maintenanceID,
          organizationID,
          doc.FileName || null,
          doc.FilePath || null,
          doc.FileType || null,
          doc.FileSize || null,
          data.UserID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok("Engineering maintenance updated successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Update Engineering maintenance");
  } finally {
    client.release();
  }
};
// ============================================================DELETE Maintenance Details
const deleteMaintenance = async (data) => {
  const client = await pool.connect();

  try {
    const maintenanceID = Number(data.MaintenanceID);

    if (!Number.isInteger(maintenanceID) || maintenanceID <= 0) {
      return fail("Valid MaintenanceID is required.", 400);
    }

    await client.query("BEGIN");

    const result = await client.query(
      `
        UPDATE Engineering_Maintenance_Details
        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate =
            CURRENT_TIMESTAMP
        WHERE
          MaintenanceID = $2
          AND IsDeleted = FALSE
        RETURNING MaintenanceID;
        `,
      [data.UserID, maintenanceID],
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");

      return fail("Engineering maintenance not found.", 404);
    }

    await client.query(
      `
      UPDATE
        Engineering_Maintenance_Checklist_Entry_Details
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate =
          CURRENT_TIMESTAMP
      WHERE
        MaintenanceID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, maintenanceID],
    );

    await client.query(
      `
      UPDATE
        Engineering_Maintenance_Documents
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate =
          CURRENT_TIMESTAMP
      WHERE
        MaintenanceID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, maintenanceID],
    );

    await client.query("COMMIT");

    return ok("Engineering maintenance deleted successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Delete Engineering maintenance");
  } finally {
    client.release();
  }
};
// ============================================================================================Reports of Equipment
// =============================================================1.Total Number of Machine Reports
const getTotalEquipmentReports = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(Math.max(Number(data.PageSize) || 10, 1), 100);

    const offset = (page - 1) * pageSize;

    const values = [organizationID];

    const conditions = ["e.OrganizationID = $1", "e.IsDeleted = FALSE"];

    // ========================================================
    // DepartmentID Filter
    // ========================================================

    if (data.DepartmentID) {
      values.push(Number(data.DepartmentID));

      conditions.push(`e.DepartmentID = $${values.length}`);
    }

    // ========================================================
    // Other Filters
    // ========================================================

    for (const [parameter, column, operator] of [
      ["WarrantyStatus", "WarrantyStatus", "="],
      ["AMCStatus", "AMCStatus", "="],
      ["AMCType", "AMCType", "="],
      ["AMCStartDate", "AMCStartDate", "="],
      ["WarrantyStartDate", "WarrantyStartDate", "="],
      ["AMCEndDate", "AMCEndDate", "="],
      ["WarrantyEndDate", "WarrantyEndDate", "="],
      ["SerialNo", "SerialNumber", "ILIKE"],
      ["Area", "Area", "ILIKE"],
      ["EquipmentID", "EquipmentID", "="],
    ]) {
      const value = String(data[parameter] ?? "").trim();

      if (!value) continue;

      values.push(operator === "ILIKE" ? `%${value}%` : value);

      conditions.push(`e.${column} ${operator} $${values.length}`);
    }

    // ========================================================
    // Search
    // ========================================================

    if (data.Search) {
      values.push(`%${String(data.Search).trim()}%`);

      conditions.push(
        `
        (
          e.Description ILIKE $${values.length}
          OR e.SerialNumber ILIKE $${values.length}
          OR e.ModelNumber ILIKE $${values.length}
          OR e.Make ILIKE $${values.length}
          OR e.Area ILIKE $${values.length}
        )
        `,
      );
    }

    const where = conditions.join(" AND ");

    // ========================================================
    // Total Count
    // ========================================================

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS TotalCount
      FROM Engineering_Equipment_Entry_Master e
      WHERE ${where};
      `,
      values,
    );

    const totalCount = Number(countResult.rows[0].totalcount);

    // ========================================================
    // Equipment List
    // ========================================================

    const listValues = [...values, pageSize, offset];

    const result = await pool.query(
      `
  SELECT
    e.*,

    om.ShortName AS OrganizationShortName,

    d.DepartmentName AS DepartmentName,

    u.FullName AS ResponsiblePersonName

  FROM Engineering_Equipment_Entry_Master e

  LEFT JOIN Organization_Master om
    ON om.OrganizationID = e.OrganizationID
   AND om.IsDeleted = FALSE

  LEFT JOIN department_master d
    ON d.DepartmentID = e.DepartmentID
   AND d.OrganizationID = e.OrganizationID
   AND d.IsDeleted = FALSE

  LEFT JOIN user_master u
    ON u.UserID = e.ResponsiblePerson
   AND u.IsDeleted = FALSE

  WHERE ${where}

  ORDER BY e.EquipmentID DESC

  LIMIT $${listValues.length - 1}
  OFFSET $${listValues.length};
  `,
      listValues,
    );

    let records = result.rows.map(mapEquipment);

    return ok("Engineering equipment fetched successfully.", records, {
      TotalCount: totalCount,
      PageCount: records.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering equipment");
  }
};
// =============================================================2.Breakdown Reports 
const getAllBreakdownsReport = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(
      Math.max(Number(data.PageSize) || 10, 1),
      100,
    );

    const offset = (page - 1) * pageSize;

    const values = [organizationID];

    const conditions = [
      "b.OrganizationID = $1",
      "b.IsDeleted = FALSE",
    ];

    // ========================================================
    // EquipmentID Filter
    // ========================================================

    if (data.EquipmentID) {
      values.push(Number(data.EquipmentID));

      conditions.push(
        `b.EquipmentID = $${values.length}`,
      );
    }

    // ========================================================
    // Repaired Status Filter
    // Pending / Repaired / Empty = All
    // ========================================================

    if (
      data.RepairedStatus &&
      String(data.RepairedStatus).trim()
    ) {
      values.push(
        String(data.RepairedStatus).trim(),
      );

      conditions.push(
        `b.RepairedStatus = $${values.length}`,
      );
    }

    // ========================================================
    // BreakdownDate Exact Filter
    // ========================================================

    if (data.BreakdownDate) {
      values.push(data.BreakdownDate);

      conditions.push(
        `b.BreakdownDate = $${values.length}`,
      );
    }

    // ========================================================
    // From Date
    // ========================================================

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `b.BreakdownDate >= $${values.length}`,
      );
    }

    // ========================================================
    // To Date
    // ========================================================

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `b.BreakdownDate <= $${values.length}`,
      );
    }

    // ========================================================
    // Search
    // ========================================================

    if (
      data.Search &&
      String(data.Search).trim()
    ) {
      values.push(
        `%${String(data.Search).trim()}%`,
      );

      conditions.push(
        `
        (
          b.BreakdownReason ILIKE $${values.length}

          OR b.PartsUsed ILIKE $${values.length}

          OR em.Description ILIKE $${values.length}

          OR em.Area ILIKE $${values.length}

          OR EXISTS
          (
            SELECT 1
            FROM Engineering_Breakdown_Parts_Details bp
            WHERE bp.BreakdownID = b.BreakdownID
              AND bp.IsDeleted = FALSE
              AND bp.Item ILIKE $${values.length}
          )
        )
        `,
      );
    }

    const where = conditions.join(" AND ");

    // ========================================================
    // Count
    // ========================================================

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS TotalCount

      FROM Engineering_Breakdown_Entry b

      LEFT JOIN Engineering_Equipment_Entry_Master em
        ON em.EquipmentID = b.EquipmentID
       AND em.IsDeleted = FALSE

      WHERE ${where};
      `,
      values,
    );

    const totalCount =
      Number(countResult.rows[0].totalcount);

    // ========================================================
    // List
    // ========================================================

    const listValues = [
      ...values,
      pageSize,
      offset,
    ];

    const result = await pool.query(
      `
      SELECT
        b.*,

        om.ShortName AS OrganizationShortName,

        u.FullName AS RepairedByName,

        em.Description AS EquipmentDescription,

        em.Area AS EquipmentArea

      FROM Engineering_Breakdown_Entry b

      LEFT JOIN Organization_Master om
        ON om.OrganizationID = b.OrganizationID
       AND om.IsDeleted = FALSE

      LEFT JOIN user_master u
        ON u.UserID = b.RepairedByID
       AND u.IsDeleted = FALSE

      LEFT JOIN Engineering_Equipment_Entry_Master em
        ON em.EquipmentID = b.EquipmentID
       AND em.IsDeleted = FALSE

      WHERE ${where}

      ORDER BY b.BreakdownID DESC

      LIMIT $${listValues.length - 1}
      OFFSET $${listValues.length};
      `,
      listValues,
    );

    const records =
      result.rows.map((row) => ({
        ...mapBreakdown(row),

        EquipmentDescription:
          row.equipmentdescription || null,

        EquipmentArea:
          row.equipmentarea || null,
      }));

    return ok(
      "Engineering breakdown report fetched successfully.",
      records,
      {
        TotalCount: totalCount,
        PageCount: records.length,
        CurrentPage: page,
        PageSize: pageSize,
        TotalPages:
          Math.ceil(totalCount / pageSize),
      },
    );
  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Engineering breakdown report",
    );
  }
};
// =============================================================3. Daily Maintenance Reports
const getDailyMaintenanceReports = async (data) => {
  try {
    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(
      Math.max(Number(data.PageSize) || 10, 1),
      100,
    );

    const organizationID = Number(data.OrganizationID);

    const equipmentID =
      data.EquipmentID &&
      String(data.EquipmentID).trim()
        ? Number(data.EquipmentID)
        : null;

    // =====================================================
    // VIRTUAL SCHEDULED MAINTENANCE
    // =====================================================

    let virtualMaintenances = [];

    // =====================================================
    // FETCH EQUIPMENT
    //
    // EquipmentID diya hai:
    //   sirf wahi equipment
    //
    // EquipmentID blank hai:
    //   organization ke saare equipment
    // =====================================================

    const equipmentValues = [];
    const equipmentConditions = [
      "e.IsDeleted = FALSE",
    ];

    if (
      Number.isInteger(organizationID) &&
      organizationID > 0
    ) {
      equipmentValues.push(organizationID);

      equipmentConditions.push(
        `e.OrganizationID = $${equipmentValues.length}`,
      );
    }

    if (
      Number.isInteger(equipmentID) &&
      equipmentID > 0
    ) {
      equipmentValues.push(equipmentID);

      equipmentConditions.push(
        `e.EquipmentID = $${equipmentValues.length}`,
      );
    }

    const equipmentResult = await pool.query(
      `
      SELECT
        e.EquipmentID,
        e.OrganizationID,
        e.Description,
        e.SerialNumber,
        e.Capacity,
        e.ModelNumber,
        e.Make,
        e.Area,
        e.ScheduleOfServicing,
        e.ScheduleDay,

        EXTRACT(
          MONTH FROM CURRENT_DATE
        )::int AS CurrentMonth,

        EXTRACT(
          YEAR FROM CURRENT_DATE
        )::int AS CurrentYear

      FROM Engineering_Equipment_Entry_Master e

      WHERE
        ${equipmentConditions.join(" AND ")}

      ORDER BY
        e.EquipmentID ASC;
      `,
      equipmentValues,
    );

    // =====================================================
    // FIND EXISTING CURRENT MONTH MAINTENANCE
    // =====================================================

    const equipmentIDs =
      equipmentResult.rows.map((item) =>
        Number(item.equipmentid),
      );

    const existingEquipmentIDs =
      new Set();

    if (equipmentIDs.length) {
      const existingResult =
        await pool.query(
          `
          SELECT DISTINCT
            EquipmentID

          FROM Engineering_Maintenance_Details

          WHERE
            EquipmentID = ANY($1::bigint[])

            AND IsDeleted = FALSE

            AND MaintenanceDate >=
              DATE_TRUNC(
                'month',
                CURRENT_DATE
              )::date

            AND MaintenanceDate <
              (
                DATE_TRUNC(
                  'month',
                  CURRENT_DATE
                )
                + INTERVAL '1 month'
              )::date;
          `,
          [equipmentIDs],
        );

      existingResult.rows.forEach(
        (item) => {
          existingEquipmentIDs.add(
            Number(item.equipmentid),
          );
        },
      );
    }

    // =====================================================
    // CREATE VIRTUAL MAINTENANCE FOR EACH EQUIPMENT
    // =====================================================

    for (
      const equipment of
      equipmentResult.rows
    ) {
      const currentEquipmentID =
        Number(
          equipment.equipmentid,
        );

      // Current month maintenance already exists
      if (
        existingEquipmentIDs.has(
          currentEquipmentID,
        )
      ) {
        continue;
      }

      const schedule = String(
        equipment.scheduleofservicing ||
          "",
      )
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");

      const dayMatch = String(
        equipment.scheduleday || "",
      ).match(/\d+/);

      const scheduleDay =
        dayMatch
          ? Number(dayMatch[0])
          : null;

      const currentMonth =
        Number(
          equipment.currentmonth,
        );

      const currentYear =
        Number(
          equipment.currentyear,
        );

      // ===================================================
      // CHECK CURRENT MONTH IS DUE
      // ===================================================

      let isDueMonth = false;

      switch (schedule) {
        case "monthly":
          isDueMonth = true;
          break;

        case "bimonth":
        case "bimonthly":
          isDueMonth =
            [
              1,
              3,
              5,
              7,
              9,
              11,
            ].includes(
              currentMonth,
            );
          break;

        case "quarterly":
        case "quarter":
          isDueMonth =
            [
              1,
              4,
              7,
              10,
            ].includes(
              currentMonth,
            );
          break;

        case "sixmonth":
        case "sixmonthly":
        case "6month":
        case "6monthly":
          isDueMonth =
            [
              1,
              7,
            ].includes(
              currentMonth,
            );
          break;

        case "yearly":
        case "annual":
        case "annually":
          isDueMonth =
            currentMonth === 1;
          break;

        default:
          isDueMonth = false;
          break;
      }

      if (!isDueMonth) {
        continue;
      }

      if (
        !Number.isInteger(
          scheduleDay,
        ) ||
        scheduleDay <= 0
      ) {
        continue;
      }

      // ===================================================
      // SCHEDULE DATE
      // ===================================================

      const maxDay =
        new Date(
          currentYear,
          currentMonth,
          0,
        ).getDate();

      const finalScheduleDay =
        Math.min(
          scheduleDay,
          maxDay,
        );

      const monthText =
        String(
          currentMonth,
        ).padStart(
          2,
          "0",
        );

      const dayText =
        String(
          finalScheduleDay,
        ).padStart(
          2,
          "0",
        );

      const scheduledDate =
        `${currentYear}-${monthText}-${dayText}`;

      // ===================================================
      // MAINTENANCE DATE EXACT FILTER
      // Virtual row par bhi apply
      // ===================================================

      if (
        data.MaintenanceDate &&
        String(
          data.MaintenanceDate,
        ) !== scheduledDate
      ) {
        continue;
      }

      // ===================================================
      // STATUS FILTER
      // Virtual row always Pending
      // ===================================================

      if (
        data.Status &&
        String(
          data.Status,
        ).trim() &&
        String(
          data.Status,
        )
          .trim()
          .toLowerCase() !==
          "pending"
      ) {
        continue;
      }

      // ===================================================
      // CREATE VIRTUAL ROW
      // ===================================================

      virtualMaintenances.push({
        MaintenanceID: 0,

        OrganizationID:
          Number(
            equipment.organizationid,
          ),

        EquipmentID:
          currentEquipmentID,

        MaintenanceBy:
          null,

        Status:
          "Pending",

        MaintenanceDate:
          formatDate(
            scheduledDate,
          ),

        Description:
          equipment.description ||
          null,

        SerialNumber:
          equipment.serialnumber ||
          null,

        Capacity:
          equipment.capacity ||
          null,

        ModelNumber:
          equipment.modelnumber ||
          null,

        Make:
          equipment.make ||
          null,

        Area:
          equipment.area ||
          null,

        ScheduleOfServicing:
          equipment.scheduleofservicing ||
          null,

        ScheduleDay:
          equipment.scheduleday ||
          null,
      });
    }

    // =====================================================
    // DATABASE FILTER CONDITIONS
    // =====================================================

    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];

    // =====================================================
    // ORGANIZATION
    // =====================================================

    if (data.OrganizationID) {
      values.push(
        Number(
          data.OrganizationID,
        ),
      );

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }

    // =====================================================
    // EQUIPMENT
    // =====================================================

    if (
      data.EquipmentID &&
      String(
        data.EquipmentID,
      ).trim()
    ) {
      values.push(
        Number(
          data.EquipmentID,
        ),
      );

      conditions.push(
        `m.EquipmentID = $${values.length}`,
      );
    }

    // =====================================================
    // STATUS
    // =====================================================

    if (
      data.Status &&
      String(
        data.Status,
      ).trim()
    ) {
      values.push(
        String(
          data.Status,
        ).trim(),
      );

      conditions.push(
        `m.Status = $${values.length}`,
      );
    }

    // =====================================================
    // MAINTENANCE DATE
    // =====================================================

    if (data.MaintenanceDate) {
      values.push(
        data.MaintenanceDate,
      );

      conditions.push(
        `m.MaintenanceDate = $${values.length}`,
      );
    }

    // =====================================================
    // FROM DATE
    // =====================================================

    if (data.FromDate) {
      values.push(
        data.FromDate,
      );

      conditions.push(
        `m.MaintenanceDate >= $${values.length}`,
      );
    }

    // =====================================================
    // TO DATE
    // =====================================================

    if (data.ToDate) {
      values.push(
        data.ToDate,
      );

      conditions.push(
        `m.MaintenanceDate <= $${values.length}`,
      );
    }

    // =====================================================
    // SEARCH
    // =====================================================

    if (
      data.Search &&
      String(
        data.Search,
      ).trim()
    ) {
      values.push(
        `%${String(
          data.Search,
        ).trim()}%`,
      );

      const index =
        values.length;

      conditions.push(`
        (
          m.Maintenance
            ILIKE $${index}

          OR m.MaintenanceBy
            ILIKE $${index}

          OR em.Description
            ILIKE $${index}

          OR em.SerialNumber
            ILIKE $${index}

          OR em.Area
            ILIKE $${index}

          OR EXISTS
          (
            SELECT 1

            FROM user_master searchUser

            WHERE
              searchUser.UserID =
                m.ServicedBy

              AND searchUser.IsDeleted =
                FALSE

              AND searchUser.FullName
                ILIKE $${index}
          )
        )
      `);
    }

    const where =
      conditions.join(
        " AND ",
      );

    // =====================================================
    // COUNT DATABASE RECORDS
    // =====================================================

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::bigint
            AS TotalCount

        FROM Engineering_Maintenance_Details m

        LEFT JOIN Engineering_Equipment_Entry_Master em
          ON em.EquipmentID =
             m.EquipmentID

          AND em.IsDeleted =
             FALSE

        WHERE ${where};
        `,
        values,
      );

    const databaseTotalCount =
      Number(
        countResult.rows[0]
          .totalcount,
      );

    const virtualCount =
      virtualMaintenances.length;

    const totalCount =
      virtualCount +
      databaseTotalCount;

    const totalPages =
      Math.ceil(
        totalCount /
        pageSize,
      );

    // =====================================================
    // PAGINATION
    //
    // Virtual rows first
    // Database rows uske baad
    // =====================================================

    const pageStart =
      (page - 1) *
      pageSize;

    const pageEnd =
      pageStart +
      pageSize;

    const paginatedVirtualRows =
      virtualMaintenances.slice(
        pageStart,
        pageEnd,
      );

    const databaseLimit =
      Math.max(
        pageSize -
          paginatedVirtualRows.length,
        0,
      );

    const databaseOffset =
      Math.max(
        pageStart -
          virtualCount,
        0,
      );

    // =====================================================
    // FETCH DATABASE RECORDS
    // =====================================================

    let databaseRecords = [];

    if (databaseLimit > 0) {
      const listValues = [
        ...values,
        databaseLimit,
        databaseOffset,
      ];

      const limitIndex =
        values.length + 1;

      const offsetIndex =
        values.length + 2;

      const result =
        await pool.query(
          `
          SELECT
            m.*,

            u.FullName
              AS EngineerAssignedName,

            sb.FullName
              AS ServicedByName,

            em.Description
              AS EquipmentDescription,

            em.SerialNumber,

            em.Capacity,

            em.ModelNumber,

            em.Make,

            em.Area,

            em.ScheduleOfServicing,

            em.ScheduleDay

          FROM Engineering_Maintenance_Details m

          LEFT JOIN user_master u
            ON u.UserID =
               m.EngineerAssigned

            AND u.IsDeleted =
               FALSE

          LEFT JOIN user_master sb
            ON sb.UserID =
               m.ServicedBy

            AND sb.IsDeleted =
               FALSE

          LEFT JOIN Engineering_Equipment_Entry_Master em
            ON em.EquipmentID =
               m.EquipmentID

            AND em.IsDeleted =
               FALSE

          WHERE ${where}

          ORDER BY
            m.MaintenanceID DESC

          LIMIT $${limitIndex}

          OFFSET $${offsetIndex};
          `,
          listValues,
        );

      databaseRecords =
        result.rows.map(
          (row) => ({
            MaintenanceID:
              Number(
                row.maintenanceid,
              ),

            OrganizationID:
              Number(
                row.organizationid,
              ),

            EquipmentID:
              Number(
                row.equipmentid,
              ),

            Maintenance:
              row.maintenance ||
              null,

            MaintenanceDay:
              row.maintenanceday ||
              null,

            MaintenanceDate:
              formatDate(
                row.maintenancedate,
              ),

            MaintenanceBy:
              row.maintenanceby ||
              null,

            ServicedBy:
              row.servicedby
                ? Number(
                    row.servicedby,
                  )
                : null,

            ServicedByName:
              row.servicedbyname ||
              null,

            EngineerAssigned:
              row.engineerassigned
                ? Number(
                    row.engineerassigned,
                  )
                : null,

            EngineerAssignedName:
              row.engineerassignedname ||
              null,

            Status:
              row.status ||
              null,

            CreatedDate:
              formatDate(
                row.createddate,
              ),

            Description:
              row.equipmentdescription ||
              null,

            SerialNumber:
              row.serialnumber ||
              null,

            Capacity:
              row.capacity ||
              null,

            ModelNumber:
              row.modelnumber ||
              null,

            Make:
              row.make ||
              null,

            Area:
              row.area ||
              null,

            ScheduleOfServicing:
              row.scheduleofservicing ||
              null,

            ScheduleDay:
              row.scheduleday ||
              null,
          }),
        );
    }

    // =====================================================
    // FINAL PAGE DATA
    // =====================================================

    const records = [
      ...paginatedVirtualRows,
      ...databaseRecords,
    ];

    // =====================================================
    // RESPONSE
    // =====================================================

    return ok(
      "Engineering daily maintenance report fetched successfully.",
      {
        TotalCount:
          totalCount,

        PageCount:
          records.length,

        CurrentPage:
          page,

        PageSize:
          pageSize,

        TotalPages:
          totalPages,

        data:
          records,
      },
    );
  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Engineering daily maintenance report",
    );
  }
};
// =============================================================4. Monthly Maintenance Reports
const getMonthlyMaintenanceReports = async (data) => {
  try {
    const page = Math.max(
      Number(data.page) || 1,
      1,
    );

    const pageSize = Math.min(
      Math.max(
        Number(data.PageSize) || 10,
        1,
      ),
      100,
    );

    const organizationID =
      Number(data.OrganizationID);

    const equipmentID =
      data.EquipmentID &&
      String(data.EquipmentID).trim()
        ? Number(data.EquipmentID)
        : null;

    // =====================================================
    // MONTH / YEAR
    // Blank hone par current month/year
    // =====================================================

    const currentDate = new Date();

    const reportMonth =
      data.Month &&
      Number(data.Month) >= 1 &&
      Number(data.Month) <= 12
        ? Number(data.Month)
        : currentDate.getMonth() + 1;

    const reportYear =
      data.Year &&
      Number(data.Year) > 0
        ? Number(data.Year)
        : currentDate.getFullYear();

    // =====================================================
    // VIRTUAL SCHEDULED MAINTENANCE
    // =====================================================

    let virtualMaintenances = [];

    // =====================================================
    // FETCH EQUIPMENT
    // =====================================================

    const equipmentValues = [];

    const equipmentConditions = [
      "e.IsDeleted = FALSE",
    ];

    if (
      Number.isInteger(organizationID) &&
      organizationID > 0
    ) {
      equipmentValues.push(
        organizationID,
      );

      equipmentConditions.push(
        `e.OrganizationID = $${equipmentValues.length}`,
      );
    }

    if (
      Number.isInteger(equipmentID) &&
      equipmentID > 0
    ) {
      equipmentValues.push(
        equipmentID,
      );

      equipmentConditions.push(
        `e.EquipmentID = $${equipmentValues.length}`,
      );
    }

    const equipmentResult =
      await pool.query(
        `
        SELECT
          e.EquipmentID,
          e.OrganizationID,

          e.Description,
          e.SerialNumber,
          e.Capacity,
          e.ModelNumber,
          e.Make,
          e.Area,

          e.CommissioningDate,

          e.WarrantyStartDate,
          e.WarrantyEndDate,
          e.WarrantyStatus,

          e.AMCType,
          e.AMCStartDate,
          e.AMCEndDate,
          e.AMCStatus,
          e.AMCYearlyExpense,

          e.ScheduleOfServicing,
          e.ScheduleDay

        FROM Engineering_Equipment_Entry_Master e

        WHERE
          ${equipmentConditions.join(" AND ")}

        ORDER BY
          e.EquipmentID ASC;
        `,
        equipmentValues,
      );

    // =====================================================
    // EQUIPMENT IDS
    // =====================================================

    const equipmentIDs =
      equipmentResult.rows.map(
        (item) =>
          Number(
            item.equipmentid,
          ),
      );

    // =====================================================
    // FIND EXISTING MAINTENANCE
    // FOR SELECTED MONTH / YEAR
    // =====================================================

    const existingEquipmentIDs =
      new Set();

    if (equipmentIDs.length) {
      const existingResult =
        await pool.query(
          `
          SELECT DISTINCT
            EquipmentID

          FROM Engineering_Maintenance_Details

          WHERE
            EquipmentID =
              ANY($1::bigint[])

            AND IsDeleted = FALSE

            AND EXTRACT(
              MONTH FROM MaintenanceDate
            )::int = $2

            AND EXTRACT(
              YEAR FROM MaintenanceDate
            )::int = $3;
          `,
          [
            equipmentIDs,
            reportMonth,
            reportYear,
          ],
        );

      existingResult.rows.forEach(
        (item) => {
          existingEquipmentIDs.add(
            Number(
              item.equipmentid,
            ),
          );
        },
      );
    }

    // =====================================================
    // CREATE VIRTUAL MAINTENANCE
    // =====================================================

    for (
      const equipment of
      equipmentResult.rows
    ) {
      const currentEquipmentID =
        Number(
          equipment.equipmentid,
        );

      // Selected month ka maintenance already hai
      if (
        existingEquipmentIDs.has(
          currentEquipmentID,
        )
      ) {
        continue;
      }

      const schedule = String(
        equipment.scheduleofservicing ||
          "",
      )
        .trim()
        .toLowerCase()
        .replace(
          /[\s_-]+/g,
          "",
        );

      const dayMatch =
        String(
          equipment.scheduleday ||
            "",
        ).match(/\d+/);

      const scheduleDay =
        dayMatch
          ? Number(
              dayMatch[0],
            )
          : null;

      // ===================================================
      // CHECK SELECTED MONTH IS DUE
      // ===================================================

      let isDueMonth = false;

      switch (schedule) {
        case "monthly":
          isDueMonth = true;
          break;

        case "bimonth":
        case "bimonthly":
          isDueMonth = [
            1,
            3,
            5,
            7,
            9,
            11,
          ].includes(
            reportMonth,
          );
          break;

        case "quarterly":
        case "quarter":
          isDueMonth = [
            1,
            4,
            7,
            10,
          ].includes(
            reportMonth,
          );
          break;

        case "sixmonth":
        case "sixmonthly":
        case "6month":
        case "6monthly":
          isDueMonth = [
            1,
            7,
          ].includes(
            reportMonth,
          );
          break;

        case "yearly":
        case "annual":
        case "annually":
          isDueMonth =
            reportMonth === 1;
          break;

        default:
          isDueMonth = false;
          break;
      }

      if (!isDueMonth) {
        continue;
      }

      if (
        !Number.isInteger(
          scheduleDay,
        ) ||
        scheduleDay <= 0
      ) {
        continue;
      }

      // ===================================================
      // SCHEDULE DATE
      // ===================================================

      const maxDay =
        new Date(
          reportYear,
          reportMonth,
          0,
        ).getDate();

      const finalScheduleDay =
        Math.min(
          scheduleDay,
          maxDay,
        );

      const monthText =
        String(
          reportMonth,
        ).padStart(
          2,
          "0",
        );

      const dayText =
        String(
          finalScheduleDay,
        ).padStart(
          2,
          "0",
        );

      const scheduledDate =
        `${reportYear}-${monthText}-${dayText}`;

      // ===================================================
      // STATUS FILTER
      // Virtual maintenance = Pending
      // ===================================================

      if (
        data.Status &&
        String(
          data.Status,
        ).trim() &&
        String(
          data.Status,
        )
          .trim()
          .toLowerCase() !==
          "pending"
      ) {
        continue;
      }

      // ===================================================
      // CREATE VIRTUAL ROW
      // ===================================================

      virtualMaintenances.push({
        MaintenanceID: 0,

        OrganizationID:
          Number(
            equipment.organizationid,
          ),

        EquipmentID:
          currentEquipmentID,

        MaintenanceBy:
          null,

        Status:
          "Pending",

        MaintenanceDate:
          formatDate(
            scheduledDate,
          ),

        Description:
          equipment.description ||
          null,

        SerialNumber:
          equipment.serialnumber ||
          null,

        Capacity:
          equipment.capacity ||
          null,

        ModelNumber:
          equipment.modelnumber ||
          null,

        Make:
          equipment.make ||
          null,

        Area:
          equipment.area ||
          null,

        CommissioningDate:
          formatDate(
            equipment.commissioningdate,
          ),

        WarrantyStartDate:
          formatDate(
            equipment.warrantystartdate,
          ),

        WarrantyEndDate:
          formatDate(
            equipment.warrantyenddate,
          ),

        WarrantyStatus:
          equipment.warrantystatus ||
          null,

        AMCType:
          equipment.amctype ||
          null,

        AMCStartDate:
          formatDate(
            equipment.amcstartdate,
          ),

        AMCEndDate:
          formatDate(
            equipment.amcenddate,
          ),

        AMCStatus:
          equipment.amcstatus ||
          null,

        AMCYearlyExpense:
          equipment.amcyearlyexpense !==
            null
            ? Number(
                equipment.amcyearlyexpense,
              )
            : null,

        ScheduleOfServicing:
          equipment.scheduleofservicing ||
          null,

        ScheduleDay:
          equipment.scheduleday ||
          null,
      });
    }

    // =====================================================
    // DATABASE FILTER CONDITIONS
    // =====================================================

    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];

    // =====================================================
    // ORGANIZATION
    // =====================================================

    if (data.OrganizationID) {
      values.push(
        Number(
          data.OrganizationID,
        ),
      );

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }

    // =====================================================
    // EQUIPMENT
    // =====================================================

    if (
      data.EquipmentID &&
      String(
        data.EquipmentID,
      ).trim()
    ) {
      values.push(
        Number(
          data.EquipmentID,
        ),
      );

      conditions.push(
        `m.EquipmentID = $${values.length}`,
      );
    }

    // =====================================================
    // MONTH
    // =====================================================

    values.push(
      reportMonth,
    );

    conditions.push(
      `EXTRACT(MONTH FROM m.MaintenanceDate)::int = $${values.length}`,
    );

    // =====================================================
    // YEAR
    // =====================================================

    values.push(
      reportYear,
    );

    conditions.push(
      `EXTRACT(YEAR FROM m.MaintenanceDate)::int = $${values.length}`,
    );

    // =====================================================
    // STATUS
    // =====================================================

    if (
      data.Status &&
      String(
        data.Status,
      ).trim()
    ) {
      values.push(
        String(
          data.Status,
        ).trim(),
      );

      conditions.push(
        `TRIM(m.Status) = $${values.length}`,
      );
    }

    // =====================================================
    // FROM DATE
    // =====================================================

    if (data.FromDate) {
      values.push(
        data.FromDate,
      );

      conditions.push(
        `m.MaintenanceDate >= $${values.length}`,
      );
    }

    // =====================================================
    // TO DATE
    // =====================================================

    if (data.ToDate) {
      values.push(
        data.ToDate,
      );

      conditions.push(
        `m.MaintenanceDate <= $${values.length}`,
      );
    }

    // =====================================================
    // SEARCH
    // =====================================================

    if (
      data.Search &&
      String(
        data.Search,
      ).trim()
    ) {
      values.push(
        `%${String(
          data.Search,
        ).trim()}%`,
      );

      const index =
        values.length;

      conditions.push(`
        (
          m.Maintenance
            ILIKE $${index}

          OR m.MaintenanceBy
            ILIKE $${index}

          OR em.Description
            ILIKE $${index}

          OR em.SerialNumber
            ILIKE $${index}

          OR em.Area
            ILIKE $${index}

          OR EXISTS
          (
            SELECT 1

            FROM user_master searchUser

            WHERE
              searchUser.UserID =
                m.ServicedBy

              AND searchUser.IsDeleted =
                FALSE

              AND searchUser.FullName
                ILIKE $${index}
          )
        )
      `);
    }

    const where =
      conditions.join(
        " AND ",
      );

    // =====================================================
    // COUNT
    // =====================================================

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::bigint
            AS TotalCount

        FROM Engineering_Maintenance_Details m

        LEFT JOIN Engineering_Equipment_Entry_Master em
          ON em.EquipmentID =
             m.EquipmentID

          AND em.IsDeleted =
             FALSE

        WHERE
          ${where};
        `,
        values,
      );

    const databaseTotalCount =
      Number(
        countResult.rows[0]
          .totalcount,
      );

    const virtualCount =
      virtualMaintenances.length;

    const totalCount =
      virtualCount +
      databaseTotalCount;

    const totalPages =
      Math.ceil(
        totalCount /
          pageSize,
      );

    // =====================================================
    // PAGINATION
    // =====================================================

    const pageStart =
      (page - 1) *
      pageSize;

    const pageEnd =
      pageStart +
      pageSize;

    const paginatedVirtualRows =
      virtualMaintenances.slice(
        pageStart,
        pageEnd,
      );

    const databaseLimit =
      Math.max(
        pageSize -
          paginatedVirtualRows.length,
        0,
      );

    const databaseOffset =
      Math.max(
        pageStart -
          virtualCount,
        0,
      );

    // =====================================================
    // DATABASE RECORDS
    // =====================================================

    let databaseRecords = [];

    if (databaseLimit > 0) {
      const listValues = [
        ...values,
        databaseLimit,
        databaseOffset,
      ];

      const limitIndex =
        values.length + 1;

      const offsetIndex =
        values.length + 2;

      const result =
        await pool.query(
          `
          SELECT
            m.*,

            u.FullName
              AS EngineerAssignedName,

            sb.FullName
              AS ServicedByName,

            em.Description
              AS EquipmentDescription,

            em.SerialNumber,

            em.Capacity,

            em.ModelNumber,

            em.Make,

            em.Area,

            em.CommissioningDate,

            em.WarrantyStartDate,

            em.WarrantyEndDate,

            em.WarrantyStatus,

            em.AMCType,

            em.AMCStartDate,

            em.AMCEndDate,

            em.AMCStatus,

            em.AMCYearlyExpense,

            em.ScheduleOfServicing,

            em.ScheduleDay

          FROM Engineering_Maintenance_Details m

          LEFT JOIN user_master u
            ON u.UserID =
               m.EngineerAssigned

            AND u.IsDeleted =
               FALSE

          LEFT JOIN user_master sb
            ON sb.UserID =
               m.ServicedBy

            AND sb.IsDeleted =
               FALSE

          LEFT JOIN Engineering_Equipment_Entry_Master em
            ON em.EquipmentID =
               m.EquipmentID

            AND em.IsDeleted =
               FALSE

          WHERE
            ${where}

          ORDER BY
            m.MaintenanceDate DESC,
            m.MaintenanceID DESC

          LIMIT
            $${limitIndex}

          OFFSET
            $${offsetIndex};
          `,
          listValues,
        );

      databaseRecords =
        result.rows.map(
          (row) => ({
            MaintenanceID:
              Number(
                row.maintenanceid,
              ),

            OrganizationID:
              Number(
                row.organizationid,
              ),

            EquipmentID:
              Number(
                row.equipmentid,
              ),

            Maintenance:
              row.maintenance ||
              null,

            MaintenanceDay:
              row.maintenanceday ||
              null,

            MaintenanceDate:
              formatDate(
                row.maintenancedate,
              ),

            MaintenanceBy:
              row.maintenanceby ||
              null,

            ServicedBy:
              row.servicedby
                ? Number(
                    row.servicedby,
                  )
                : null,

            ServicedByName:
              row.servicedbyname ||
              null,

            EngineerAssigned:
              row.engineerassigned
                ? Number(
                    row.engineerassigned,
                  )
                : null,

            EngineerAssignedName:
              row.engineerassignedname ||
              null,

            Status:
              row.status
                ? String(
                    row.status,
                  ).trim()
                : null,

            CreatedDate:
              formatDate(
                row.createddate,
              ),

            Description:
              row.equipmentdescription ||
              null,

            SerialNumber:
              row.serialnumber ||
              null,

            Capacity:
              row.capacity ||
              null,

            ModelNumber:
              row.modelnumber ||
              null,

            Make:
              row.make ||
              null,

            Area:
              row.area ||
              null,

            CommissioningDate:
              formatDate(
                row.commissioningdate,
              ),

            WarrantyStartDate:
              formatDate(
                row.warrantystartdate,
              ),

            WarrantyEndDate:
              formatDate(
                row.warrantyenddate,
              ),

            WarrantyStatus:
              row.warrantystatus ||
              null,

            AMCType:
              row.amctype ||
              null,

            AMCStartDate:
              formatDate(
                row.amcstartdate,
              ),

            AMCEndDate:
              formatDate(
                row.amcenddate,
              ),

            AMCStatus:
              row.amcstatus ||
              null,

            AMCYearlyExpense:
              row.amcyearlyexpense !==
                null
                ? Number(
                    row.amcyearlyexpense,
                  )
                : null,

            ScheduleOfServicing:
              row.scheduleofservicing ||
              null,

            ScheduleDay:
              row.scheduleday ||
              null,
          }),
        );
    }

    // =====================================================
    // FINAL DATA
    // =====================================================

    const records = [
      ...paginatedVirtualRows,
      ...databaseRecords,
    ];

    // =====================================================
    // RESPONSE
    // =====================================================

    return ok(
      "Engineering monthly maintenance report fetched successfully.",
      {
        TotalCount:
          totalCount,

        PageCount:
          records.length,

        CurrentPage:
          page,

        PageSize:
          pageSize,

        TotalPages:
          totalPages,

        data:
          records,
      },
    );
  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Engineering monthly maintenance report",
    );
  }
};
// =============================================================5. Scheduled Missing Reports
const getScheduledMissingReports = async (data) => {
  try {
    const page = Math.max(Number(data.page) || 1, 1);

    const pageSize = Math.min(
      Math.max(Number(data.PageSize) || 10, 1),
      100,
    );

    const values = [];

    const conditions = [
      "e.IsDeleted = FALSE",
    ];

    // =====================================================
    // ORGANIZATION FILTER
    // =====================================================

    if (data.OrganizationID) {
      values.push(
        Number(data.OrganizationID),
      );

      conditions.push(
        `e.OrganizationID = $${values.length}`,
      );
    }

    // =====================================================
    // ONLY INCOMPLETE EQUIPMENT
    // Agar inme se koi bhi field blank/null hai
    // to record response me aayega
    // =====================================================

    conditions.push(`
      (
        e.WarrantyStartDate IS NULL

        OR e.WarrantyEndDate IS NULL

        OR e.WarrantyStatus IS NULL
        OR TRIM(e.WarrantyStatus) = ''

        OR e.AMCType IS NULL
        OR TRIM(e.AMCType) = ''

        OR e.AMCStartDate IS NULL

        OR e.AMCEndDate IS NULL

        OR e.AMCStatus IS NULL
        OR TRIM(e.AMCStatus) = ''

        OR e.AMCYearlyExpense IS NULL

        OR e.ScheduleOfServicing IS NULL
        OR TRIM(e.ScheduleOfServicing) = ''

        OR e.ScheduleDay IS NULL
        OR TRIM(e.ScheduleDay) = ''
      )
    `);

    const where = conditions.join(
      " AND ",
    );

    // =====================================================
    // COUNT
    // =====================================================

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::bigint
            AS TotalCount

        FROM Engineering_Equipment_Entry_Master e

        WHERE
          ${where};
        `,
        values,
      );

    const totalCount =
      Number(
        countResult.rows[0]
          .totalcount,
      );

    const totalPages =
      Math.ceil(
        totalCount /
        pageSize,
      );

    // =====================================================
    // PAGINATION
    // =====================================================

    const offset =
      (page - 1) *
      pageSize;

    const listValues = [
      ...values,
      pageSize,
      offset,
    ];

    const limitIndex =
      values.length + 1;

    const offsetIndex =
      values.length + 2;

    // =====================================================
    // LIST
    // =====================================================

    const result =
      await pool.query(
        `
        SELECT
          e.EquipmentID,
          e.OrganizationID,

          e.Description,
          e.SerialNumber,
          e.TypeOfMachine,
          e.Capacity,
          e.ModelNumber,
          e.Make,
          e.Area,

          e.CommissioningDate,

          e.WarrantyStartDate,
          e.WarrantyEndDate,
          e.WarrantyStatus,

          e.AMCType,
          e.AMCStartDate,
          e.AMCEndDate,
          e.AMCStatus,
          e.AMCYearlyExpense,

          e.ScheduleOfServicing,
          e.ScheduleDay,

          e.ResponsiblePerson,
          e.Remarks,

          e.CreatedDate

        FROM Engineering_Equipment_Entry_Master e

        WHERE
          ${where}

        ORDER BY
          e.EquipmentID DESC

        LIMIT
          $${limitIndex}

        OFFSET
          $${offsetIndex};
        `,
        listValues,
      );

    // =====================================================
    // MAPPING
    // =====================================================

    const records =
      result.rows.map(
        (row) => ({
          EquipmentID:
            Number(
              row.equipmentid,
            ),

          OrganizationID:
            Number(
              row.organizationid,
            ),

          Description:
            row.description ||
            null,

          SerialNumber:
            row.serialnumber ||
            null,

          TypeOfMachine:
            row.typeofmachine ||
            null,

          Capacity:
            row.capacity ||
            null,

          ModelNumber:
            row.modelnumber ||
            null,

          Make:
            row.make ||
            null,

          Area:
            row.area ||
            null,

          CommissioningDate:
            formatDate(
              row.commissioningdate,
            ),

          WarrantyStartDate:
            formatDate(
              row.warrantystartdate,
            ),

          WarrantyEndDate:
            formatDate(
              row.warrantyenddate,
            ),

          WarrantyStatus:
            row.warrantystatus ||
            null,

          AMCType:
            row.amctype ||
            null,

          AMCStartDate:
            formatDate(
              row.amcstartdate,
            ),

          AMCEndDate:
            formatDate(
              row.amcenddate,
            ),

          AMCStatus:
            row.amcstatus ||
            null,

          AMCYearlyExpense:
            row.amcyearlyexpense !==
              null
              ? Number(
                  row.amcyearlyexpense,
                )
              : null,

          ScheduleOfServicing:
            row.scheduleofservicing ||
            null,

          ScheduleDay:
            row.scheduleday ||
            null,

          ResponsiblePerson:
            row.responsibleperson
              ? Number(
                  row.responsibleperson,
                )
              : null,

          Remarks:
            row.remarks ||
            null,

          CreatedDate:
            formatDate(
              row.createddate,
            ),
        }),
      );

    // =====================================================
    // RESPONSE
    // =====================================================

    return ok(
      "Incomplete engineering equipment fetched successfully.",
      {
        TotalCount:
          totalCount,

        PageCount:
          records.length,

        CurrentPage:
          page,

        PageSize:
          pageSize,

        TotalPages:
          totalPages,

        data:
          records,
      },
    );
  } catch (error) {
    return databaseFailure(
      error,
      "Fetch incomplete engineering equipment",
    );
  }
};

// NOTE => Total reports 12 he Jisme se - warrty status ki 3 , Amc Status ki 3,servred by hotel team ki 1 yani total 7 reports 
          // ke liye 1.Total Number of Machine Reports vali api use hogo  
          // To 1.Total Number of Machine Reports iske smet baki status api mila ke isse 8 bn gyi 
          // Baki ki 4 retport ki alg bna di gayi he 1. Breakdowns Report, 2. Daily Maintenance Report, 3. Monthly Maintenance Report, 4. Scheduled Missing Report
          // to Total 8 + 4 = 12 reports he

// ============================================================================================Pdfs
// =============================================================1.Total Number of Machine Reports Pdf
const generateTotalEquipmentReportsPdf = async (data) => {
  try {
    const organizationID = Number(data.OrganizationID);

    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !Number.isInteger(organizationID) ||
      organizationID <= 0
    ) {
      return {
        success: false,
        message: "Valid OrganizationID is required.",
        statusCode: 400,
      };
    }

    const values = [organizationID];

    const conditions = [
      "e.OrganizationID = $1",
      "e.IsDeleted = FALSE",
    ];

    // ============================================================
    // DEPARTMENT FILTER
    // Same as GET API
    // ============================================================

    if (data.DepartmentID) {
      values.push(Number(data.DepartmentID));

      conditions.push(
        `e.DepartmentID = $${values.length}`,
      );
    }

    // ============================================================
    // OTHER FILTERS
    // Same as GET API
    // ============================================================

    for (const [parameter, column, operator] of [
      ["WarrantyStatus", "WarrantyStatus", "="],
      ["AMCStatus", "AMCStatus", "="],
      ["AMCType", "AMCType", "="],
      ["AMCStartDate", "AMCStartDate", "="],
      ["WarrantyStartDate", "WarrantyStartDate", "="],
      ["AMCEndDate", "AMCEndDate", "="],
      ["WarrantyEndDate", "WarrantyEndDate", "="],
      ["SerialNo", "SerialNumber", "ILIKE"],
      ["Area", "Area", "ILIKE"],
      ["EquipmentID", "EquipmentID", "="],
    ]) {
      const value = String(
        data[parameter] ?? "",
      ).trim();

      if (!value) continue;

      values.push(
        operator === "ILIKE"
          ? `%${value}%`
          : value,
      );

      conditions.push(
        `e.${column} ${operator} $${values.length}`,
      );
    }

    // ============================================================
    // SEARCH
    // Same as GET API
    // ============================================================

    if (data.Search) {
      values.push(
        `%${String(data.Search).trim()}%`,
      );

      conditions.push(
        `
        (
          e.Description ILIKE $${values.length}
          OR e.SerialNumber ILIKE $${values.length}
          OR e.ModelNumber ILIKE $${values.length}
          OR e.Make ILIKE $${values.length}
          OR e.Area ILIKE $${values.length}
        )
        `,
      );
    }

    const where = conditions.join(" AND ");

    // ============================================================
    // EQUIPMENT LIST
    // Same SELECT / JOIN / WHERE as GET API
    // Only LIMIT / OFFSET removed for PDF
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        e.*,

        om.ShortName AS OrganizationShortName,

        d.DepartmentName AS DepartmentName,

        u.FullName AS ResponsiblePersonName

      FROM Engineering_Equipment_Entry_Master e

      LEFT JOIN Organization_Master om
        ON om.OrganizationID = e.OrganizationID
       AND om.IsDeleted = FALSE

      LEFT JOIN department_master d
        ON d.DepartmentID = e.DepartmentID
       AND d.OrganizationID = e.OrganizationID
       AND d.IsDeleted = FALSE

      LEFT JOIN user_master u
        ON u.UserID = e.ResponsiblePerson
       AND u.IsDeleted = FALSE

      WHERE ${where}

      ORDER BY e.EquipmentID DESC;
      `,
      values,
    );

    // ============================================================
    // SAME MAPPER AS GET API
    // ============================================================

    const records = result.rows.map(mapEquipment);

    // ============================================================
    // ORGANIZATION DETAILS
    // ============================================================

    const organizationResult = await pool.query(
      `
      SELECT
        OrganizationID,
        OrganizationName
      FROM Organization_Master
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
      LIMIT 1;
      `,
      [organizationID],
    );

    const organization =
      organizationResult.rows[0] || null;

    // ============================================================
    // PDF ROWS
    // Sr.No. only PDF display ke liye
    // ============================================================

    const pdfRows = records.map((row, index) => ({
      ...row,
      SrNo: index + 1,
    }));

    // ============================================================
    // PDF COLUMNS
    // Image ke according
    // ============================================================

    const columns = [
      {
        header: "Sr.No.",
        value: (row) => row.SrNo,
        width: 28,
        align: "center",
      },

      {
        header: "Description",
        value: (row) => {
          const lines = [];

          if (row.Description) {
            lines.push(row.Description);
          }

          if (row.SerialNumber) {
            lines.push(
              `Sr.No.: ${row.SerialNumber}`,
            );
          }

          if (row.Capacity) {
            lines.push(
              `Capacity: ${row.Capacity}`,
            );
          }

          return lines.join("\n") || "-";
        },
        width: 125,
      },

      {
        header: "Make & Model",
        value: (row) => {
          const lines = [];

          if (row.Make) {
            lines.push(
              `Make: ${row.Make}`,
            );
          }

          if (row.ModelNumber) {
            lines.push(
              `Model: ${row.ModelNumber}`,
            );
          }

          return lines.join("\n") || "-";
        },
        width: 75,
      },

      {
        header: "Area",
        value: (row) => row.Area,
        width: 60,
      },

      {
        header: "Comm. Date",
        value: (row) =>
          row.CommissioningDate,
        width: 48,
        align: "center",
      },

      {
        header: "Warranty Period",
        value: (row) => {
          if (
            !row.WarrantyStartDate &&
            !row.WarrantyEndDate
          ) {
            return "-";
          }

          return [
            row.WarrantyStartDate || "-",
            "To",
            row.WarrantyEndDate || "-",
          ].join("\n");
        },
        width: 58,
        align: "center",
      },

      {
        header: "Warranty Status",
        value: (row) =>
          row.WarrantyStatus,
        width: 55,
        align: "center",
      },

      {
        header: "Type Of AMC",
        value: (row) =>
          row.AMCType,
        width: 58,
      },

      {
        header: "AMC Period",
        value: (row) => {
          if (
            !row.AMCStartDate &&
            !row.AMCEndDate
          ) {
            return "-";
          }

          return [
            row.AMCStartDate || "-",
            "To",
            row.AMCEndDate || "-",
          ].join("\n");
        },
        width: 58,
        align: "center",
      },

      {
        header: "AMC Status",
        value: (row) =>
          row.AMCStatus,
        width: 50,
        align: "center",
      },

      {
        header: "Schedule of Servicing/Day",
        value: (row) => {
          const lines = [];

          if (row.ScheduleOfServicing) {
            lines.push(
              row.ScheduleOfServicing,
            );
          }

          if (row.ScheduleDay) {
            lines.push(
              `Day: ${row.ScheduleDay}`,
            );
          }

          return lines.join("\n") || "-";
        },
        width: 68,
      },
    ];

    // ============================================================
    // METADATA
    // ============================================================

    const metadata = [
      {
        label: "Organization",
        value:
          organization?.organizationname ||
          "-",
      },
      {
        label: "Total Machines",
        value: records.length,
      },
    ];

    // Department filter
    if (
      data.DepartmentID &&
      records.length > 0
    ) {
      metadata.push({
        label: "Department",
        value:
          records[0]?.DepartmentName ||
          "-",
      });
    }

    if (
      data.WarrantyStatus &&
      String(data.WarrantyStatus).trim()
    ) {
      metadata.push({
        label: "Warranty Status",
        value: data.WarrantyStatus,
      });
    }

    if (
      data.AMCStatus &&
      String(data.AMCStatus).trim()
    ) {
      metadata.push({
        label: "AMC Status",
        value: data.AMCStatus,
      });
    }

    if (
      data.AMCType &&
      String(data.AMCType).trim()
    ) {
      metadata.push({
        label: "AMC Type",
        value: data.AMCType,
      });
    }

    if (
      data.Area &&
      String(data.Area).trim()
    ) {
      metadata.push({
        label: "Area",
        value: data.Area,
      });
    }

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer = await generatePdf({
      title:
        "TOTAL NUMBER OF MACHINE REPORT",

      reportName:
        "Total Number of Machine Report",

      organizationId:
        organizationID,

      logoUrl:
        data.logoUrl,

      orientation:
        "landscape",

      metadata,

      columns,

      rows:
        pdfRows,

      pageMargins:
        [15, 20, 15, 35],
    });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Total number of machine PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Total_Number_Of_Machine_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Total Number of Machine PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate Total Number of Machine PDF.",

      statusCode: 503,
    };
  }
};
// =============================================================2.Breakdown Reports Pdf
const generateBreakdownReportPdf = async (data) => {
  try {
    const organizationID = Number(
      data.OrganizationID,
    );

    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !Number.isInteger(organizationID) ||
      organizationID <= 0
    ) {
      return {
        success: false,
        message:
          "Valid OrganizationID is required.",
        statusCode: 400,
      };
    }

    const values = [
      organizationID,
    ];

    const conditions = [
      "b.OrganizationID = $1",
      "b.IsDeleted = FALSE",
    ];

    // ============================================================
    // EQUIPMENT ID FILTER
    // Same as GET API
    // ============================================================

    if (data.EquipmentID) {
      values.push(
        Number(
          data.EquipmentID,
        ),
      );

      conditions.push(
        `b.EquipmentID = $${values.length}`,
      );
    }

    // ============================================================
    // REPAIRED STATUS FILTER
    // Pending / Repaired / Empty = All
    // Same as GET API
    // ============================================================

    if (
      data.RepairedStatus &&
      String(
        data.RepairedStatus,
      ).trim()
    ) {
      values.push(
        String(
          data.RepairedStatus,
        ).trim(),
      );

      conditions.push(
        `b.RepairedStatus = $${values.length}`,
      );
    }

    // ============================================================
    // BREAKDOWN DATE EXACT FILTER
    // Same as GET API
    // ============================================================

    if (data.BreakdownDate) {
      values.push(
        data.BreakdownDate,
      );

      conditions.push(
        `b.BreakdownDate = $${values.length}`,
      );
    }

    // ============================================================
    // FROM DATE
    // Same as GET API
    // ============================================================

    if (data.FromDate) {
      values.push(
        data.FromDate,
      );

      conditions.push(
        `b.BreakdownDate >= $${values.length}`,
      );
    }

    // ============================================================
    // TO DATE
    // Same as GET API
    // ============================================================

    if (data.ToDate) {
      values.push(
        data.ToDate,
      );

      conditions.push(
        `b.BreakdownDate <= $${values.length}`,
      );
    }

    // ============================================================
    // SEARCH
    // Same as GET API
    // ============================================================

    if (
      data.Search &&
      String(
        data.Search,
      ).trim()
    ) {
      values.push(
        `%${String(
          data.Search,
        ).trim()}%`,
      );

      conditions.push(
        `
        (
          b.BreakdownReason ILIKE $${values.length}

          OR b.PartsUsed ILIKE $${values.length}

          OR em.Description ILIKE $${values.length}

          OR em.Area ILIKE $${values.length}

          OR EXISTS
          (
            SELECT 1
            FROM Engineering_Breakdown_Parts_Details bp
            WHERE bp.BreakdownID = b.BreakdownID
              AND bp.IsDeleted = FALSE
              AND bp.Item ILIKE $${values.length}
          )
        )
        `,
      );
    }

    const where =
      conditions.join(
        " AND ",
      );

    // ============================================================
    // BREAKDOWN LIST
    // Same query as GET API
    // Only LIMIT / OFFSET removed
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          b.*,

          om.ShortName AS OrganizationShortName,

          u.FullName AS RepairedByName,

          em.Description AS EquipmentDescription,

          em.Area AS EquipmentArea

        FROM Engineering_Breakdown_Entry b

        LEFT JOIN Organization_Master om
          ON om.OrganizationID = b.OrganizationID
         AND om.IsDeleted = FALSE

        LEFT JOIN user_master u
          ON u.UserID = b.RepairedByID
         AND u.IsDeleted = FALSE

        LEFT JOIN Engineering_Equipment_Entry_Master em
          ON em.EquipmentID = b.EquipmentID
         AND em.IsDeleted = FALSE

        WHERE ${where}

        ORDER BY b.BreakdownID DESC;
        `,
        values,
      );

    // ============================================================
    // SAME MAPPING AS GET API
    // ============================================================

    const records =
      result.rows.map(
        (row) => ({
          ...mapBreakdown(row),

          EquipmentDescription:
            row.equipmentdescription ||
            null,

          EquipmentArea:
            row.equipmentarea ||
            null,
        }),
      );

    // ============================================================
    // ORGANIZATION
    // ============================================================

    const organizationResult =
      await pool.query(
        `
        SELECT
          OrganizationID,
          OrganizationName

        FROM Organization_Master

        WHERE OrganizationID = $1
          AND IsDeleted = FALSE

        LIMIT 1;
        `,
        [
          organizationID,
        ],
      );

    const organization =
      organizationResult.rows[0] ||
      null;

    // ============================================================
    // PDF COLUMNS
    // Image ke according
    // ============================================================

    const columns = [
      {
        header:
          "Description",

        value: (row) =>
          row.EquipmentDescription,

        width:
          115,
      },

      {
        header:
          "Area",

        value: (row) =>
          row.EquipmentArea,

        width:
          70,
      },

      {
        header:
          "Breakdown Date",

        value: (row) =>
          row.BreakdownDate,

        width:
          70,

        align:
          "center",
      },

      {
        header:
          "Breakdown Time",

        value: (row) =>
          row.BreakdownTime,

        width:
          65,

        align:
          "center",
      },

      {
        header:
          "Breakdown Amount",

        value: (row) =>
          row.Amount,

        width:
          75,

        align:
          "center",
      },

      {
        header:
          "Breakdown Reason",

        value: (row) =>
          row.BreakdownReason,

        width:
          125,
      },

      {
        header:
          "Parts Used",

        value: (row) =>
          row.PartsUsed,

        width:
          105,
      },

      {
        header:
          "Repaired Status",

        value: (row) =>
          row.RepairedStatus,

        width:
          65,

        align:
          "center",
      },
    ];

    // ============================================================
    // METADATA
    // ============================================================

    const metadata = [
      {
        label:
          "Organization",

        value:
          organization
            ?.organizationname ||
          "-",
      },

      {
        label:
          "Total Records",

        value:
          records.length,
      },
    ];

    if (
      data.BreakdownDate
    ) {
      metadata.push({
        label:
          "Breakdown Date",

        value:
          formatDate(
            data.BreakdownDate,
          ),
      });
    }

    if (
      data.FromDate
    ) {
      metadata.push({
        label:
          "From Date",

        value:
          formatDate(
            data.FromDate,
          ),
      });
    }

    if (
      data.ToDate
    ) {
      metadata.push({
        label:
          "To Date",

        value:
          formatDate(
            data.ToDate,
          ),
      });
    }

    if (
      data.RepairedStatus &&
      String(
        data.RepairedStatus,
      ).trim()
    ) {
      metadata.push({
        label:
          "Status",

        value:
          data.RepairedStatus,
      });
    }

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "BREAKDOWN REPORT",

        reportName:
          "Breakdown Report",

        organizationId:
          organizationID,

        logoUrl:
          data.logoUrl,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          records,

        pageMargins:
          [
            15,
            20,
            15,
            35,
          ],
      });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Engineering breakdown report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Engineering_Breakdown_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Engineering Breakdown Report PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate Engineering breakdown report PDF.",

      statusCode:
        503,
    };
  }
};
// =============================================================3. Daily Maintenance Reports Pdf
const generateDailyMaintenanceReportPdf = async (data) => {
  try {
    const organizationID = Number(
      data.OrganizationID,
    );

    const equipmentID =
      data.EquipmentID &&
      String(data.EquipmentID).trim()
        ? Number(data.EquipmentID)
        : null;

    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !Number.isInteger(organizationID) ||
      organizationID <= 0
    ) {
      return {
        success: false,
        message:
          "Valid OrganizationID is required.",
        statusCode: 400,
      };
    }

    // ============================================================
    // VIRTUAL SCHEDULED MAINTENANCE
    // SAME AS GET API
    // ============================================================

    let virtualMaintenances = [];

    // ============================================================
    // FETCH EQUIPMENT
    // Same condition as GET API
    // ============================================================

    const equipmentValues = [];

    const equipmentConditions = [
      "e.IsDeleted = FALSE",
    ];

    if (
      Number.isInteger(organizationID) &&
      organizationID > 0
    ) {
      equipmentValues.push(
        organizationID,
      );

      equipmentConditions.push(
        `e.OrganizationID = $${equipmentValues.length}`,
      );
    }

    if (
      Number.isInteger(equipmentID) &&
      equipmentID > 0
    ) {
      equipmentValues.push(
        equipmentID,
      );

      equipmentConditions.push(
        `e.EquipmentID = $${equipmentValues.length}`,
      );
    }

    const equipmentResult =
      await pool.query(
        `
        SELECT
          e.EquipmentID,
          e.OrganizationID,
          e.Description,
          e.SerialNumber,
          e.Capacity,
          e.ModelNumber,
          e.Make,
          e.Area,
          e.ScheduleOfServicing,
          e.ScheduleDay,

          EXTRACT(
            MONTH FROM CURRENT_DATE
          )::int AS CurrentMonth,

          EXTRACT(
            YEAR FROM CURRENT_DATE
          )::int AS CurrentYear

        FROM Engineering_Equipment_Entry_Master e

        WHERE
          ${equipmentConditions.join(" AND ")}

        ORDER BY
          e.EquipmentID ASC;
        `,
        equipmentValues,
      );

    // ============================================================
    // FIND EXISTING CURRENT MONTH MAINTENANCE
    // Same as GET API
    // ============================================================

    const equipmentIDs =
      equipmentResult.rows.map(
        (item) =>
          Number(
            item.equipmentid,
          ),
      );

    const existingEquipmentIDs =
      new Set();

    if (equipmentIDs.length) {
      const existingResult =
        await pool.query(
          `
          SELECT DISTINCT
            EquipmentID

          FROM Engineering_Maintenance_Details

          WHERE
            EquipmentID =
              ANY($1::bigint[])

            AND IsDeleted = FALSE

            AND MaintenanceDate >=
              DATE_TRUNC(
                'month',
                CURRENT_DATE
              )::date

            AND MaintenanceDate <
              (
                DATE_TRUNC(
                  'month',
                  CURRENT_DATE
                )
                + INTERVAL '1 month'
              )::date;
          `,
          [
            equipmentIDs,
          ],
        );

      existingResult.rows.forEach(
        (item) => {
          existingEquipmentIDs.add(
            Number(
              item.equipmentid,
            ),
          );
        },
      );
    }

    // ============================================================
    // CREATE VIRTUAL MAINTENANCE
    // Same logic as GET API
    // ============================================================

    for (
      const equipment of
      equipmentResult.rows
    ) {
      const currentEquipmentID =
        Number(
          equipment.equipmentid,
        );

      // Current month maintenance already exists
      if (
        existingEquipmentIDs.has(
          currentEquipmentID,
        )
      ) {
        continue;
      }

      const schedule =
        String(
          equipment.scheduleofservicing ||
            "",
        )
          .trim()
          .toLowerCase()
          .replace(
            /[\s_-]+/g,
            "",
          );

      const dayMatch =
        String(
          equipment.scheduleday ||
            "",
        ).match(/\d+/);

      const scheduleDay =
        dayMatch
          ? Number(
              dayMatch[0],
            )
          : null;

      const currentMonth =
        Number(
          equipment.currentmonth,
        );

      const currentYear =
        Number(
          equipment.currentyear,
        );

      // ==========================================================
      // CHECK CURRENT MONTH IS DUE
      // SAME CONDITION
      // ==========================================================

      let isDueMonth = false;

      switch (schedule) {
        case "monthly":
          isDueMonth = true;
          break;

        case "bimonth":
        case "bimonthly":
          isDueMonth = [
            1,
            3,
            5,
            7,
            9,
            11,
          ].includes(
            currentMonth,
          );
          break;

        case "quarterly":
        case "quarter":
          isDueMonth = [
            1,
            4,
            7,
            10,
          ].includes(
            currentMonth,
          );
          break;

        case "sixmonth":
        case "sixmonthly":
        case "6month":
        case "6monthly":
          isDueMonth = [
            1,
            7,
          ].includes(
            currentMonth,
          );
          break;

        case "yearly":
        case "annual":
        case "annually":
          isDueMonth =
            currentMonth === 1;
          break;

        default:
          isDueMonth = false;
          break;
      }

      if (!isDueMonth) {
        continue;
      }

      if (
        !Number.isInteger(
          scheduleDay,
        ) ||
        scheduleDay <= 0
      ) {
        continue;
      }

      // ==========================================================
      // SCHEDULE DATE
      // ==========================================================

      const maxDay =
        new Date(
          currentYear,
          currentMonth,
          0,
        ).getDate();

      const finalScheduleDay =
        Math.min(
          scheduleDay,
          maxDay,
        );

      const monthText =
        String(
          currentMonth,
        ).padStart(
          2,
          "0",
        );

      const dayText =
        String(
          finalScheduleDay,
        ).padStart(
          2,
          "0",
        );

      const scheduledDate =
        `${currentYear}-${monthText}-${dayText}`;

      // ==========================================================
      // MAINTENANCE DATE FILTER
      // SAME AS GET API
      // ==========================================================

      if (
        data.MaintenanceDate &&
        String(
          data.MaintenanceDate,
        ) !== scheduledDate
      ) {
        continue;
      }

      // ==========================================================
      // STATUS FILTER
      // SAME AS GET API
      // ==========================================================

      if (
        data.Status &&
        String(
          data.Status,
        ).trim() &&
        String(
          data.Status,
        )
          .trim()
          .toLowerCase() !==
          "pending"
      ) {
        continue;
      }

      // ==========================================================
      // CREATE VIRTUAL ROW
      // ==========================================================

      virtualMaintenances.push({
        MaintenanceID: 0,

        OrganizationID:
          Number(
            equipment.organizationid,
          ),

        EquipmentID:
          currentEquipmentID,

        MaintenanceBy:
          null,

        Status:
          "Pending",

        MaintenanceDate:
          formatDate(
            scheduledDate,
          ),

        Description:
          equipment.description ||
          null,

        SerialNumber:
          equipment.serialnumber ||
          null,

        Capacity:
          equipment.capacity ||
          null,

        ModelNumber:
          equipment.modelnumber ||
          null,

        Make:
          equipment.make ||
          null,

        Area:
          equipment.area ||
          null,

        ScheduleOfServicing:
          equipment.scheduleofservicing ||
          null,

        ScheduleDay:
          equipment.scheduleday ||
          null,
      });
    }

    // ============================================================
    // DATABASE FILTER CONDITIONS
    // SAME AS GET API
    // ============================================================

    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];

    // ============================================================
    // ORGANIZATION
    // ============================================================

    if (data.OrganizationID) {
      values.push(
        Number(
          data.OrganizationID,
        ),
      );

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }

    // ============================================================
    // EQUIPMENT
    // ============================================================

    if (
      data.EquipmentID &&
      String(
        data.EquipmentID,
      ).trim()
    ) {
      values.push(
        Number(
          data.EquipmentID,
        ),
      );

      conditions.push(
        `m.EquipmentID = $${values.length}`,
      );
    }

    // ============================================================
    // STATUS
    // ============================================================

    if (
      data.Status &&
      String(
        data.Status,
      ).trim()
    ) {
      values.push(
        String(
          data.Status,
        ).trim(),
      );

      conditions.push(
        `m.Status = $${values.length}`,
      );
    }

    // ============================================================
    // MAINTENANCE DATE
    // ============================================================

    if (data.MaintenanceDate) {
      values.push(
        data.MaintenanceDate,
      );

      conditions.push(
        `m.MaintenanceDate = $${values.length}`,
      );
    }

    // ============================================================
    // FROM DATE
    // ============================================================

    if (data.FromDate) {
      values.push(
        data.FromDate,
      );

      conditions.push(
        `m.MaintenanceDate >= $${values.length}`,
      );
    }

    // ============================================================
    // TO DATE
    // ============================================================

    if (data.ToDate) {
      values.push(
        data.ToDate,
      );

      conditions.push(
        `m.MaintenanceDate <= $${values.length}`,
      );
    }

    // ============================================================
    // SEARCH
    // SAME AS GET API
    // ============================================================

    if (
      data.Search &&
      String(
        data.Search,
      ).trim()
    ) {
      values.push(
        `%${String(
          data.Search,
        ).trim()}%`,
      );

      const index =
        values.length;

      conditions.push(`
        (
          m.Maintenance
            ILIKE $${index}

          OR m.MaintenanceBy
            ILIKE $${index}

          OR em.Description
            ILIKE $${index}

          OR em.SerialNumber
            ILIKE $${index}

          OR em.Area
            ILIKE $${index}

          OR EXISTS
          (
            SELECT 1

            FROM user_master searchUser

            WHERE
              searchUser.UserID =
                m.ServicedBy

              AND searchUser.IsDeleted =
                FALSE

              AND searchUser.FullName
                ILIKE $${index}
          )
        )
      `);
    }

    const where =
      conditions.join(
        " AND ",
      );

    // ============================================================
    // FETCH DATABASE RECORDS
    // Same query as GET
    // LIMIT / OFFSET removed only
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          m.*,

          u.FullName
            AS EngineerAssignedName,

          sb.FullName
            AS ServicedByName,

          em.Description
            AS EquipmentDescription,

          em.SerialNumber,

          em.Capacity,

          em.ModelNumber,

          em.Make,

          em.Area,

          em.ScheduleOfServicing,

          em.ScheduleDay

        FROM Engineering_Maintenance_Details m

        LEFT JOIN user_master u
          ON u.UserID =
             m.EngineerAssigned

          AND u.IsDeleted =
             FALSE

        LEFT JOIN user_master sb
          ON sb.UserID =
             m.ServicedBy

          AND sb.IsDeleted =
             FALSE

        LEFT JOIN Engineering_Equipment_Entry_Master em
          ON em.EquipmentID =
             m.EquipmentID

          AND em.IsDeleted =
             FALSE

        WHERE ${where}

        ORDER BY
          m.MaintenanceID DESC;
        `,
        values,
      );

    // ============================================================
    // SAME DATABASE MAPPING AS GET API
    // ============================================================

    const databaseRecords =
      result.rows.map(
        (row) => ({
          MaintenanceID:
            Number(
              row.maintenanceid,
            ),

          OrganizationID:
            Number(
              row.organizationid,
            ),

          EquipmentID:
            Number(
              row.equipmentid,
            ),

          Maintenance:
            row.maintenance ||
            null,

          MaintenanceDay:
            row.maintenanceday ||
            null,

          MaintenanceDate:
            formatDate(
              row.maintenancedate,
            ),

          MaintenanceBy:
            row.maintenanceby ||
            null,

          ServicedBy:
            row.servicedby
              ? Number(
                  row.servicedby,
                )
              : null,

          ServicedByName:
            row.servicedbyname ||
            null,

          EngineerAssigned:
            row.engineerassigned
              ? Number(
                  row.engineerassigned,
                )
              : null,

          EngineerAssignedName:
            row.engineerassignedname ||
            null,

          Status:
            row.status ||
            null,

          CreatedDate:
            formatDate(
              row.createddate,
            ),

          Description:
            row.equipmentdescription ||
            null,

          SerialNumber:
            row.serialnumber ||
            null,

          Capacity:
            row.capacity ||
            null,

          ModelNumber:
            row.modelnumber ||
            null,

          Make:
            row.make ||
            null,

          Area:
            row.area ||
            null,

          ScheduleOfServicing:
            row.scheduleofservicing ||
            null,

          ScheduleDay:
            row.scheduleday ||
            null,
        }),
      );

    // ============================================================
    // FINAL RECORDS
    // Same order as GET:
    // virtual first, database after
    // ============================================================

    const records = [
      ...virtualMaintenances,
      ...databaseRecords,
    ];

    // ============================================================
    // ORGANIZATION DETAILS
    // ============================================================

    const organizationResult =
      await pool.query(
        `
        SELECT
          OrganizationID,
          OrganizationName

        FROM Organization_Master

        WHERE OrganizationID = $1
          AND IsDeleted = FALSE

        LIMIT 1;
        `,
        [
          organizationID,
        ],
      );

    const organization =
      organizationResult.rows[0] ||
      null;

    // ============================================================
    // PDF COLUMNS
    // Screenshot ke according
    // ============================================================

    const columns = [
      {
        header:
          "Description",

        value: (row) =>
          row.Description,

        width:
          115,
      },

      {
        header:
          "Sr.No.",

        value: (row) =>
          row.SerialNumber,

        width:
          65,
      },

      {
        header:
          "Capacity",

        value: (row) =>
          row.Capacity,

        width:
          55,
      },

      {
        header:
          "Make",

        value: (row) =>
          row.Make,

        width:
          65,
      },

      {
        header:
          "Model",

        value: (row) =>
          row.ModelNumber,

        width:
          80,
      },

      {
        header:
          "Area",

        value: (row) =>
          row.Area,

        width:
          70,
      },

      {
        header:
          "Maintenance By",

        value: (row) =>
          row.MaintenanceBy,

        width:
          70,
      },

      {
        header:
          "Schedule",

        value: (row) =>
          row.ScheduleOfServicing,

        width:
          55,
      },

      {
        header:
          "Scheduled Date",

        value: (row) =>
          row.MaintenanceDate,

        width:
          65,

        align:
          "center",
      },

      {
        header:
          "Status",

        value: (row) =>
          row.Status,

        width:
          50,

        align:
          "center",
      },
    ];

    // ============================================================
    // METADATA
    // ============================================================

    const metadata = [
      {
        label:
          "Organization",

        value:
          organization
            ?.organizationname ||
          "-",
      },

      {
        label:
          "Total Records",

        value:
          records.length,
      },
    ];

    if (
      data.MaintenanceDate
    ) {
      metadata.push({
        label:
          "Maintenance Date",

        value:
          formatDate(
            data.MaintenanceDate,
          ),
      });
    }

    if (
      data.FromDate
    ) {
      metadata.push({
        label:
          "From Date",

        value:
          formatDate(
            data.FromDate,
          ),
      });
    }

    if (
      data.ToDate
    ) {
      metadata.push({
        label:
          "To Date",

        value:
          formatDate(
            data.ToDate,
          ),
      });
    }

    if (
      data.Status &&
      String(
        data.Status,
      ).trim()
    ) {
      metadata.push({
        label:
          "Status",

        value:
          data.Status,
      });
    }

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "DAILY MAINTENANCE REPORT",

        reportName:
          "Daily Maintenance Report",

        organizationId:
          organizationID,

        logoUrl:
          data.logoUrl,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          records,

        pageMargins:
          [
            15,
            20,
            15,
            35,
          ],
      });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Engineering daily maintenance report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Engineering_Daily_Maintenance_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Engineering Daily Maintenance Report PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate Engineering daily maintenance report PDF.",

      statusCode:
        503,
    };
  }
};
// =============================================================4. Monthly Maintenance Reports Pdf
const generateMonthlyMaintenanceReportPdf = async (data) => {
  try {
    const organizationID =
      Number(data.OrganizationID);

    const equipmentID =
      data.EquipmentID &&
      String(data.EquipmentID).trim()
        ? Number(data.EquipmentID)
        : null;

    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !Number.isInteger(organizationID) ||
      organizationID <= 0
    ) {
      return {
        success: false,
        message:
          "Valid OrganizationID is required.",
        statusCode: 400,
      };
    }

    // ============================================================
    // MONTH / YEAR
    // Same as GET
    // ============================================================

    const currentDate = new Date();

    const reportMonth =
      data.Month &&
      Number(data.Month) >= 1 &&
      Number(data.Month) <= 12
        ? Number(data.Month)
        : currentDate.getMonth() + 1;

    const reportYear =
      data.Year &&
      Number(data.Year) > 0
        ? Number(data.Year)
        : currentDate.getFullYear();

    // ============================================================
    // VIRTUAL MAINTENANCE
    // ============================================================

    let virtualMaintenances = [];

    // ============================================================
    // FETCH EQUIPMENT
    // Same as GET
    // ============================================================

    const equipmentValues = [];

    const equipmentConditions = [
      "e.IsDeleted = FALSE",
    ];

    if (
      Number.isInteger(organizationID) &&
      organizationID > 0
    ) {
      equipmentValues.push(
        organizationID,
      );

      equipmentConditions.push(
        `e.OrganizationID = $${equipmentValues.length}`,
      );
    }

    if (
      Number.isInteger(equipmentID) &&
      equipmentID > 0
    ) {
      equipmentValues.push(
        equipmentID,
      );

      equipmentConditions.push(
        `e.EquipmentID = $${equipmentValues.length}`,
      );
    }

    const equipmentResult =
      await pool.query(
        `
        SELECT
          e.EquipmentID,
          e.OrganizationID,

          e.Description,
          e.SerialNumber,
          e.Capacity,
          e.ModelNumber,
          e.Make,
          e.Area,

          e.CommissioningDate,

          e.WarrantyStartDate,
          e.WarrantyEndDate,
          e.WarrantyStatus,

          e.AMCType,
          e.AMCStartDate,
          e.AMCEndDate,
          e.AMCStatus,
          e.AMCYearlyExpense,

          e.ScheduleOfServicing,
          e.ScheduleDay

        FROM Engineering_Equipment_Entry_Master e

        WHERE
          ${equipmentConditions.join(" AND ")}

        ORDER BY
          e.EquipmentID ASC;
        `,
        equipmentValues,
      );

    // ============================================================
    // EQUIPMENT IDS
    // ============================================================

    const equipmentIDs =
      equipmentResult.rows.map(
        (item) =>
          Number(
            item.equipmentid,
          ),
      );

    // ============================================================
    // EXISTING MAINTENANCE
    // SAME MONTH / YEAR
    // ============================================================

    const existingEquipmentIDs =
      new Set();

    if (equipmentIDs.length) {
      const existingResult =
        await pool.query(
          `
          SELECT DISTINCT
            EquipmentID

          FROM Engineering_Maintenance_Details

          WHERE
            EquipmentID =
              ANY($1::bigint[])

            AND IsDeleted = FALSE

            AND EXTRACT(
              MONTH FROM MaintenanceDate
            )::int = $2

            AND EXTRACT(
              YEAR FROM MaintenanceDate
            )::int = $3;
          `,
          [
            equipmentIDs,
            reportMonth,
            reportYear,
          ],
        );

      existingResult.rows.forEach(
        (item) => {
          existingEquipmentIDs.add(
            Number(
              item.equipmentid,
            ),
          );
        },
      );
    }

    // ============================================================
    // CREATE VIRTUAL ROWS
    // SAME LOGIC AS GET
    // ============================================================

    for (
      const equipment of
      equipmentResult.rows
    ) {
      const currentEquipmentID =
        Number(
          equipment.equipmentid,
        );

      if (
        existingEquipmentIDs.has(
          currentEquipmentID,
        )
      ) {
        continue;
      }

      const schedule = String(
        equipment.scheduleofservicing ||
          "",
      )
        .trim()
        .toLowerCase()
        .replace(
          /[\s_-]+/g,
          "",
        );

      const dayMatch =
        String(
          equipment.scheduleday ||
            "",
        ).match(/\d+/);

      const scheduleDay =
        dayMatch
          ? Number(
              dayMatch[0],
            )
          : null;

      // ==========================================================
      // DUE MONTH CHECK
      // SAME AS GET
      // ==========================================================

      let isDueMonth = false;

      switch (schedule) {
        case "monthly":
          isDueMonth = true;
          break;

        case "bimonth":
        case "bimonthly":
          isDueMonth = [
            1,
            3,
            5,
            7,
            9,
            11,
          ].includes(
            reportMonth,
          );
          break;

        case "quarterly":
        case "quarter":
          isDueMonth = [
            1,
            4,
            7,
            10,
          ].includes(
            reportMonth,
          );
          break;

        case "sixmonth":
        case "sixmonthly":
        case "6month":
        case "6monthly":
          isDueMonth = [
            1,
            7,
          ].includes(
            reportMonth,
          );
          break;

        case "yearly":
        case "annual":
        case "annually":
          isDueMonth =
            reportMonth === 1;
          break;

        default:
          isDueMonth = false;
          break;
      }

      if (!isDueMonth) {
        continue;
      }

      if (
        !Number.isInteger(
          scheduleDay,
        ) ||
        scheduleDay <= 0
      ) {
        continue;
      }

      // ==========================================================
      // SCHEDULE DATE
      // ==========================================================

      const maxDay =
        new Date(
          reportYear,
          reportMonth,
          0,
        ).getDate();

      const finalScheduleDay =
        Math.min(
          scheduleDay,
          maxDay,
        );

      const monthText =
        String(
          reportMonth,
        ).padStart(
          2,
          "0",
        );

      const dayText =
        String(
          finalScheduleDay,
        ).padStart(
          2,
          "0",
        );

      const scheduledDate =
        `${reportYear}-${monthText}-${dayText}`;

      // ==========================================================
      // STATUS FILTER
      // SAME AS GET
      // ==========================================================

      if (
        data.Status &&
        String(
          data.Status,
        ).trim() &&
        String(
          data.Status,
        )
          .trim()
          .toLowerCase() !==
          "pending"
      ) {
        continue;
      }

      virtualMaintenances.push({
        MaintenanceID: 0,

        OrganizationID:
          Number(
            equipment.organizationid,
          ),

        EquipmentID:
          currentEquipmentID,

        MaintenanceBy:
          null,

        Status:
          "Pending",

        MaintenanceDate:
          formatDate(
            scheduledDate,
          ),

        Description:
          equipment.description ||
          null,

        SerialNumber:
          equipment.serialnumber ||
          null,

        Capacity:
          equipment.capacity ||
          null,

        ModelNumber:
          equipment.modelnumber ||
          null,

        Make:
          equipment.make ||
          null,

        Area:
          equipment.area ||
          null,

        CommissioningDate:
          formatDate(
            equipment.commissioningdate,
          ),

        WarrantyStartDate:
          formatDate(
            equipment.warrantystartdate,
          ),

        WarrantyEndDate:
          formatDate(
            equipment.warrantyenddate,
          ),

        WarrantyStatus:
          equipment.warrantystatus ||
          null,

        AMCType:
          equipment.amctype ||
          null,

        AMCStartDate:
          formatDate(
            equipment.amcstartdate,
          ),

        AMCEndDate:
          formatDate(
            equipment.amcenddate,
          ),

        AMCStatus:
          equipment.amcstatus ||
          null,

        AMCYearlyExpense:
          equipment.amcyearlyexpense !==
            null
            ? Number(
                equipment.amcyearlyexpense,
              )
            : null,

        ScheduleOfServicing:
          equipment.scheduleofservicing ||
          null,

        ScheduleDay:
          equipment.scheduleday ||
          null,
      });
    }

    // ============================================================
    // DATABASE CONDITIONS
    // SAME AS GET
    // ============================================================

    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];

    if (data.OrganizationID) {
      values.push(
        Number(
          data.OrganizationID,
        ),
      );

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }

    if (
      data.EquipmentID &&
      String(
        data.EquipmentID,
      ).trim()
    ) {
      values.push(
        Number(
          data.EquipmentID,
        ),
      );

      conditions.push(
        `m.EquipmentID = $${values.length}`,
      );
    }

    // ============================================================
    // MONTH
    // ============================================================

    values.push(
      reportMonth,
    );

    conditions.push(
      `EXTRACT(MONTH FROM m.MaintenanceDate)::int = $${values.length}`,
    );

    // ============================================================
    // YEAR
    // ============================================================

    values.push(
      reportYear,
    );

    conditions.push(
      `EXTRACT(YEAR FROM m.MaintenanceDate)::int = $${values.length}`,
    );

    // ============================================================
    // STATUS
    // ============================================================

    if (
      data.Status &&
      String(
        data.Status,
      ).trim()
    ) {
      values.push(
        String(
          data.Status,
        ).trim(),
      );

      conditions.push(
        `TRIM(m.Status) = $${values.length}`,
      );
    }

    // ============================================================
    // FROM DATE
    // ============================================================

    if (data.FromDate) {
      values.push(
        data.FromDate,
      );

      conditions.push(
        `m.MaintenanceDate >= $${values.length}`,
      );
    }

    // ============================================================
    // TO DATE
    // ============================================================

    if (data.ToDate) {
      values.push(
        data.ToDate,
      );

      conditions.push(
        `m.MaintenanceDate <= $${values.length}`,
      );
    }

    // ============================================================
    // SEARCH
    // SAME AS GET
    // ============================================================

    if (
      data.Search &&
      String(
        data.Search,
      ).trim()
    ) {
      values.push(
        `%${String(
          data.Search,
        ).trim()}%`,
      );

      const index =
        values.length;

      conditions.push(`
        (
          m.Maintenance
            ILIKE $${index}

          OR m.MaintenanceBy
            ILIKE $${index}

          OR em.Description
            ILIKE $${index}

          OR em.SerialNumber
            ILIKE $${index}

          OR em.Area
            ILIKE $${index}

          OR EXISTS
          (
            SELECT 1

            FROM user_master searchUser

            WHERE
              searchUser.UserID =
                m.ServicedBy

              AND searchUser.IsDeleted =
                FALSE

              AND searchUser.FullName
                ILIKE $${index}
          )
        )
      `);
    }

    const where =
      conditions.join(
        " AND ",
      );

    // ============================================================
    // DATABASE RECORDS
    // SAME QUERY AS GET
    // LIMIT OFFSET removed only
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          m.*,

          u.FullName
            AS EngineerAssignedName,

          sb.FullName
            AS ServicedByName,

          em.Description
            AS EquipmentDescription,

          em.SerialNumber,

          em.Capacity,

          em.ModelNumber,

          em.Make,

          em.Area,

          em.CommissioningDate,

          em.WarrantyStartDate,

          em.WarrantyEndDate,

          em.WarrantyStatus,

          em.AMCType,

          em.AMCStartDate,

          em.AMCEndDate,

          em.AMCStatus,

          em.AMCYearlyExpense,

          em.ScheduleOfServicing,

          em.ScheduleDay

        FROM Engineering_Maintenance_Details m

        LEFT JOIN user_master u
          ON u.UserID =
             m.EngineerAssigned

          AND u.IsDeleted =
             FALSE

        LEFT JOIN user_master sb
          ON sb.UserID =
             m.ServicedBy

          AND sb.IsDeleted =
             FALSE

        LEFT JOIN Engineering_Equipment_Entry_Master em
          ON em.EquipmentID =
             m.EquipmentID

          AND em.IsDeleted =
             FALSE

        WHERE
          ${where}

        ORDER BY
          m.MaintenanceDate DESC,
          m.MaintenanceID DESC;
        `,
        values,
      );

    // ============================================================
    // SAME MAPPING AS GET
    // ============================================================

    const databaseRecords =
      result.rows.map(
        (row) => ({
          MaintenanceID:
            Number(
              row.maintenanceid,
            ),

          OrganizationID:
            Number(
              row.organizationid,
            ),

          EquipmentID:
            Number(
              row.equipmentid,
            ),

          Maintenance:
            row.maintenance ||
            null,

          MaintenanceDay:
            row.maintenanceday ||
            null,

          MaintenanceDate:
            formatDate(
              row.maintenancedate,
            ),

          MaintenanceBy:
            row.maintenanceby ||
            null,

          ServicedBy:
            row.servicedby
              ? Number(
                  row.servicedby,
                )
              : null,

          ServicedByName:
            row.servicedbyname ||
            null,

          EngineerAssigned:
            row.engineerassigned
              ? Number(
                  row.engineerassigned,
                )
              : null,

          EngineerAssignedName:
            row.engineerassignedname ||
            null,

          Status:
            row.status
              ? String(
                  row.status,
                ).trim()
              : null,

          CreatedDate:
            formatDate(
              row.createddate,
            ),

          Description:
            row.equipmentdescription ||
            null,

          SerialNumber:
            row.serialnumber ||
            null,

          Capacity:
            row.capacity ||
            null,

          ModelNumber:
            row.modelnumber ||
            null,

          Make:
            row.make ||
            null,

          Area:
            row.area ||
            null,

          CommissioningDate:
            formatDate(
              row.commissioningdate,
            ),

          WarrantyStartDate:
            formatDate(
              row.warrantystartdate,
            ),

          WarrantyEndDate:
            formatDate(
              row.warrantyenddate,
            ),

          WarrantyStatus:
            row.warrantystatus ||
            null,

          AMCType:
            row.amctype ||
            null,

          AMCStartDate:
            formatDate(
              row.amcstartdate,
            ),

          AMCEndDate:
            formatDate(
              row.amcenddate,
            ),

          AMCStatus:
            row.amcstatus ||
            null,

          AMCYearlyExpense:
            row.amcyearlyexpense !==
              null
              ? Number(
                  row.amcyearlyexpense,
                )
              : null,

          ScheduleOfServicing:
            row.scheduleofservicing ||
            null,

          ScheduleDay:
            row.scheduleday ||
            null,
        }),
      );

    // ============================================================
    // FINAL RECORDS
    // ============================================================

    const records = [
      ...virtualMaintenances,
      ...databaseRecords,
    ];

    // ============================================================
    // ORGANIZATION DETAILS
    // ============================================================

    const organizationResult =
      await pool.query(
        `
        SELECT
          OrganizationID,
          OrganizationName

        FROM Organization_Master

        WHERE OrganizationID = $1
          AND IsDeleted = FALSE

        LIMIT 1;
        `,
        [
          organizationID,
        ],
      );

    const organization =
      organizationResult.rows[0] ||
      null;

    // ============================================================
    // PDF COLUMNS
    // EXACTLY IMAGE KE ACCORDING
    // ============================================================

    const columns = [
      {
        header:
          "Description",

        value: (row) => {
          const lines = [];

          if (row.Description) {
            lines.push(
              row.Description,
            );
          }

          if (row.SerialNumber) {
            lines.push(
              `Sr.No.: ${row.SerialNumber}`,
            );
          }

          if (row.Capacity) {
            lines.push(
              `Capacity: ${row.Capacity}`,
            );
          }

          return (
            lines.join("\n") ||
            "-"
          );
        },

        width:
          125,
      },

      {
        header:
          "Make & Model",

        value: (row) => {
          const lines = [];

          if (row.Make) {
            lines.push(
              `Make: ${row.Make}`,
            );
          }

          if (row.ModelNumber) {
            lines.push(
              `Model: ${row.ModelNumber}`,
            );
          }

          return (
            lines.join("\n") ||
            "-"
          );
        },

        width:
          90,
      },

      {
        header:
          "Area",

        value: (row) =>
          row.Area,

        width:
          60,
      },

      {
        header:
          "Comm. Date",

        value: (row) =>
          row.CommissioningDate,

        width:
          52,

        align:
          "center",
      },

      {
        header:
          "Warranty Period",

        value: (row) => {
          if (
            !row.WarrantyStartDate &&
            !row.WarrantyEndDate
          ) {
            return "-";
          }

          return [
            `From : ${row.WarrantyStartDate || "-"}`,
            `To : ${row.WarrantyEndDate || "-"}`,
          ].join("\n");
        },

        width:
          76,
      },

      {
        header:
          "Warranty Status",

        value: (row) =>
          row.WarrantyStatus,

        width:
          60,
      },

      {
        header:
          "AMC Period",

        value: (row) => {
          if (
            !row.AMCStartDate &&
            !row.AMCEndDate
          ) {
            return [
              "From :",
              "To :",
            ].join("\n");
          }

          return [
            `From : ${row.AMCStartDate || "-"}`,
            `To : ${row.AMCEndDate || "-"}`,
          ].join("\n");
        },

        width:
          76,
      },

      {
        header:
          "AMC Status",

        value: (row) =>
          row.AMCStatus,

        width:
          58,
      },

      {
        header:
          "Schedule of servicing",

        value: (row) =>
          row.ScheduleOfServicing,

        width:
          64,
      },

      {
        header:
          "Scheduled Date",

        value: (row) =>
          row.MaintenanceDate,

        width:
          65,

        align:
          "center",
      },

      {
        header:
          "Scheduled Status",

        value: (row) =>
          row.Status,

        width:
          60,

        align:
          "center",
      },
    ];

    // ============================================================
    // METADATA
    // ============================================================

    const metadata = [
      {
        label:
          "Organization",

        value:
          organization
            ?.organizationname ||
          "-",
      },

      {
        label:
          "Month",

        value:
          reportMonth,
      },

      {
        label:
          "Year",

        value:
          reportYear,
      },

      {
        label:
          "Total Records",

        value:
          records.length,
      },
    ];

    if (
      data.Status &&
      String(
        data.Status,
      ).trim()
    ) {
      metadata.push({
        label:
          "Status",

        value:
          data.Status,
      });
    }

    if (
      data.FromDate
    ) {
      metadata.push({
        label:
          "From Date",

        value:
          formatDate(
            data.FromDate,
          ),
      });
    }

    if (
      data.ToDate
    ) {
      metadata.push({
        label:
          "To Date",

        value:
          formatDate(
            data.ToDate,
          ),
      });
    }

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "MONTHLY MAINTENANCE REPORT",

        reportName:
          "Monthly Maintenance Report",

        organizationId:
          organizationID,

        logoUrl:
          data.logoUrl,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          records,

        pageMargins:
          [
            12,
            20,
            12,
            35,
          ],
      });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Engineering monthly maintenance report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Engineering_Monthly_Maintenance_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Engineering Monthly Maintenance Report PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate Engineering monthly maintenance report PDF.",

      statusCode:
        503,
    };
  }
};
// =============================================================5. Scheduled Missing Reports Pdf
const generateScheduledMissingReportPdf = async (data) => {
  try {
    const organizationID = Number(
      data.OrganizationID,
    );

    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !Number.isInteger(organizationID) ||
      organizationID <= 0
    ) {
      return {
        success: false,
        message:
          "Valid OrganizationID is required.",
        statusCode: 400,
      };
    }

    // ============================================================
    // FILTER CONDITIONS
    // SAME AS GET API
    // ============================================================

    const values = [];

    const conditions = [
      "e.IsDeleted = FALSE",
    ];

    // ============================================================
    // ORGANIZATION FILTER
    // ============================================================

    if (data.OrganizationID) {
      values.push(
        Number(
          data.OrganizationID,
        ),
      );

      conditions.push(
        `e.OrganizationID = $${values.length}`,
      );
    }

    // ============================================================
    // ONLY INCOMPLETE EQUIPMENT
    // SAME CONDITION AS GET API
    // ============================================================

    conditions.push(`
      (
        e.WarrantyStartDate IS NULL

        OR e.WarrantyEndDate IS NULL

        OR e.WarrantyStatus IS NULL
        OR TRIM(e.WarrantyStatus) = ''

        OR e.AMCType IS NULL
        OR TRIM(e.AMCType) = ''

        OR e.AMCStartDate IS NULL

        OR e.AMCEndDate IS NULL

        OR e.AMCStatus IS NULL
        OR TRIM(e.AMCStatus) = ''

        OR e.AMCYearlyExpense IS NULL

        OR e.ScheduleOfServicing IS NULL
        OR TRIM(e.ScheduleOfServicing) = ''

        OR e.ScheduleDay IS NULL
        OR TRIM(e.ScheduleDay) = ''
      )
    `);

    const where =
      conditions.join(
        " AND ",
      );

    // ============================================================
    // LIST
    // SAME QUERY AS GET API
    // LIMIT / OFFSET REMOVED ONLY
    // ============================================================

    const result =
      await pool.query(
        `
        SELECT
          e.EquipmentID,
          e.OrganizationID,

          e.Description,
          e.SerialNumber,
          e.TypeOfMachine,
          e.Capacity,
          e.ModelNumber,
          e.Make,
          e.Area,

          e.CommissioningDate,

          e.WarrantyStartDate,
          e.WarrantyEndDate,
          e.WarrantyStatus,

          e.AMCType,
          e.AMCStartDate,
          e.AMCEndDate,
          e.AMCStatus,
          e.AMCYearlyExpense,

          e.ScheduleOfServicing,
          e.ScheduleDay,

          e.ResponsiblePerson,
          e.Remarks,

          e.CreatedDate

        FROM Engineering_Equipment_Entry_Master e

        WHERE
          ${where}

        ORDER BY
          e.EquipmentID DESC;
        `,
        values,
      );

    // ============================================================
    // SAME MAPPING AS GET API
    // ============================================================

    const records =
      result.rows.map(
        (row) => ({
          EquipmentID:
            Number(
              row.equipmentid,
            ),

          OrganizationID:
            Number(
              row.organizationid,
            ),

          Description:
            row.description ||
            null,

          SerialNumber:
            row.serialnumber ||
            null,

          TypeOfMachine:
            row.typeofmachine ||
            null,

          Capacity:
            row.capacity ||
            null,

          ModelNumber:
            row.modelnumber ||
            null,

          Make:
            row.make ||
            null,

          Area:
            row.area ||
            null,

          CommissioningDate:
            formatDate(
              row.commissioningdate,
            ),

          WarrantyStartDate:
            formatDate(
              row.warrantystartdate,
            ),

          WarrantyEndDate:
            formatDate(
              row.warrantyenddate,
            ),

          WarrantyStatus:
            row.warrantystatus ||
            null,

          AMCType:
            row.amctype ||
            null,

          AMCStartDate:
            formatDate(
              row.amcstartdate,
            ),

          AMCEndDate:
            formatDate(
              row.amcenddate,
            ),

          AMCStatus:
            row.amcstatus ||
            null,

          AMCYearlyExpense:
            row.amcyearlyexpense !==
              null
              ? Number(
                  row.amcyearlyexpense,
                )
              : null,

          ScheduleOfServicing:
            row.scheduleofservicing ||
            null,

          ScheduleDay:
            row.scheduleday ||
            null,

          ResponsiblePerson:
            row.responsibleperson
              ? Number(
                  row.responsibleperson,
                )
              : null,

          Remarks:
            row.remarks ||
            null,

          CreatedDate:
            formatDate(
              row.createddate,
            ),
        }),
      );

    // ============================================================
    // ORGANIZATION DETAILS
    // ============================================================

    const organizationResult =
      await pool.query(
        `
        SELECT
          OrganizationID,
          OrganizationName

        FROM Organization_Master

        WHERE OrganizationID = $1
          AND IsDeleted = FALSE

        LIMIT 1;
        `,
        [
          organizationID,
        ],
      );

    const organization =
      organizationResult.rows[0] ||
      null;

    // ============================================================
    // PDF COLUMNS
    // IMAGE KE ACCORDING
    // ============================================================

    const columns = [
      {
        header:
          "Description",

        value: (row) => {
          const lines = [];

          if (row.Description) {
            lines.push(
              row.Description,
            );
          }

          if (row.SerialNumber) {
            lines.push(
              `Sr.No.: ${row.SerialNumber}`,
            );
          }

          if (row.Capacity) {
            lines.push(
              `Capacity: ${row.Capacity}`,
            );
          }

          return (
            lines.join("\n") ||
            "-"
          );
        },

        width:
          130,
      },

      {
        header:
          "Make & Model",

        value: (row) => {
          const lines = [];

          if (row.Make) {
            lines.push(
              `Make: ${row.Make}`,
            );
          }

          if (row.ModelNumber) {
            lines.push(
              `Model: ${row.ModelNumber}`,
            );
          }

          return (
            lines.join("\n") ||
            "-"
          );
        },

        width:
          95,
      },

      {
        header:
          "Area",

        value: (row) =>
          row.Area,

        width:
          75,
      },

      {
        header:
          "Comm. Date",

        value: (row) =>
          row.CommissioningDate,

        width:
          58,

        align:
          "center",
      },

      {
        header:
          "Warranty Period",

        value: (row) => {
          if (
            !row.WarrantyStartDate &&
            !row.WarrantyEndDate
          ) {
            return "-";
          }

          return [
            `From : ${row.WarrantyStartDate || "-"}`,
            `To : ${row.WarrantyEndDate || "-"}`,
          ].join("\n");
        },

        width:
          82,
      },

      {
        header:
          "Warranty Status",

        value: (row) =>
          row.WarrantyStatus,

        width:
          65,
      },

      {
        header:
          "AMC Period",

        value: (row) => {
          if (
            !row.AMCStartDate &&
            !row.AMCEndDate
          ) {
            return [
              "From :",
              "To :",
            ].join("\n");
          }

          return [
            `From : ${row.AMCStartDate || "-"}`,
            `To : ${row.AMCEndDate || "-"}`,
          ].join("\n");
        },

        width:
          82,
      },

      {
        header:
          "AMC Status",

        value: (row) =>
          row.AMCStatus,

        width:
          65,
      },

      {
        header:
          "Schedule of servicing",

        value: (row) => {
          const lines = [];

          if (
            row.ScheduleOfServicing
          ) {
            lines.push(
              row.ScheduleOfServicing,
            );
          }

          if (
            row.ScheduleDay
          ) {
            lines.push(
              `Day: ${row.ScheduleDay}`,
            );
          }

          return (
            lines.join("\n") ||
            "-"
          );
        },

        width:
          82,
      },
    ];

    // ============================================================
    // METADATA
    // ============================================================

    const metadata = [
      {
        label:
          "Organization",

        value:
          organization
            ?.organizationname ||
          "-",
      },

      {
        label:
          "Total Records",

        value:
          records.length,
      },
    ];

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "MAINTENANCE SCHEDULE MISSING REPORT",

        reportName:
          "Maintenance Schedule Missing Report",

        organizationId:
          organizationID,

        logoUrl:
          data.logoUrl,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          records,

        pageMargins:
          [
            15,
            20,
            15,
            35,
          ],
      });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Maintenance schedule missing report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Maintenance_Schedule_Missing_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Maintenance Schedule Missing Report PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate maintenance schedule missing report PDF.",

      statusCode:
        503,
    };
  }
};
// ============================================================================================AMC of Equipment
// ========================Default AMC Approval Levels Helper
const DEFAULT_AMC_APPROVALS = Object.freeze([
  { LevelNo: 1, ApprovalRole: "FC" },
  { LevelNo: 2, ApprovalRole: "GM" },
  { LevelNo: 3, ApprovalRole: "RD" },
  { LevelNo: 4, ApprovalRole: "CEO" },
]);
const AMC_APPROVAL_ROLES = new Set([
  "FC",
  "GM",
  "RD",
  "CEO",
]);
// ============================================================Create AMC
const createAMC = async (data) => {
  let client;
  let transactionStarted = false;

  const documents = Array.isArray(data.Documents)
    ? data.Documents
    : [];

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // 1. Validate Organization + Equipment
    // ============================================================

    const equipmentResult = await client.query(
      `
      SELECT
        EquipmentID,
        OrganizationID
      FROM Engineering_Equipment_Entry_Master
      WHERE EquipmentID = $1
        AND OrganizationID = $2
        AND IsDeleted = FALSE
      LIMIT 1;
      `,
      [
        data.EquipmentID,
        data.OrganizationID,
      ],
    );

    if (equipmentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail(
        "Equipment not found for the selected organization.",
        404,
      );
    }

    // ============================================================
    // 2. Validate AMC Dates
    // ============================================================

    if (
      data.AMCStartDate &&
      data.AMCEndDate &&
      data.AMCStartDate > data.AMCEndDate
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return fail(
        "AMCStartDate cannot be greater than AMCEndDate.",
        400,
      );
    }

    // ============================================================
    // 3. Create AMC Master
    // ============================================================

    const masterResult = await client.query(
      `
      INSERT INTO Engineering_AMC_Master
      (
        OrganizationID,
        EquipmentID,

        AMCStartDate,
        AMCEndDate,
        AMCType,
        AMCAmount,

        VendorName,
        VendorEmailAddress,
        VendorMobileNumber,
        VendorSecondMobileNumber,
        VendorLandlineNumber,
        VendorAddress,
        VendorCity,
        VendorState,
        VendorPincode,

        IsDeleted,

        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,
        $2,

        $3,
        $4,
        $5,
        $6,

        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,

        FALSE,

        $16,
        CURRENT_TIMESTAMP
      )
      RETURNING AMCID;
      `,
      [
        data.OrganizationID,
        data.EquipmentID,

        data.AMCStartDate || null,
        data.AMCEndDate || null,
        data.AMCType || null,
        data.AMCAmount ?? null,

        data.VendorName || null,
        data.VendorEmailAddress || null,
        data.VendorMobileNumber || null,
        data.VendorSecondMobileNumber || null,
        data.VendorLandlineNumber || null,
        data.VendorAddress || null,
        data.VendorCity || null,
        data.VendorState || null,
        data.VendorPincode || null,

        data.UserID,
      ],
    );

    const AMCID = Number(
      masterResult.rows[0].amcid,
    );

    // ============================================================
    // 4. Insert AMC Documents
    // ============================================================

    for (const document of documents) {
      await client.query(
        `
        INSERT INTO Engineering_AMC_Documents
        (
          AMCID,
          OrganizationID,

          FileName,
          FilePath,
          FileType,
          FileSize,

          IsDeleted,

          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,
          $2,

          $3,
          $4,
          $5,
          $6,

          FALSE,

          $7,
          CURRENT_TIMESTAMP
        );
        `,
        [
          AMCID,
          data.OrganizationID,

          document.FileName || null,
          document.FilePath || null,
          document.FileType || null,
          document.FileSize ?? null,

          data.UserID,
        ],
      );
    }

    // ============================================================
    // 5. Validate AMC Approval Configuration
    //
    // If organization-specific config exists:
    // only FC, GM, RD, CEO are allowed.
    //
    // If no config exists:
    // service will later use default:
    // FC -> GM -> RD -> CEO
    // ============================================================

    const approvalConfigResult = await client.query(
      `
      SELECT
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory
      FROM Engineering_AMC_Approval_Config
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
      ORDER BY
        ApprovalOrder ASC,
        ApprovalLevel ASC,
        AMCApprovalConfigID ASC;
      `,
      [data.OrganizationID],
    );

    const validApprovalRoles = new Set([
      "FC",
      "GM",
      "RD",
      "CEO",
    ]);

    for (const row of approvalConfigResult.rows) {
      const role = String(
        row.approvalrole || "",
      )
        .trim()
        .toUpperCase();

      if (!validApprovalRoles.has(role)) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return fail(
          "AMC approval configuration contains an invalid approval role.",
          400,
        );
      }
    }

    // ============================================================
    // 6. Create AMC Approval Row
    // ============================================================

    await client.query(
      `
      INSERT INTO Engineering_AMC_Approval
      (
        AMCID,

        FCStatus,
        GMStatus,
        RDStatus,
        CEOStatus,

        FinalStatus,

        IsDeleted,

        CreatedBy,
        CreatedDate
      )
      VALUES
      (
        $1,

        'Pending',
        'Pending',
        'Pending',
        'Pending',

        'Pending',

        FALSE,

        $2,
        CURRENT_TIMESTAMP
      );
      `,
      [
        AMCID,
        data.UserID,
      ],
    );

    // ============================================================
    // 7. Commit
    // ============================================================

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      message: "AMC created successfully."
    };
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Create AMC Rollback Error:",
          rollbackError.message,
        );
      }
    }

    console.error(
      "Create AMC Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    if (error.code === "23503") {
      return fail(
        "Invalid AMC organization, equipment, or related data.",
        400,
      );
    }

    if (error.code === "23505") {
      return fail(
        "AMC record already exists.",
        409,
      );
    }

    if (error.code === "22P02") {
      return fail(
        "Invalid AMC data.",
        400,
      );
    }

    return fail(
      "Unable to create AMC at this time.",
      500,
    );
  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================AMC List
//================Resolve Logged-In User AMC Approval Role Helper
const resolveAMCApprovalRole = ({
  OrganizationID,
  UserType,
  DepartmentName,
}) => {
  const organizationID = Number(OrganizationID);

  const userType = String(UserType || "")
    .trim()
    .toUpperCase();

  const departmentName = String(DepartmentName || "")
    .trim()
    .toUpperCase();

  // ============================================================
  // RD
  // OrganizationID = 10
  // UserType = HOD
  // Department = Finance
  //
  // IMPORTANT:
  // RD must be checked before FC
  // ============================================================

  if (
    organizationID === 10 &&
    userType === "HOD" &&
    departmentName === "FINANCE"
  ) {
    return "RD";
  }

  // ============================================================
  // FC
  // UserType = HOD
  // Department = Finance
  // ============================================================

  if (
    userType === "HOD" &&
    departmentName === "FINANCE"
  ) {
    return "FC";
  }

  // ============================================================
  // GM
  // ============================================================

  if (userType === "GM") {
    return "GM";
  }

  // ============================================================
  // CEO
  // ============================================================

  if (userType === "CEO") {
    return "CEO";
  }

  return null;
};
// ===============Get AMC Approval Flow Helper
const getAMCApprovalFlow = async (
  OrganizationID,
  db = pool,
) => {
  const result = await db.query(
    `
    SELECT
      AMCApprovalConfigID,
      ApprovalLevel,
      ApprovalRole,
      ApprovalOrder,
      IsMandatory
    FROM Engineering_AMC_Approval_Config
    WHERE OrganizationID = $1
      AND IsDeleted = FALSE
    ORDER BY
      ApprovalOrder ASC,
      ApprovalLevel ASC,
      AMCApprovalConfigID ASC;
    `,
    [OrganizationID],
  );

  if (result.rows.length > 0) {
    return result.rows.map((row) => ({
      AMCApprovalConfigID:
        Number(row.amcapprovalconfigid),

      LevelNo:
        Number(row.approvallevel),

      ApprovalRole:
        String(row.approvalrole || "")
          .trim()
          .toUpperCase(),

      ApprovalOrder:
        Number(row.approvalorder),

      IsMandatory:
        Boolean(row.ismandatory),
    }));
  }

  return DEFAULT_AMC_APPROVALS.map(
    (item, index) => ({
      AMCApprovalConfigID: null,

      LevelNo:
        item.LevelNo,

      ApprovalRole:
        item.ApprovalRole,

      ApprovalOrder:
        index + 1,

      IsMandatory: true,
    }),
  );
};
// ================AMC Row Mapper Helper
const mapAMC = (row) => ({
  AMCID:
    Number(row.amcid),

  OrganizationID:
    Number(row.organizationid),

  EquipmentID:
    Number(row.equipmentid),

  // ============================================================
  // AMC
  // ============================================================

  AMCStartDate:
    formatDate(row.amcstartdate),

  AMCEndDate:
    formatDate(row.amcenddate),

  AMCType:
    row.amctype,

  AMCAmount:
    row.amcamount !== null
      ? Number(row.amcamount)
      : null,

  // ============================================================
  // Vendor
  // ============================================================

  VendorName:
    row.vendorname,

  VendorEmailAddress:
    row.vendoremailaddress,

  VendorMobileNumber:
    row.vendormobilenumber,

  VendorSecondMobileNumber:
    row.vendorsecondmobilenumber,

  VendorLandlineNumber:
    row.vendorlandlinenumber,

  VendorAddress:
    row.vendoraddress,

  VendorCity:
    row.vendorcity,

  VendorState:
    row.vendorstate,

  VendorPincode:
    row.vendorpincode,

  // ============================================================
  // Equipment
  // ============================================================

  Description:
    row.description,

  SerialNumber:
    row.serialnumber,

  TypeOfMachine:
    row.typeofmachine,

  Capacity:
    row.capacity,

  ModelNumber:
    row.modelnumber,

  Make:
    row.make,

  Area:
    row.area,

  CommissioningDate:
    formatDate(row.commissioningdate),

  WarrantyStartDate:
    formatDate(row.warrantystartdate),

  WarrantyEndDate:
    formatDate(row.warrantyenddate),

  WarrantyStatus:
    row.warrantystatus,

  ScheduleOfServicing:
    row.scheduleofservicing,

  ScheduleDay:
    row.scheduleday,

  ResponsiblePerson:
    row.responsibleperson !== null
      ? Number(row.responsibleperson)
      : null,

  // ============================================================
  // Approval
  // ============================================================

  CurrentApprovalRole:
    row.currentapprovalrole || null,

  CurrentStatus:
    row.currentstatus || "Pending",

  FinalStatus:
    row.finalstatus || "Pending",

  FinalStatusDateTime:
    row.finalstatusdatetime || null,

  Approvals: [],
  Documents: [],

  // ============================================================
  // Audit
  // ============================================================


  CreatedDate:
    formatDate(row.createddate),

 
});
//=================Attach AMC Documents + Approval Array Helper
const attachAMCRelatedData = async (
  rows,
  OrganizationID,
) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const AMCIDs = rows.map(
    (row) => Number(row.amcid),
  );

  // ============================================================
  // Documents
  // ============================================================

  const documentsResult = await pool.query(
    `
    SELECT
      AMCDocumentID,
      AMCID,
      OrganizationID,
      FileName,
      FilePath,
      FileType,
      FileSize,
      CreatedDate
    FROM Engineering_AMC_Documents
    WHERE AMCID = ANY($1::bigint[])
      AND IsDeleted = FALSE
    ORDER BY
      AMCID ASC,
      AMCDocumentID ASC;
    `,
    [AMCIDs],
  );

  // ============================================================
  // Approval Flow
  // ============================================================

  const approvalFlow =
    await getAMCApprovalFlow(
      OrganizationID,
    );

  // ============================================================
  // Map AMC Rows
  // ============================================================

  const mapped = rows.map((row) => {
    const item = mapAMC(row);

    const statusMap = {
      FC: {
        Status:
          row.fcstatus || "Pending",

        StatusDateTime:
          row.fcstatusdatetime || null,

        StatusApprovedBy:
          row.fcstatusapprovedby !== null
            ? Number(row.fcstatusapprovedby)
            : null,

        Remarks:
          row.fcremarks || null,
      },

      GM: {
        Status:
          row.gmstatus || "Pending",

        StatusDateTime:
          row.gmstatusdatetime || null,

        StatusApprovedBy:
          row.gmstatusapprovedby !== null
            ? Number(row.gmstatusapprovedby)
            : null,

        Remarks:
          row.gmremarks || null,
      },

      RD: {
        Status:
          row.rdstatus || "Pending",

        StatusDateTime:
          row.rdstatusdatetime || null,

        StatusApprovedBy:
          row.rdstatusapprovedby !== null
            ? Number(row.rdstatusapprovedby)
            : null,

        Remarks:
          row.rdremarks || null,
      },

      CEO: {
        Status:
          row.ceostatus || "Pending",

        StatusDateTime:
          row.ceostatusdatetime || null,

        StatusApprovedBy:
          row.ceostatusapprovedby !== null
            ? Number(row.ceostatusapprovedby)
            : null,

        Remarks:
          row.ceoremarks || null,
      },
    };

    item.Approvals = approvalFlow.map(
      (approval) => {
        const approvalData =
          statusMap[approval.ApprovalRole] || {};

        return {
          LevelNo:
            approval.LevelNo,

          ApprovalRole:
            approval.ApprovalRole,

          Status:
            approvalData.Status ||
            "Pending",

          StatusDateTime:
            approvalData.StatusDateTime ||
            null,

          StatusApprovedBy:
            approvalData.StatusApprovedBy ??
            null,

          Remarks:
            approvalData.Remarks ||
            null,
        };
      },
    );

    return item;
  });

  const byID = new Map(
    mapped.map((item) => [
      item.AMCID,
      item,
    ]),
  );

  // ============================================================
  // Attach Documents
  // ============================================================

  for (const row of documentsResult.rows) {
    const item = byID.get(
      Number(row.amcid),
    );

    if (!item) {
      continue;
    }

    item.Documents.push({
      AMCDocumentID:
        Number(row.amcdocumentid),

      AMCID:
        Number(row.amcid),

      OrganizationID:
        Number(row.organizationid),

      FileName:
        row.filename,

      FilePath:
        row.filepath,

      FileType:
        row.filetype,

      FileSize:
        row.filesize !== null
          ? Number(row.filesize)
          : null,

      CreatedDate:
        row.createddate,
    });
  }

  return mapped;
};
// ===================Get All AMC Function
const getAllAMC = async (data) => {
  try {
    // ============================================================
    // Organization
    // ============================================================

    const OrganizationID =
      Number(data.OrganizationID);

    if (
      !Number.isSafeInteger(OrganizationID) ||
      OrganizationID <= 0
    ) {
      return fail(
        "OrganizationID is required.",
        400,
      );
    }

    // ============================================================
    // Pagination
    // ============================================================

    const page =
      Number(data.page) || 1;

    const PageSize =
      Number(data.PageSize) || 10;

    if (
      !Number.isInteger(page) ||
      page <= 0
    ) {
      return fail(
        "page must be a positive integer.",
        400,
      );
    }

    if (
      !Number.isInteger(PageSize) ||
      PageSize <= 0 ||
      PageSize > 100
    ) {
      return fail(
        "PageSize must be between 1 and 100.",
        400,
      );
    }

    const offset =
      (page - 1) * PageSize;

    // ============================================================
    // Equipment
    // ============================================================

    let EquipmentID = null;

    if (
      data.EquipmentID !== undefined &&
      data.EquipmentID !== null &&
      String(data.EquipmentID).trim() !== ""
    ) {
      EquipmentID =
        Number(data.EquipmentID);

      if (
        !Number.isSafeInteger(EquipmentID) ||
        EquipmentID <= 0
      ) {
        return fail(
          "EquipmentID must be a positive integer.",
          400,
        );
      }
    }

    // ============================================================
    // Status
    // ============================================================

    const Status =
      data.Status !== undefined &&
      data.Status !== null &&
      String(data.Status).trim() !== ""
        ? String(data.Status)
            .trim()
            .toUpperCase()
        : null;

    const validStatuses = [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "RETURNED",
    ];

    if (
      Status &&
      !validStatuses.includes(Status)
    ) {
      return fail(
        "Status must be Pending, Approved, Rejected, or Returned.",
        400,
      );
    }

    // ============================================================
    // Search
    // ============================================================

    const Search =
      data.Search !== undefined &&
      data.Search !== null &&
      String(data.Search).trim() !== ""
        ? String(data.Search).trim()
        : null;

    // ============================================================
    // Logged-In User Approval Role
    // ============================================================

    const approvalRole =
      resolveAMCApprovalRole({
        OrganizationID,

        UserType:
          data.UserType,

        DepartmentName:
          data.DepartmentName,
      });

    // ============================================================
    // Base From Query
    // ============================================================

    const baseFrom = `
      FROM Engineering_AMC_Master am

      INNER JOIN Engineering_Equipment_Entry_Master e
        ON e.EquipmentID = am.EquipmentID
       AND e.IsDeleted = FALSE

      LEFT JOIN Engineering_AMC_Approval aa
        ON aa.AMCID = am.AMCID
       AND aa.IsDeleted = FALSE

      LEFT JOIN LATERAL
      (
        SELECT
          approval_flow.ApprovalRole,

          CASE
            WHEN approval_flow.ApprovalRole = 'FC'
              THEN COALESCE(
                aa.FCStatus,
                'Pending'
              )

            WHEN approval_flow.ApprovalRole = 'GM'
              THEN COALESCE(
                aa.GMStatus,
                'Pending'
              )

            WHEN approval_flow.ApprovalRole = 'RD'
              THEN COALESCE(
                aa.RDStatus,
                'Pending'
              )

            WHEN approval_flow.ApprovalRole = 'CEO'
              THEN COALESCE(
                aa.CEOStatus,
                'Pending'
              )

            ELSE 'Pending'
          END AS Status

        FROM
        (
          SELECT
            UPPER(
              TRIM(config.ApprovalRole)
            ) AS ApprovalRole,

            config.ApprovalOrder,

            config.ApprovalLevel

          FROM Engineering_AMC_Approval_Config config

          WHERE config.OrganizationID =
                am.OrganizationID

            AND config.IsDeleted = FALSE

          UNION ALL

          SELECT
            default_flow.ApprovalRole,
            default_flow.ApprovalOrder,
            default_flow.ApprovalLevel

          FROM
          (
            VALUES
              ('FC', 1, 1),
              ('GM', 2, 2),
              ('RD', 3, 3),
              ('CEO', 4, 4)
          ) AS default_flow(
            ApprovalRole,
            ApprovalOrder,
            ApprovalLevel
          )

          WHERE NOT EXISTS
          (
            SELECT 1

            FROM Engineering_AMC_Approval_Config config

            WHERE config.OrganizationID =
                  am.OrganizationID

              AND config.IsDeleted = FALSE
          )
        ) approval_flow

        WHERE UPPER(
          TRIM(
            CASE
              WHEN approval_flow.ApprovalRole = 'FC'
                THEN COALESCE(
                  aa.FCStatus,
                  'Pending'
                )

              WHEN approval_flow.ApprovalRole = 'GM'
                THEN COALESCE(
                  aa.GMStatus,
                  'Pending'
                )

              WHEN approval_flow.ApprovalRole = 'RD'
                THEN COALESCE(
                  aa.RDStatus,
                  'Pending'
                )

              WHEN approval_flow.ApprovalRole = 'CEO'
                THEN COALESCE(
                  aa.CEOStatus,
                  'Pending'
                )

              ELSE 'Pending'
            END
          )
        ) <> 'APPROVED'

        ORDER BY
          approval_flow.ApprovalOrder ASC,
          approval_flow.ApprovalLevel ASC

        LIMIT 1
      ) current_stage ON TRUE
    `;

    // ============================================================
    // Common WHERE
    // Same filters will be used in list + count
    // ============================================================

    let whereClause = `
      WHERE am.IsDeleted = FALSE
        AND am.OrganizationID = $1
    `;

    const params = [
      OrganizationID,
    ];

    // ============================================================
    // Equipment Filter
    // ============================================================

    if (EquipmentID) {
      params.push(EquipmentID);

      whereClause += `
        AND am.EquipmentID =
            $${params.length}
      `;
    }

    // ============================================================
    // Search
    // ============================================================

    if (Search) {
      params.push(Search);

      const searchParameter =
        `$${params.length}`;

      whereClause += `
        AND
        (
          COALESCE(
            am.VendorName,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            am.VendorEmailAddress,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            am.VendorMobileNumber,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            am.AMCType,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            e.Description,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            e.SerialNumber,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            e.Make,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            e.ModelNumber,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'

          OR COALESCE(
            e.Area,
            ''
          ) ILIKE '%' || ${searchParameter} || '%'
        )
      `;
    }

    // ============================================================
    // Approval Access
    // ============================================================

    const roleStatusColumns = {
      FC: "aa.FCStatus",
      GM: "aa.GMStatus",
      RD: "aa.RDStatus",
      CEO: "aa.CEOStatus",
    };

    const roleStatusColumn =
      approvalRole
        ? roleStatusColumns[approvalRole]
        : null;

    // ============================================================
    // APPROVER
    // ============================================================

    if (
      approvalRole &&
      roleStatusColumn
    ) {
      // ==========================================================
      // Pending
      //
      // Approver ko Pending me sirf wahi AMC dikhega
      // jiska current stage uska role hai.
      // ==========================================================

      if (Status === "PENDING") {
        params.push(approvalRole);

        whereClause += `
          AND UPPER(
            COALESCE(
              current_stage.ApprovalRole,
              ''
            )
          ) = $${params.length}

          AND UPPER(
            TRIM(
              COALESCE(
                current_stage.Status,
                'Pending'
              )
            )
          ) = 'PENDING'
        `;
      }

      // ==========================================================
      // Approved / Rejected / Returned
      //
      // Apne role ka historical status
      // ==========================================================

      else if (
        Status === "APPROVED" ||
        Status === "REJECTED" ||
        Status === "RETURNED"
      ) {
        params.push(Status);

        whereClause += `
          AND UPPER(
            TRIM(
              COALESCE(
                ${roleStatusColumn},
                ''
              )
            )
          ) = $${params.length}
        `;
      }

      // ==========================================================
      // No Status
      //
      // Show:
      // 1. Currently pending for logged-in approver
      // OR
      // 2. Logged-in approver already acted
      // ==========================================================

      else {
        params.push(approvalRole);

        whereClause += `
          AND
          (
            (
              UPPER(
                COALESCE(
                  current_stage.ApprovalRole,
                  ''
                )
              ) = $${params.length}

              AND UPPER(
                TRIM(
                  COALESCE(
                    current_stage.Status,
                    'Pending'
                  )
                )
              ) = 'PENDING'
            )

            OR

            UPPER(
              TRIM(
                COALESCE(
                  ${roleStatusColumn},
                  ''
                )
              )
            ) IN (
              'APPROVED',
              'REJECTED',
              'RETURNED'
            )
          )
        `;
      }
    }

    // ============================================================
    // NON APPROVER / NORMAL USER
    // ============================================================

    else if (Status) {
      // ==========================================================
      // Approved
      // ==========================================================

      if (Status === "APPROVED") {
        whereClause += `
          AND UPPER(
            TRIM(
              COALESCE(
                aa.FinalStatus,
                'Pending'
              )
            )
          ) = 'APPROVED'
        `;
      }

      // ==========================================================
      // Rejected
      // ==========================================================

      else if (Status === "REJECTED") {
        whereClause += `
          AND
          (
            UPPER(
              TRIM(
                COALESCE(
                  aa.FCStatus,
                  ''
                )
              )
            ) = 'REJECTED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.GMStatus,
                  ''
                )
              )
            ) = 'REJECTED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.RDStatus,
                  ''
                )
              )
            ) = 'REJECTED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.CEOStatus,
                  ''
                )
              )
            ) = 'REJECTED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.FinalStatus,
                  ''
                )
              )
            ) = 'REJECTED'
          )
        `;
      }

      // ==========================================================
      // Returned
      // ==========================================================

      else if (Status === "RETURNED") {
        whereClause += `
          AND
          (
            UPPER(
              TRIM(
                COALESCE(
                  aa.FCStatus,
                  ''
                )
              )
            ) = 'RETURNED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.GMStatus,
                  ''
                )
              )
            ) = 'RETURNED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.RDStatus,
                  ''
                )
              )
            ) = 'RETURNED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.CEOStatus,
                  ''
                )
              )
            ) = 'RETURNED'

            OR UPPER(
              TRIM(
                COALESCE(
                  aa.FinalStatus,
                  ''
                )
              )
            ) = 'RETURNED'
          )
        `;
      }

      // ==========================================================
      // Pending
      // ==========================================================

      else if (Status === "PENDING") {
        whereClause += `
          AND current_stage.ApprovalRole IS NOT NULL

          AND UPPER(
            TRIM(
              COALESCE(
                current_stage.Status,
                'Pending'
              )
            )
          ) = 'PENDING'

          AND UPPER(
            TRIM(
              COALESCE(
                aa.FinalStatus,
                'Pending'
              )
            )
          ) <> 'APPROVED'

          AND UPPER(
            TRIM(
              COALESCE(
                aa.FCStatus,
                ''
              )
            )
          ) NOT IN (
            'REJECTED',
            'RETURNED'
          )

          AND UPPER(
            TRIM(
              COALESCE(
                aa.GMStatus,
                ''
              )
            )
          ) NOT IN (
            'REJECTED',
            'RETURNED'
          )

          AND UPPER(
            TRIM(
              COALESCE(
                aa.RDStatus,
                ''
              )
            )
          ) NOT IN (
            'REJECTED',
            'RETURNED'
          )

          AND UPPER(
            TRIM(
              COALESCE(
                aa.CEOStatus,
                ''
              )
            )
          ) NOT IN (
            'REJECTED',
            'RETURNED'
          )
        `;
      }
    }

    // ============================================================
    // Count Query
    // ============================================================

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::bigint AS TotalCount

        ${baseFrom}

        ${whereClause};
        `,
        params,
      );

    const TotalCount =
      Number(
        countResult.rows[0]
          ?.totalcount || 0,
      );

    // ============================================================
    // List Query
    // ============================================================

    const listParams = [
      ...params,
      PageSize,
      offset,
    ];

    const limitIndex =
      params.length + 1;

    const offsetIndex =
      params.length + 2;

    const result =
      await pool.query(
        `
        SELECT
          am.AMCID,
          am.OrganizationID,
          am.EquipmentID,

          am.AMCStartDate,
          am.AMCEndDate,
          am.AMCType,
          am.AMCAmount,

          am.VendorName,
          am.VendorEmailAddress,
          am.VendorMobileNumber,
          am.VendorSecondMobileNumber,
          am.VendorLandlineNumber,
          am.VendorAddress,
          am.VendorCity,
          am.VendorState,
          am.VendorPincode,

          am.CreatedBy,
          am.CreatedDate,
          am.ModifiedBy,
          am.ModifiedDate,

          e.Description,
          e.SerialNumber,
          e.TypeOfMachine,
          e.Capacity,
          e.ModelNumber,
          e.Make,
          e.Area,

          e.CommissioningDate,

          e.WarrantyStartDate,
          e.WarrantyEndDate,
          e.WarrantyStatus,

          e.ScheduleOfServicing,
          e.ScheduleDay,

          e.ResponsiblePerson,

          aa.FCStatus,
          aa.FCStatusDateTime,
          aa.FCStatusApprovedBy,
          aa.FCRemarks,

          aa.GMStatus,
          aa.GMStatusDateTime,
          aa.GMStatusApprovedBy,
          aa.GMRemarks,

          aa.RDStatus,
          aa.RDStatusDateTime,
          aa.RDStatusApprovedBy,
          aa.RDRemarks,

          aa.CEOStatus,
          aa.CEOStatusDateTime,
          aa.CEOStatusApprovedBy,
          aa.CEORemarks,

          COALESCE(
            aa.FinalStatus,
            'Pending'
          ) AS FinalStatus,

          aa.FinalStatusDateTime,

          CASE
            WHEN UPPER(
              TRIM(
                COALESCE(
                  aa.FinalStatus,
                  'Pending'
                )
              )
            ) = 'APPROVED'
            THEN NULL

            ELSE
              current_stage.ApprovalRole
          END AS CurrentApprovalRole,

          CASE
            WHEN UPPER(
              TRIM(
                COALESCE(
                  aa.FinalStatus,
                  'Pending'
                )
              )
            ) = 'APPROVED'
            THEN 'Approved'

            ELSE COALESCE(
              current_stage.Status,
              aa.FinalStatus,
              'Pending'
            )
          END AS CurrentStatus

        ${baseFrom}

        ${whereClause}

        ORDER BY
          am.CreatedDate DESC,
          am.AMCID DESC

        LIMIT $${limitIndex}
        OFFSET $${offsetIndex};
        `,
        listParams,
      );

    // ============================================================
    // Attach Documents + Approvals
    // ============================================================

    const records =
      await attachAMCRelatedData(
        result.rows,
        OrganizationID,
      );

    // ============================================================
    // Pagination
    // ============================================================

    const TotalPages =
      TotalCount > 0
        ? Math.ceil(
            TotalCount / PageSize,
          )
        : 0;

    // ============================================================
    // Response
    // ============================================================

    return ok(
      "AMC records fetched successfully.",
      {
        TotalCount,

        PageCount:
          records.length,

        CurrentPage:
          page,

        PageSize,

        TotalPages,

        data:
          records,
      },
    );
  } catch (error) {
    console.error(
      "Get All AMC Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return databaseFailure(
      "Unable to fetch AMC records at this time.",
    );
  }
};
// ============================================================Get AMC by ID
const getAMCById = async (data) => {
  try {
    // ============================================================
    // Validate AMC ID
    // ============================================================

    const AMCID = Number(data.AMCID);

    if (
      !Number.isSafeInteger(AMCID) ||
      AMCID <= 0
    ) {
      return fail(
        "Valid AMCID is required.",
        400,
      );
    }

    // ============================================================
    // Query
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        am.AMCID,
        am.OrganizationID,
        am.EquipmentID,

        am.AMCStartDate,
        am.AMCEndDate,
        am.AMCType,
        am.AMCAmount,

        am.VendorName,
        am.VendorEmailAddress,
        am.VendorMobileNumber,
        am.VendorSecondMobileNumber,
        am.VendorLandlineNumber,
        am.VendorAddress,
        am.VendorCity,
        am.VendorState,
        am.VendorPincode,

        am.CreatedBy,
        am.CreatedDate,
        am.ModifiedBy,
        am.ModifiedDate,

        -- ========================================================
        -- Equipment
        -- ========================================================

        e.DepartmentID,
        e.Description,
        e.SerialNumber,
        e.TypeOfMachine,
        e.Capacity,
        e.ModelNumber,
        e.Make,
        e.Area,
        e.CommissioningDate,

        e.WarrantyStartDate,
        e.WarrantyEndDate,
        e.WarrantyStatus,

        e.AMCType AS EquipmentAMCType,
        e.AMCStartDate AS EquipmentAMCStartDate,
        e.AMCEndDate AS EquipmentAMCEndDate,
        e.AMCStatus AS EquipmentAMCStatus,
        e.AMCYearlyExpense,

        e.ScheduleOfServicing,
        e.ScheduleDay,
        e.ResponsiblePerson,

        -- ========================================================
        -- Approval
        -- ========================================================

        aa.FCStatus,
        aa.FCStatusDateTime,
        aa.FCStatusApprovedBy,
        aa.FCRemarks,

        aa.GMStatus,
        aa.GMStatusDateTime,
        aa.GMStatusApprovedBy,
        aa.GMRemarks,

        aa.RDStatus,
        aa.RDStatusDateTime,
        aa.RDStatusApprovedBy,
        aa.RDRemarks,

        aa.CEOStatus,
        aa.CEOStatusDateTime,
        aa.CEOStatusApprovedBy,
        aa.CEORemarks,

        COALESCE(
          aa.FinalStatus,
          'Pending'
        ) AS FinalStatus,

        aa.FinalStatusDateTime,

        -- ========================================================
        -- Current Approval Role
        -- ========================================================

        CASE
          WHEN UPPER(
            TRIM(
              COALESCE(
                aa.FinalStatus,
                'Pending'
              )
            )
          ) = 'APPROVED'
          THEN NULL

          ELSE current_stage.ApprovalRole
        END AS CurrentApprovalRole,

        -- ========================================================
        -- Current Status
        -- ========================================================

        CASE
          WHEN UPPER(
            TRIM(
              COALESCE(
                aa.FinalStatus,
                'Pending'
              )
            )
          ) = 'APPROVED'
          THEN 'Approved'

          ELSE COALESCE(
            current_stage.Status,
            aa.FinalStatus,
            'Pending'
          )
        END AS CurrentStatus

      FROM Engineering_AMC_Master am

      INNER JOIN Engineering_Equipment_Entry_Master e
        ON e.EquipmentID = am.EquipmentID
       AND e.IsDeleted = FALSE

      LEFT JOIN Engineering_AMC_Approval aa
        ON aa.AMCID = am.AMCID
       AND aa.IsDeleted = FALSE

      -- ==========================================================
      -- Current Approval Stage
      -- ==========================================================

      LEFT JOIN LATERAL
      (
        SELECT
          approval_flow.ApprovalRole,

          CASE
            WHEN approval_flow.ApprovalRole = 'FC'
              THEN COALESCE(
                aa.FCStatus,
                'Pending'
              )

            WHEN approval_flow.ApprovalRole = 'GM'
              THEN COALESCE(
                aa.GMStatus,
                'Pending'
              )

            WHEN approval_flow.ApprovalRole = 'RD'
              THEN COALESCE(
                aa.RDStatus,
                'Pending'
              )

            WHEN approval_flow.ApprovalRole = 'CEO'
              THEN COALESCE(
                aa.CEOStatus,
                'Pending'
              )

            ELSE 'Pending'
          END AS Status

        FROM
        (
          -- ======================================================
          -- Organization Approval Config
          -- ======================================================

          SELECT
            UPPER(
              TRIM(config.ApprovalRole)
            ) AS ApprovalRole,

            config.ApprovalOrder,
            config.ApprovalLevel

          FROM Engineering_AMC_Approval_Config config

          WHERE config.OrganizationID =
                am.OrganizationID

            AND config.IsDeleted = FALSE

          UNION ALL

          -- ======================================================
          -- Default FC -> GM -> RD -> CEO
          -- ======================================================

          SELECT
            default_flow.ApprovalRole,
            default_flow.ApprovalOrder,
            default_flow.ApprovalLevel

          FROM
          (
            VALUES
              ('FC', 1, 1),
              ('GM', 2, 2),
              ('RD', 3, 3),
              ('CEO', 4, 4)
          ) AS default_flow(
            ApprovalRole,
            ApprovalOrder,
            ApprovalLevel
          )

          WHERE NOT EXISTS
          (
            SELECT 1

            FROM Engineering_AMC_Approval_Config config

            WHERE config.OrganizationID =
                  am.OrganizationID

              AND config.IsDeleted = FALSE
          )

        ) approval_flow

        WHERE UPPER(
          TRIM(
            CASE
              WHEN approval_flow.ApprovalRole = 'FC'
                THEN COALESCE(
                  aa.FCStatus,
                  'Pending'
                )

              WHEN approval_flow.ApprovalRole = 'GM'
                THEN COALESCE(
                  aa.GMStatus,
                  'Pending'
                )

              WHEN approval_flow.ApprovalRole = 'RD'
                THEN COALESCE(
                  aa.RDStatus,
                  'Pending'
                )

              WHEN approval_flow.ApprovalRole = 'CEO'
                THEN COALESCE(
                  aa.CEOStatus,
                  'Pending'
                )

              ELSE 'Pending'
            END
          )
        ) <> 'APPROVED'

        ORDER BY
          approval_flow.ApprovalOrder ASC,
          approval_flow.ApprovalLevel ASC

        LIMIT 1

      ) current_stage ON TRUE

      WHERE am.AMCID = $1
        AND am.IsDeleted = FALSE

      LIMIT 1;
      `,
      [AMCID],
    );

    // ============================================================
    // Not Found
    // ============================================================

    if (result.rows.length === 0) {
      return fail(
        "AMC record not found.",
        404,
      );
    }

    const row = result.rows[0];
    const OrganizationID = Number(row.organizationid);
    const approvalRole = resolveAMCApprovalRole({
      OrganizationID,
      UserType: data.UserType,
      DepartmentName: data.DepartmentName,
    });

    // ============================================================
    // Approval Access Check
    // ============================================================

    const currentApprovalRole =
      row.currentapprovalrole
        ? String(
            row.currentapprovalrole,
          )
            .trim()
            .toUpperCase()
        : null;

    const roleStatusMap = {
      FC:
        row.fcstatus,

      GM:
        row.gmstatus,

      RD:
        row.rdstatus,

      CEO:
        row.ceostatus,
    };

    // ============================================================
    // If logged-in user is an approver:
    //
    // Allow when:
    // 1. AMC is currently at user's stage
    // OR
    // 2. User has already acted on AMC
    // ============================================================

    if (approvalRole) {
      const ownStatus = String(
        roleStatusMap[approvalRole] || "Pending",
      )
        .trim()
        .toUpperCase();

      const hasAlreadyActed = [
        "APPROVED",
        "REJECTED",
        "RETURNED",
      ].includes(ownStatus);

      const isCurrentStage =
        currentApprovalRole ===
        approvalRole;

      if (
        !isCurrentStage &&
        !hasAlreadyActed
      ) {
        return fail(
          "You are not authorized to view this AMC at the current approval stage.",
          403,
        );
      }
    }

    // ============================================================
    // Attach Documents + Approvals
    // ============================================================

    const records =
      await attachAMCRelatedData(
        result.rows,
        OrganizationID,
      );

    const AMC =
      records[0];

    // ============================================================
    // Extra Equipment Detail Fields
    // mapAMC does not currently map these fields
    // ============================================================

    AMC.DepartmentID =
      row.departmentid !== null
        ? Number(row.departmentid)
        : null;

    AMC.EquipmentAMCType =
      row.equipmentamctype;

    AMC.EquipmentAMCStartDate =
      formatDate(
        row.equipmentamcstartdate,
      );

    AMC.EquipmentAMCEndDate =
      formatDate(
        row.equipmentamcenddate,
      );

    AMC.EquipmentAMCStatus =
      row.equipmentamcstatus;

    AMC.AMCYearlyExpense =
      row.amcyearlyexpense !== null
        ? Number(
            row.amcyearlyexpense,
          )
        : null;

    // ============================================================
    // Logged-In User Approval Information
    // Useful for frontend Approve / Reject / Return buttons
    // ============================================================

    AMC.LoggedInApprovalRole =
      approvalRole;

    AMC.CanTakeApprovalAction =
      Boolean(
        approvalRole &&
        currentApprovalRole ===
          approvalRole &&
        String(
          row.currentstatus || "",
        )
          .trim()
          .toUpperCase() ===
          "PENDING",
      );

    // ============================================================
    // Response
    // ============================================================

    return ok(
      "AMC record fetched successfully.",
      AMC,
    );
  } catch (error) {
    console.error(
      "Get AMC By ID Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return databaseFailure(
      "Unable to fetch AMC record at this time.",
    );
  }
};
// ============================================================Update AMC
const updateAMC = async (data) => {
  const client = await pool.connect();

  try {
    const AMCID = Number(data.AMCID);
    const OrganizationID = Number(data.OrganizationID);
    const UserID = Number(data.UserID);

    if (!Number.isSafeInteger(AMCID) || AMCID <= 0) {
      return fail("Valid AMCID is required.", 400);
    }

    if (
      !Number.isSafeInteger(OrganizationID) ||
      OrganizationID <= 0
    ) {
      return fail("OrganizationID is required.", 400);
    }

    if (!Number.isSafeInteger(UserID) || UserID <= 0) {
      return fail("Valid UserID is required.", 400);
    }

    const Changes =
      data.Changes &&
      typeof data.Changes === "object" &&
      !Array.isArray(data.Changes)
        ? data.Changes
        : {};

    const Documents = Array.isArray(data.Documents)
      ? data.Documents
      : [];

    const DeleteDocumentIDs = Array.isArray(
      data.DeleteDocumentIDs,
    )
      ? data.DeleteDocumentIDs
      : [];

    await client.query("BEGIN");

    // ============================================================
    // Lock Existing AMC
    // ============================================================

    const existingResult = await client.query(
      `
      SELECT
        AMCID,
        OrganizationID,
        EquipmentID,
        AMCStartDate,
        AMCEndDate,
        AMCType,
        AMCAmount,

        VendorName,
        VendorEmailAddress,
        VendorMobileNumber,
        VendorSecondMobileNumber,
        VendorLandlineNumber,
        VendorAddress,
        VendorCity,
        VendorState,
        VendorPincode

      FROM Engineering_AMC_Master

      WHERE AMCID = $1
        AND OrganizationID = $2
        AND IsDeleted = FALSE

      FOR UPDATE;
      `,
      [AMCID, OrganizationID],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return fail(
        "AMC record not found.",
        404,
      );
    }

    const existing =
      existingResult.rows[0];

    // ============================================================
    // Allowed Update Fields
    // ============================================================

    const allowedFields = new Set([
      "EquipmentID",
      "AMCStartDate",
      "AMCEndDate",
      "AMCType",
      "AMCAmount",

      "VendorName",
      "VendorEmailAddress",
      "VendorMobileNumber",
      "VendorSecondMobileNumber",
      "VendorLandlineNumber",
      "VendorAddress",
      "VendorCity",
      "VendorState",
      "VendorPincode",
    ]);

    const cleanChanges = {};

    for (const [key, value] of Object.entries(
      Changes,
    )) {
      if (!allowedFields.has(key)) {
        continue;
      }

      cleanChanges[key] = value;
    }

    // ============================================================
    // Equipment Validation
    // ============================================================

    const finalEquipmentID =
      cleanChanges.EquipmentID !== undefined
        ? Number(cleanChanges.EquipmentID)
        : Number(existing.equipmentid);

    if (
      !Number.isSafeInteger(finalEquipmentID) ||
      finalEquipmentID <= 0
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Valid EquipmentID is required.",
        400,
      );
    }

    const equipmentResult = await client.query(
      `
      SELECT EquipmentID
      FROM Engineering_Equipment_Entry_Master
      WHERE EquipmentID = $1
        AND OrganizationID = $2
        AND IsDeleted = FALSE
      LIMIT 1;
      `,
      [
        finalEquipmentID,
        OrganizationID,
      ],
    );

    if (equipmentResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return fail(
        "Equipment not found for selected organization.",
        404,
      );
    }

    // ============================================================
    // Date Validation
    // ============================================================

    const finalAMCStartDate =
      cleanChanges.AMCStartDate !== undefined
        ? cleanChanges.AMCStartDate || null
        : existing.amcstartdate;

    const finalAMCEndDate =
      cleanChanges.AMCEndDate !== undefined
        ? cleanChanges.AMCEndDate || null
        : existing.amcenddate;

    if (
      finalAMCStartDate &&
      finalAMCEndDate &&
      new Date(finalAMCStartDate) >
        new Date(finalAMCEndDate)
    ) {
      await client.query("ROLLBACK");

      return fail(
        "AMCStartDate cannot be greater than AMCEndDate.",
        400,
      );
    }

    // ============================================================
    // Normalize Fields
    // ============================================================

    if (
      cleanChanges.AMCAmount !== undefined
    ) {
      if (
        cleanChanges.AMCAmount === "" ||
        cleanChanges.AMCAmount === null
      ) {
        cleanChanges.AMCAmount = null;
      } else {
        const amount = Number(
          cleanChanges.AMCAmount,
        );

        if (
          !Number.isFinite(amount) ||
          amount < 0
        ) {
          await client.query("ROLLBACK");

          return fail(
            "AMCAmount must be a valid non-negative number.",
            400,
          );
        }

        cleanChanges.AMCAmount = amount;
      }
    }

    if (
      cleanChanges.EquipmentID !== undefined
    ) {
      cleanChanges.EquipmentID =
        finalEquipmentID;
    }

    if (
      cleanChanges.AMCStartDate !== undefined
    ) {
      cleanChanges.AMCStartDate =
        cleanChanges.AMCStartDate || null;
    }

    if (
      cleanChanges.AMCEndDate !== undefined
    ) {
      cleanChanges.AMCEndDate =
        cleanChanges.AMCEndDate || null;
    }

    // ============================================================
    // Update AMC Master
    // ============================================================

    const updateFields = [];
    const updateValues = [];

    for (const [field, value] of Object.entries(
      cleanChanges,
    )) {
      updateValues.push(value);

      updateFields.push(
        `${field} = $${updateValues.length}`,
      );
    }

    if (updateFields.length > 0) {
      updateValues.push(UserID);

      updateFields.push(
        `ModifiedBy = $${updateValues.length}`,
      );

      updateFields.push(
        `ModifiedDate = CURRENT_TIMESTAMP`,
      );

      updateValues.push(AMCID);

      const amcIDIndex =
        updateValues.length;

      updateValues.push(OrganizationID);

      const organizationIndex =
        updateValues.length;

      await client.query(
        `
        UPDATE Engineering_AMC_Master
        SET
          ${updateFields.join(", ")}

        WHERE AMCID = $${amcIDIndex}
          AND OrganizationID = $${organizationIndex}
          AND IsDeleted = FALSE;
        `,
        updateValues,
      );
    }

    // ============================================================
    // Delete Selected Documents
    // ============================================================

    const validDeleteDocumentIDs =
      DeleteDocumentIDs
        .map(Number)
        .filter(
          (id) =>
            Number.isSafeInteger(id) &&
            id > 0,
        );

    if (
      validDeleteDocumentIDs.length > 0
    ) {
      await client.query(
        `
        UPDATE Engineering_AMC_Documents
        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP
        WHERE AMCID = $2
          AND OrganizationID = $3
          AND AMCDocumentID =
              ANY($4::bigint[])
          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          AMCID,
          OrganizationID,
          validDeleteDocumentIDs,
        ],
      );
    }

    // ============================================================
    // Insert New Documents
    // ============================================================

    for (const document of Documents) {
      if (
        !document ||
        !document.FileName ||
        !document.FilePath
      ) {
        continue;
      }

      await client.query(
        `
        INSERT INTO Engineering_AMC_Documents
        (
          AMCID,
          OrganizationID,
          FileName,
          FilePath,
          FileType,
          FileSize,
          CreatedBy
        )
        VALUES
        (
          $1, $2, $3, $4, $5, $6, $7
        );
        `,
        [
          AMCID,
          OrganizationID,
          document.FileName,
          document.FilePath,
          document.FileType || null,
          document.FileSize !== undefined &&
          document.FileSize !== null
            ? Number(document.FileSize)
            : null,
          UserID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok(
      "AMC updated successfully.",
     
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error(
      "Update AMC Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return databaseFailure(
      "Unable to update AMC at this time.",
    );
  } finally {
    client.release();
  }
};
// ============================================================Delete AMC
const deleteAMC = async (data) => {
  const client = await pool.connect();

  try {
    const AMCID = Number(data.AMCID);
    const UserID = Number(data.UserID);

    if (
      !Number.isSafeInteger(AMCID) ||
      AMCID <= 0
    ) {
      return fail("Valid AMCID is required.", 400);
    }

    if (
      !Number.isSafeInteger(UserID) ||
      UserID <= 0
    ) {
      return fail("Valid UserID is required.", 400);
    }

    await client.query("BEGIN");

    // ============================================================
    // Get AMC + OrganizationID
    // ============================================================

    const existingResult = await client.query(
      `
      SELECT
        AMCID,
        OrganizationID
      FROM Engineering_AMC_Master
      WHERE AMCID = $1
        AND IsDeleted = FALSE
      FOR UPDATE;
      `,
      [AMCID],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return fail("AMC record not found.", 404);
    }

    const OrganizationID = Number(
      existingResult.rows[0].organizationid,
    );

    // ============================================================
    // Delete AMC Master
    // ============================================================

    await client.query(
      `
      UPDATE Engineering_AMC_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE AMCID = $2
        AND IsDeleted = FALSE;
      `,
      [UserID, AMCID],
    );

    // ============================================================
    // Delete Documents
    // ============================================================

    await client.query(
      `
      UPDATE Engineering_AMC_Documents
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE AMCID = $2
        AND OrganizationID = $3
        AND IsDeleted = FALSE;
      `,
      [
        UserID,
        AMCID,
        OrganizationID,
      ],
    );

    // ============================================================
    // Delete Approval
    // ============================================================

    await client.query(
      `
      UPDATE Engineering_AMC_Approval
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE AMCID = $2
        AND IsDeleted = FALSE;
      `,
      [UserID, AMCID],
    );

    await client.query("COMMIT");

    return ok(
      "AMC deleted successfully.",
      {
        AMCID,
      },
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error(
      "Delete AMC Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return databaseFailure(
      "Unable to delete AMC at this time.",
    );
  } finally {
    client.release();
  }
};
// ============================================================Approve AMC
const processAMCApproval = async (data) => {
  const client = await pool.connect();

  try {
    const AMCID = Number(data.AMCID);
    const UserID = Number(data.UserID);

    const Action = String(data.Action || "")
      .trim()
      .toUpperCase();

    const Remarks =
      data.Remarks !== undefined &&
      data.Remarks !== null
        ? String(data.Remarks).trim()
        : null;

    // ============================================================
    // Validation
    // ============================================================

    if (
      !Number.isSafeInteger(AMCID) ||
      AMCID <= 0
    ) {
      return fail(
        "Valid AMCID is required.",
        400,
      );
    }

    if (
      !Number.isSafeInteger(UserID) ||
      UserID <= 0
    ) {
      return fail(
        "Valid UserID is required.",
        400,
      );
    }

    const validActions = [
      "APPROVE",
      "REJECT",
      "RETURN",
    ];

    if (!validActions.includes(Action)) {
      return fail(
        "Action must be APPROVE, REJECT, or RETURN.",
        400,
      );
    }

    if (
      ["REJECT", "RETURN"].includes(Action) &&
      !Remarks
    ) {
      return fail(
        `Remarks are required for ${Action}.`,
        400,
      );
    }

    await client.query("BEGIN");

    // ============================================================
    // Get AMC + lock
    // ============================================================

    const amcResult = await client.query(
      `
      SELECT
        AMCID,
        OrganizationID,
        EquipmentID
      FROM Engineering_AMC_Master
      WHERE AMCID = $1
        AND IsDeleted = FALSE
      FOR UPDATE;
      `,
      [AMCID],
    );

    if (amcResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return fail(
        "AMC record not found.",
        404,
      );
    }

    const OrganizationID = Number(
      amcResult.rows[0].organizationid,
    );

    // ============================================================
    // Resolve logged-in user's AMC approval role
    // ============================================================

    const approvalRole =
      resolveAMCApprovalRole({
        OrganizationID,
        UserType: data.UserType,
        DepartmentName:
          data.DepartmentName,
      });

    if (!approvalRole) {
      await client.query("ROLLBACK");

      return fail(
        "You are not authorized to approve AMC.",
        403,
      );
    }

    // ============================================================
    // Get approval row + lock
    // ============================================================

    const approvalResult =
      await client.query(
        `
        SELECT
          AMCApprovalID,
          AMCID,

          FCStatus,
          FCStatusDateTime,
          FCStatusApprovedBy,
          FCRemarks,

          GMStatus,
          GMStatusDateTime,
          GMStatusApprovedBy,
          GMRemarks,

          RDStatus,
          RDStatusDateTime,
          RDStatusApprovedBy,
          RDRemarks,

          CEOStatus,
          CEOStatusDateTime,
          CEOStatusApprovedBy,
          CEORemarks,

          FinalStatus,
          FinalStatusDateTime

        FROM Engineering_AMC_Approval

        WHERE AMCID = $1
          AND IsDeleted = FALSE

        FOR UPDATE;
        `,
        [AMCID],
      );

    if (approvalResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return fail(
        "AMC approval record not found.",
        404,
      );
    }

    const approval =
      approvalResult.rows[0];

    // ============================================================
    // Already Final Approved
    // ============================================================

    if (
      String(
        approval.finalstatus || "",
      )
        .trim()
        .toUpperCase() === "APPROVED"
    ) {
      await client.query("ROLLBACK");

      return fail(
        "AMC is already fully approved.",
        400,
      );
    }

    // ============================================================
    // Get Organization Approval Flow
    // Config exists -> config
    // otherwise DEFAULT_AMC_APPROVALS
    // ============================================================

    const approvalFlow =
      await getAMCApprovalFlow(
        OrganizationID,
        client,
      );

    if (!approvalFlow.length) {
      await client.query("ROLLBACK");

      return fail(
        "AMC approval flow is not configured.",
        400,
      );
    }

    // ============================================================
    // Status helper
    // ============================================================

    const getRoleStatus = (role) => {
      switch (
        String(role || "")
          .trim()
          .toUpperCase()
      ) {
        case "FC":
          return approval.fcstatus || "Pending";

        case "GM":
          return approval.gmstatus || "Pending";

        case "RD":
          return approval.rdstatus || "Pending";

        case "CEO":
          return approval.ceostatus || "Pending";

        default:
          return "Pending";
      }
    };

    // ============================================================
    // Find current approval stage
    //
    // First role which is NOT Approved
    // ============================================================

    const currentStage =
      approvalFlow.find((item) => {
        const status = String(
          getRoleStatus(
            item.ApprovalRole,
          ),
        )
          .trim()
          .toUpperCase();

        return status !== "APPROVED";
      });

    if (!currentStage) {
      await client.query("ROLLBACK");

      return fail(
        "No pending approval stage found.",
        400,
      );
    }

    const currentApprovalRole =
      String(
        currentStage.ApprovalRole || "",
      )
        .trim()
        .toUpperCase();

    // ============================================================
    // Only current stage can take action
    // ============================================================

    if (
      currentApprovalRole !==
      approvalRole
    ) {
      await client.query("ROLLBACK");

      return fail(
        `AMC is currently pending for ${currentApprovalRole} approval.`,
        403,
      );
    }

    // ============================================================
    // Current role status should be Pending
    // ============================================================

    const currentRoleStatus =
      String(
        getRoleStatus(
          approvalRole,
        ),
      )
        .trim()
        .toUpperCase();

    if (
      currentRoleStatus !== "PENDING"
    ) {
      await client.query("ROLLBACK");

      return fail(
        `${approvalRole} has already taken action on this AMC.`,
        400,
      );
    }

    // ============================================================
    // Database column map
    // Safe fixed mapping
    // ============================================================

    const roleColumns = {
      FC: {
        Status: "FCStatus",
        DateTime:
          "FCStatusDateTime",
        ApprovedBy:
          "FCStatusApprovedBy",
        Remarks:
          "FCRemarks",
      },

      GM: {
        Status: "GMStatus",
        DateTime:
          "GMStatusDateTime",
        ApprovedBy:
          "GMStatusApprovedBy",
        Remarks:
          "GMRemarks",
      },

      RD: {
        Status: "RDStatus",
        DateTime:
          "RDStatusDateTime",
        ApprovedBy:
          "RDStatusApprovedBy",
        Remarks:
          "RDRemarks",
      },

      CEO: {
        Status: "CEOStatus",
        DateTime:
          "CEOStatusDateTime",
        ApprovedBy:
          "CEOStatusApprovedBy",
        Remarks:
          "CEORemarks",
      },
    };

    const columns =
      roleColumns[approvalRole];

    if (!columns) {
      await client.query("ROLLBACK");

      return fail(
        "Invalid AMC approval role.",
        400,
      );
    }

    // ============================================================
    // Convert Action -> Stored Status
    // ============================================================

    const statusMap = {
      APPROVE: "Approved",
      REJECT: "Rejected",
      RETURN: "Returned",
    };

    const newStatus =
      statusMap[Action];

    // ============================================================
    // Find whether current stage is final stage
    // ============================================================

    const currentIndex =
      approvalFlow.findIndex(
        (item) =>
          String(
            item.ApprovalRole || "",
          )
            .trim()
            .toUpperCase() ===
          approvalRole,
      );

    const isFinalStage =
      currentIndex ===
      approvalFlow.length - 1;

    // ============================================================
    // APPROVE
    // ============================================================

    if (Action === "APPROVE") {
      // Final approver approved
      if (isFinalStage) {
        await client.query(
          `
          UPDATE Engineering_AMC_Approval
          SET
            ${columns.Status} = $1,
            ${columns.DateTime} =
              CURRENT_TIMESTAMP,
            ${columns.ApprovedBy} = $2,
            ${columns.Remarks} = $3,

            FinalStatus = 'Approved',
            FinalStatusDateTime =
              CURRENT_TIMESTAMP,

            ModifiedBy = $2,
            ModifiedDate =
              CURRENT_TIMESTAMP

          WHERE AMCID = $4
            AND IsDeleted = FALSE;
          `,
          [
            newStatus,
            UserID,
            Remarks,
            AMCID,
          ],
        );
      }

      // Intermediate approval
      else {
        await client.query(
          `
          UPDATE Engineering_AMC_Approval
          SET
            ${columns.Status} = $1,
            ${columns.DateTime} =
              CURRENT_TIMESTAMP,
            ${columns.ApprovedBy} = $2,
            ${columns.Remarks} = $3,

            FinalStatus = 'Pending',
            FinalStatusDateTime = NULL,

            ModifiedBy = $2,
            ModifiedDate =
              CURRENT_TIMESTAMP

          WHERE AMCID = $4
            AND IsDeleted = FALSE;
          `,
          [
            newStatus,
            UserID,
            Remarks,
            AMCID,
          ],
        );
      }
    }

    // ============================================================
    // REJECT
    // ============================================================

    else if (Action === "REJECT") {
      await client.query(
        `
        UPDATE Engineering_AMC_Approval
        SET
          ${columns.Status} = 'Rejected',
          ${columns.DateTime} =
            CURRENT_TIMESTAMP,
          ${columns.ApprovedBy} = $1,
          ${columns.Remarks} = $2,

          FinalStatus = 'Rejected',
          FinalStatusDateTime =
            CURRENT_TIMESTAMP,

          ModifiedBy = $1,
          ModifiedDate =
            CURRENT_TIMESTAMP

        WHERE AMCID = $3
          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          Remarks,
          AMCID,
        ],
      );
    }

    // ============================================================
    // RETURN
    // ============================================================

    else if (Action === "RETURN") {
      await client.query(
        `
        UPDATE Engineering_AMC_Approval
        SET
          ${columns.Status} = 'Returned',
          ${columns.DateTime} =
            CURRENT_TIMESTAMP,
          ${columns.ApprovedBy} = $1,
          ${columns.Remarks} = $2,

          FinalStatus = 'Returned',
          FinalStatusDateTime =
            CURRENT_TIMESTAMP,

          ModifiedBy = $1,
          ModifiedDate =
            CURRENT_TIMESTAMP

        WHERE AMCID = $3
          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          Remarks,
          AMCID,
        ],
      );
    }

    await client.query("COMMIT");

    return ok(
      `AMC ${newStatus.toLowerCase()} successfully.`
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error(
      "AMC Approval Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return databaseFailure(
      "Unable to process AMC approval at this time.",
    );
  } finally {
    client.release();
  }
};
// ============================================================Create AMC Approval Config
const createAMCApprovalConfig = async (data) => {
  let client;
  let transactionStarted = false;

  try {
    

    const OrganizationID = Number(data.OrganizationID);

    const approvals = Array.isArray(data.Approvals)
      ? data.Approvals
      : [];

    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !Number.isInteger(OrganizationID) ||
      OrganizationID <= 0
    ) {
      return fail(
        "OrganizationID is required.",
        400,
      );
    }

    if (approvals.length === 0) {
      return fail(
        "At least one approval configuration is required.",
        400,
      );
    }

    // ============================================================
    // NORMALIZE
    // ============================================================

    const normalizedApprovals = approvals.map(
      (approval) => ({
        ApprovalLevel: Number(
          approval.ApprovalLevel,
        ),

        ApprovalRole: String(
          approval.ApprovalRole || "",
        )
          .trim()
          .toUpperCase(),

        ApprovalOrder: Number(
          approval.ApprovalOrder,
        ),

        // Backend se automatic TRUE
        IsMandatory: true,
      }),
    );

    // ============================================================
    // DUPLICATE CHECK
    // ============================================================

    const levels = new Set();
    const roles = new Set();
    const orders = new Set();

    for (const approval of normalizedApprovals) {
      const {
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
      } = approval;

      if (
        !Number.isInteger(ApprovalLevel) ||
        ApprovalLevel < 1
      ) {
        return fail(
          "ApprovalLevel must be a positive integer.",
          400,
        );
      }

      if (
        !Number.isInteger(ApprovalOrder) ||
        ApprovalOrder < 1
      ) {
        return fail(
          "ApprovalOrder must be a positive integer.",
          400,
        );
      }

      if (
        !AMC_APPROVAL_ROLES.has(
          ApprovalRole,
        )
      ) {
        return fail(
          "ApprovalRole must be FC, GM, RD, or CEO.",
          400,
        );
      }

      if (levels.has(ApprovalLevel)) {
        return fail(
          `Approval level ${ApprovalLevel} is duplicated in request.`,
          409,
        );
      }

      if (roles.has(ApprovalRole)) {
        return fail(
          `${ApprovalRole} approval stage is duplicated in request.`,
          409,
        );
      }

      if (orders.has(ApprovalOrder)) {
        return fail(
          `Approval order ${ApprovalOrder} is duplicated in request.`,
          409,
        );
      }

      levels.add(ApprovalLevel);
      roles.add(ApprovalRole);
      orders.add(ApprovalOrder);
    }

    // ============================================================
    // TRANSACTION
    // ============================================================

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // ============================================================
    // GET EXISTING CONFIG
    // Active + Soft Deleted
    // ============================================================

    const existingResult = await client.query(
      `
      SELECT
        AMCApprovalConfigID AS "AMCApprovalConfigID",
        OrganizationID AS "OrganizationID",
        ApprovalLevel AS "ApprovalLevel",
        ApprovalRole AS "ApprovalRole",
        ApprovalOrder AS "ApprovalOrder",
        IsMandatory AS "IsMandatory",
        IsDeleted AS "IsDeleted"
      FROM Engineering_AMC_Approval_Config
      WHERE OrganizationID = $1
      ORDER BY
        ApprovalLevel ASC,
        AMCApprovalConfigID ASC
      FOR UPDATE;
      `,
      [OrganizationID],
    );

    const existingConfigs =
      existingResult.rows;

    console.log(
      "EXISTING AMC CONFIGS =>",
      JSON.stringify(
        existingConfigs,
        null,
        2,
      ),
    );

    // ============================================================
    // MAP EXISTING CONFIG BY LEVEL
    // ============================================================

    const existingByLevel =
      new Map();

    for (const row of existingConfigs) {
      existingByLevel.set(
        Number(row.ApprovalLevel),
        row,
      );
    }

    const processedLevels =
      new Set();

    const inserted = [];
    const updated = [];
    const restored = [];
    const deleted = [];

    // ============================================================
    // INSERT / UPDATE / RESTORE
    // ============================================================

    for (
      const approval of normalizedApprovals
    ) {
      const {
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory,
      } = approval;

      const existing =
        existingByLevel.get(
          ApprovalLevel,
        );

      // ==========================================================
      // EXISTING RECORD
      // ==========================================================

      if (existing) {
        const ConfigID = Number(
          existing.AMCApprovalConfigID,
        );

        if (
          !Number.isInteger(ConfigID)
        ) {
          throw new Error(
            `Invalid AMCApprovalConfigID: ${existing.AMCApprovalConfigID}`,
          );
        }

        // ========================================================
        // RESTORE SOFT DELETED RECORD
        // ========================================================

        if (
          existing.IsDeleted === true
        ) {
          await client.query(
            `
            UPDATE Engineering_AMC_Approval_Config
            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,
              IsDeleted = FALSE,

              ModifiedBy = $4,
              ModifiedDate = CURRENT_TIMESTAMP,

              DeletedBy = NULL,
              DeletedDate = NULL

            WHERE AMCApprovalConfigID = $5
              AND OrganizationID = $6;
            `,
            [
              ApprovalRole,
              ApprovalOrder,
              IsMandatory,
              data.UserID,
              ConfigID,
              OrganizationID,
            ],
          );

          restored.push(ConfigID);
        }

        // ========================================================
        // NORMAL UPDATE
        // ========================================================

        else {
          await client.query(
            `
            UPDATE Engineering_AMC_Approval_Config
            SET
              ApprovalRole = $1,
              ApprovalOrder = $2,
              IsMandatory = $3,
              ModifiedBy = $4,
              ModifiedDate = CURRENT_TIMESTAMP
            WHERE AMCApprovalConfigID = $5
              AND OrganizationID = $6
              AND IsDeleted = FALSE;
            `,
            [
              ApprovalRole,
              ApprovalOrder,
              IsMandatory,
              data.UserID,
              ConfigID,
              OrganizationID,
            ],
          );

          updated.push(ConfigID);
        }
      }

      // ==========================================================
      // NEW INSERT
      // ==========================================================

      else {
        const result =
          await client.query(
            `
            INSERT INTO Engineering_AMC_Approval_Config
            (
              OrganizationID,
              ApprovalLevel,
              ApprovalRole,
              ApprovalOrder,
              IsMandatory,
              IsDeleted,
              CreatedBy,
              CreatedDate
            )
            VALUES
            (
              $1,
              $2,
              $3,
              $4,
              TRUE,
              FALSE,
              $5,
              CURRENT_TIMESTAMP
            )
            RETURNING
              AMCApprovalConfigID AS "AMCApprovalConfigID";
            `,
            [
              OrganizationID,
              ApprovalLevel,
              ApprovalRole,
              ApprovalOrder,
              data.UserID,
            ],
          );

        const ConfigID = Number(
          result.rows[0]
            .AMCApprovalConfigID,
        );

        inserted.push(ConfigID);
      }

      processedLevels.add(
        ApprovalLevel,
      );
    }

    // ============================================================
    // SOFT DELETE
    // DB ME HAI BUT REQUEST ME NAHI HAI
    // ============================================================

    for (
      const existing of existingConfigs
    ) {
      const level = Number(
        existing.ApprovalLevel,
      );

      if (
        existing.IsDeleted === false &&
        !processedLevels.has(level)
      ) {
        const ConfigID = Number(
          existing.AMCApprovalConfigID,
        );

        if (
          !Number.isInteger(ConfigID)
        ) {
          throw new Error(
            `Invalid AMCApprovalConfigID: ${existing.AMCApprovalConfigID}`,
          );
        }

        await client.query(
          `
          UPDATE Engineering_AMC_Approval_Config
          SET
            IsDeleted = TRUE,
            DeletedBy = $1,
            DeletedDate = CURRENT_TIMESTAMP,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE AMCApprovalConfigID = $2
            AND OrganizationID = $3
            AND IsDeleted = FALSE;
          `,
          [
            data.UserID,
            ConfigID,
            OrganizationID,
          ],
        );

        deleted.push(ConfigID);
      }
    }

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query("COMMIT");

    transactionStarted = false;

    return {
      success: true,
      message:
        "AMC approval configuration saved successfully.",
    };
  } catch (error) {
    if (
      client &&
      transactionStarted
    ) {
      await client.query(
        "ROLLBACK",
      );
    }

    console.error(
      "Save AMC Approval Config Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(
        error,
      );

    if (retryResponse) {
      return retryResponse;
    }

    if (error.code === "23505") {
      return fail(
        "AMC approval configuration already exists.",
        409,
      );
    }

    if (error.code === "23503") {
      return fail(
        "Invalid organization or user.",
        400,
      );
    }

    return fail(
      "Unable to save AMC approval configuration at this time.",
      500,
    );
  } finally {
    if (client) {
      client.release();
    }
  }
};
// ============================================================AMC Approval Config List
const getAllAMCApprovalConfig = async (data) => {
  try {
    const OrganizationID = Number(
      data.OrganizationID,
    );

    if (
      !Number.isSafeInteger(OrganizationID) ||
      OrganizationID <= 0
    ) {
      return fail(
        "Valid OrganizationID is required.",
        400,
      );
    }

    const result = await pool.query(
      `
      SELECT
        AMCApprovalConfigID,
        ApprovalLevel,
        ApprovalRole,
        ApprovalOrder,
        IsMandatory,
        CreatedDate
      FROM Engineering_AMC_Approval_Config
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
      ORDER BY
        ApprovalOrder ASC,
        ApprovalLevel ASC;
      `,
      [OrganizationID],
    );

    const CreatedDate =
      result.rows.length > 0
        ? formatDate(result.rows[0].createddate)
        : null;

    const approvals = result.rows.map((row) => ({
      AMCApprovalConfigID:
        row.amcapprovalconfigid,
      ApprovalLevel:
        row.approvallevel,
      ApprovalRole:
        row.approvalrole,
      ApprovalOrder:
        row.approvalorder,
      IsMandatory:
        row.ismandatory,
    }));

    return ok(
      "AMC approval config fetched successfully.",
      {
        OrganizationID,
        CreatedDate,
        Count: approvals.length,
        data: approvals,
      },
    );
  } catch (error) {
    console.error(
      "Get AMC Approval Config Error:",
      error.message,
    );

    return databaseFailure(
      "Unable to fetch AMC approval config.",
    );
  }
};
// ============================================================Delete AMC Approval Config
const deleteAMCApprovalConfig = async (data) => {
  try {
    const AMCApprovalConfigID = Number(
      data.AMCApprovalConfigID,
    );

    const UserID = Number(data.UserID);

    if (
      !Number.isSafeInteger(
        AMCApprovalConfigID,
      ) ||
      AMCApprovalConfigID <= 0
    ) {
      return fail(
        "Valid AMCApprovalConfigID is required.",
        400,
      );
    }

    const result = await pool.query(
      `
      UPDATE Engineering_AMC_Approval_Config
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE AMCApprovalConfigID = $2
        AND IsDeleted = FALSE
      RETURNING AMCApprovalConfigID;
      `,
      [
        UserID,
        AMCApprovalConfigID,
      ],
    );

    if (result.rows.length === 0) {
      return fail(
        "AMC approval config not found.",
        404,
      );
    }

    return ok(
      "AMC approval config deleted successfully.",
      {
        AMCApprovalConfigID,
      },
    );
  } catch (error) {
    console.error(
      "Delete AMC Approval Config Error:",
      error.message,
    );

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }

    return databaseFailure(
      "Unable to delete AMC approval config.",
    );
  }
};
// ============================================================EXPORTS
module.exports = {
  createEquipment,
  getAllEquipment,
  getEquipmentById,
  updateEquipment,
  deleteEquipment,
  getEquipmentDescriptions,
  getEquipmentSerialNumbers,
  getEquipmentAreas,
  createBreakdown,
  getAllBreakdowns,
  getBreakdownById,
  updateBreakdown,
  deleteBreakdown,
  updateBreakdownStatus,
  createVendor,
  getAllVendors,
  getVendorById,
  updateVendor,
  deleteVendor,
  createMaintenanceChecklist,
  getAllMaintenanceChecklists,
  updateMaintenanceChecklist,
  deleteMaintenanceChecklist,
  createMaintenance,
  getAllMaintenance,
  getMaintenanceById,
  updateMaintenance,
  deleteMaintenance,
  saveMaintenance,
  getTotalEquipmentReports,
  getAllBreakdownsReport,
  getDailyMaintenanceReports,
  getMonthlyMaintenanceReports,
  getScheduledMissingReports,
  generateTotalEquipmentReportsPdf,
  generateBreakdownReportPdf,
  generateDailyMaintenanceReportPdf,
  generateMonthlyMaintenanceReportPdf,
  generateScheduledMissingReportPdf,
  createAMC,
  getAllAMC,
  getAMCById,
  updateAMC,
  deleteAMC,
  processAMCApproval,
   createAMCApprovalConfig,
  getAllAMCApprovalConfig,
  deleteAMCApprovalConfig,
};
