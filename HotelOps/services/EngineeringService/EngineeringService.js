const { pool } = require("../../db");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");
const { formatDate } = require("../../utils/dateFormatter");
const generateUrl = require("../../AzurConfigration/Engineering/AzureGetData");


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

// ============================================================CREATE ,Get Apis Helpers
// ============================Document Mapper Helper
const mapDocument = (row) => ({
  EquipmentDocumentID: Number(row.equipmentdocumentid),

  EquipmentID: Number(row.equipmentid),

  OrganizationID: Number(row.organizationid),

  FileName: row.filename,

  FilePath: row.filepath,

  FileType: row.filetype,

  FileSize: row.filesize == null ? null : Number(row.filesize),

  FileUrl: row.filepath ? generateUrl(row.filepath) : null,

  CreatedDate: formatDate(row.createddate),
});
// =============================Equipment Mapper Helper
const mapEquipment = (row) => ({
  EquipmentID: Number(row.equipmentid),

  OrganizationID: Number(row.organizationid),

  Department: row.department,

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

    if (!data.Description || !String(data.Description).trim()) {
      return fail("Description is required.", 400);
    }

    await client.query("BEGIN");

    // ========================================================
    // Validate Responsible Person
    // ========================================================

    const responsiblePerson = data.ResponsiblePerson ?? null;

    if (responsiblePerson) {
      const userResult = await client.query(
        `
            SELECT 1
            FROM user_master
            WHERE UserID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE
            LIMIT 1;
            `,
        [responsiblePerson],
      );

      if (!userResult.rows.length) {
        await client.query("ROLLBACK");

        return fail("Responsible person not found.", 400);
      }
    }

    // ========================================================
    // Insert Master
    // ========================================================

    const result = await client.query(
      `
          INSERT INTO Engineering_Equipment_Entry_Master
          (
            OrganizationID,
            Department,
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

            Status,
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
            $23,$24,
            FALSE,
            $25,
            CURRENT_TIMESTAMP
          )

          RETURNING *;
          `,
      [
        organizationID,

        data.Department || null,

        String(data.Description).trim(),

        data.SerialNumber || null,

        data.TypeOfMachine || null,

        data.Capacity || null,

        data.ModelNumber || null,

        data.Make || null,

        data.Area || null,

        data.CommissioningDate || null,

        data.WarrantyStartDate || null,

        data.WarrantyEndDate || null,

        data.WarrantyStatus || null,

        data.AMCType || null,

        data.AMCStartDate || null,

        data.AMCEndDate || null,

        data.AMCStatus || null,

        data.AMCYearlyExpense ?? null,

        data.IsMandatoryAMC ?? false,

        data.ScheduleOfServicing || null,

        data.ScheduleDay || null,

        responsiblePerson,

        data.Status || null,

        data.Remarks || null,

        data.UserID,
      ],
    );

    const equipmentID = Number(result.rows[0].equipmentid);

    // ========================================================
    // Documents
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

    return ok("Engineering equipment created successfully.", {
      EquipmentID: equipmentID,
    });
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

    if (data.Department) {
      values.push(data.Department);

      conditions.push(`e.Department = $${values.length}`);
    }

    if (data.Status) {
      values.push(data.Status);

      conditions.push(`e.Status = $${values.length}`);
    }

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

    const countResult = await pool.query(
      `
          SELECT
            COUNT(*)::bigint
              AS TotalCount

          FROM Engineering_Equipment_Entry_Master e

          WHERE ${where};
          `,
      values,
    );

    const totalCount = Number(countResult.rows[0].totalcount);

    const listValues = [...values, pageSize, offset];

    const result = await pool.query(
      `
          SELECT
            e.*,

            u.FullName
              AS ResponsiblePersonName

          FROM Engineering_Equipment_Entry_Master e

          LEFT JOIN user_master u
            ON u.UserID =
               e.ResponsiblePerson
           AND u.IsDeleted = FALSE

          WHERE ${where}

          ORDER BY
            e.EquipmentID DESC

          LIMIT $${listValues.length - 1}
          OFFSET $${listValues.length};
          `,
      listValues,
    );

    let records = result.rows.map(mapEquipment);

    records = await attachDocuments(records);

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

    const organizationID = Number(data.OrganizationID);

    if (!Number.isInteger(equipmentID) || equipmentID <= 0) {
      return fail("Valid EquipmentID is required.", 400);
    }

    const result = await pool.query(
      `
          SELECT
            e.*,

            u.FullName
              AS ResponsiblePersonName

          FROM Engineering_Equipment_Entry_Master e

          LEFT JOIN user_master u
            ON u.UserID =
               e.ResponsiblePerson
           AND u.IsDeleted = FALSE

          WHERE
            e.EquipmentID = $1
            AND e.OrganizationID = $2
            AND e.IsDeleted = FALSE

          LIMIT 1;
          `,
      [equipmentID, organizationID],
    );

    if (!result.rows.length) {
      return fail("Engineering equipment not found.", 404);
    }

    let records = [mapEquipment(result.rows[0])];

    records = await attachDocuments(records);

    return ok("Engineering equipment fetched successfully.", records[0]);
  } catch (error) {
    return databaseFailure(error, "Fetch Engineering equipment");
  }
};
// ============================================================UPDATE Equipment
const updateFields = {
  Department: "Department",

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

  Status: "Status",

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

    const changes =
      data.Changes && typeof data.Changes === "object" ? data.Changes : {};

    const assignments = [];

    const values = [];

    for (const [field, column] of Object.entries(updateFields)) {
      if (!Object.prototype.hasOwnProperty.call(changes, field)) {
        continue;
      }

      const value = changes[field];

      values.push(value === "" ? null : value);

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

            ModifiedBy =
              $${modifiedByIndex},

            ModifiedDate =
              CURRENT_TIMESTAMP

          WHERE EquipmentID =
                $${equipmentIndex}

            AND OrganizationID =
                $${organizationIndex}

            AND IsDeleted =
                FALSE;
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

            DeletedDate =
              CURRENT_TIMESTAMP,

            ModifiedBy = $1,

            ModifiedDate =
              CURRENT_TIMESTAMP

          WHERE EquipmentID = $2
            AND OrganizationID = $3
            AND EquipmentDocumentID =
                ANY($4::bigint[])
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

    return ok("Engineering equipment updated successfully.", {
      EquipmentID: equipmentID,
    });
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

    const organizationID = Number(data.OrganizationID);

    if (!Number.isInteger(equipmentID) || equipmentID <= 0) {
      return fail("Valid EquipmentID is required.", 400);
    }

    await client.query("BEGIN");

    const result = await client.query(
      `
          UPDATE Engineering_Equipment_Entry_Master

          SET
            IsDeleted = TRUE,

            DeletedBy = $1,

            DeletedDate =
              CURRENT_TIMESTAMP,

            ModifiedBy = $1,

            ModifiedDate =
              CURRENT_TIMESTAMP

          WHERE EquipmentID = $2
            AND OrganizationID = $3
            AND IsDeleted = FALSE

          RETURNING EquipmentID;
          `,
      [data.UserID, equipmentID, organizationID],
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");

      return fail("Engineering equipment not found.", 404);
    }

    // Soft delete documents
    await client.query(
      `
        UPDATE Engineering_Equipment_Documents

        SET
          IsDeleted = TRUE,

          DeletedBy = $1,

          DeletedDate =
            CURRENT_TIMESTAMP,

          ModifiedBy = $1,

          ModifiedDate =
            CURRENT_TIMESTAMP

        WHERE EquipmentID = $2
          AND OrganizationID = $3
          AND IsDeleted = FALSE;
        `,
      [data.UserID, equipmentID, organizationID],
    );

    // Soft delete maintenance too
    await client.query(
      `
        UPDATE Engineering_Maintenance_Details

        SET
          IsDeleted = TRUE,

          DeletedBy = $1,

          DeletedDate =
            CURRENT_TIMESTAMP,

          ModifiedBy = $1,

          ModifiedDate =
            CURRENT_TIMESTAMP

        WHERE EquipmentID = $2
          AND OrganizationID = $3
          AND IsDeleted = FALSE;
        `,
      [data.UserID, equipmentID, organizationID],
    );

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

// ============================================================EXPORTS
module.exports = {
  createEquipment,
  getAllEquipment,
  getEquipmentById,
  updateEquipment,
  deleteEquipment,
};
