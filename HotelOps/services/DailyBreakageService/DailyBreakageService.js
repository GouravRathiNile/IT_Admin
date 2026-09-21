const { pool } = require("../../db");
const {
  retryableDatabaseResponse,
} = require("../../utils/retryableDatabaseError");
const { formatDate } = require("../../utils/dateFormatter");
// ===============================================Pdf Helper
const { generatePdf, loadLogo } = require("../../utils/pdfHelper");
const PdfPrinter = require("pdfmake");
const path = require("path");
const DAILY_BREAKAGE_DETAIL_PDF_FONTS = {
  Roboto: {
    normal: path.join(process.cwd(), "fonts/Roboto-Regular.ttf"),
    bold: path.join(process.cwd(), "fonts/Roboto-Medium.ttf"),
    italics: path.join(process.cwd(), "fonts/Roboto-SemiBold.ttf"),
    bolditalics: path.join(process.cwd(), "fonts/Roboto-Bold.ttf"),
  },
};

// ============================ Response Helpers
const ok = (message, data, metadata) => ({
  success: true,
  message,

  ...(metadata !== undefined ? metadata : {}),

  ...(data !== undefined ? { data } : {}),
});
const fail = (message, statusCode = 400) => ({
  success: false,
  statusCode,
  message,
});
const databaseFailure = (error, action) => {
  console.error(`${action} Error:`, error.message);

  const retryResponse = retryableDatabaseResponse(error);

  if (retryResponse) {
    return retryResponse;
  }

  return {
    success: false,
    statusCode: 500,
    message: `Unable to ${action.toLowerCase()}.`,
  };
};

// ============================================================Create Daily Breakage
const createDailyBreakage = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ============================================================
    // Insert Master
    // ============================================================

    const masterResult = await client.query(
      `
        INSERT INTO Daily_Breakage_Entry_Master
        (
          OrganizationID,
          Outlet,
          EntryDate,

          IsDeleted,

          CreatedBy,
          CreatedDate
        )
        VALUES
        (
          $1,
          $2,
          $3,

          FALSE,

          $4,
          CURRENT_TIMESTAMP
        )

        RETURNING DailyBreakageID;
        `,
      [data.OrganizationID, data.Outlet, data.EntryDate, data.UserID],
    );

    const dailyBreakageID = Number(masterResult.rows[0].dailybreakageid);

    // ============================================================
    // Insert Details
    // ============================================================

    for (const item of data.Details || []) {
      await client.query(
        `
        INSERT INTO Daily_Breakage_Entry_Details
        (
          DailyBreakageID,
          OrganizationID,

          Item,
          Nos,
          PersonResponsible,
          TotalCost,

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
          dailyBreakageID,
          data.OrganizationID,

          item.Item,
          item.Nos,
          item.PersonResponsible,
          item.TotalCost,

          data.UserID,
        ],
      );
    }

    // ============================================================
    // Commit
    // ============================================================

    await client.query("COMMIT");

    return ok("Daily Breakage created successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Create Daily Breakage");
  } finally {
    client.release();
  }
};
// ============================================================Update Daily Breakage
const updateDailyBreakage = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ============================================================
    // Check Existing Master
    // ============================================================

    const existing = await client.query(
      `
        SELECT
          DailyBreakageID

        FROM Daily_Breakage_Entry_Master

        WHERE DailyBreakageID = $1
          AND IsDeleted = FALSE

        FOR UPDATE;
        `,
      [data.DailyBreakageID],
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");

      return fail("Daily Breakage record not found.", 404);
    }

    // ============================================================
    // Update Master
    // ============================================================

    await client.query(
      `
      UPDATE Daily_Breakage_Entry_Master

      SET
        OrganizationID = $1,
        Outlet = $2,
        EntryDate = $3,

        ModifiedBy = $4,
        ModifiedDate =
          CURRENT_TIMESTAMP

      WHERE DailyBreakageID = $5
        AND IsDeleted = FALSE;
      `,
      [
        data.OrganizationID,
        data.Outlet,
        data.EntryDate,

        data.UserID,

        data.DailyBreakageID,
      ],
    );

    // ============================================================
    // Keep Detail Organization Same As Master
    // ============================================================

    await client.query(
      `
      UPDATE Daily_Breakage_Entry_Details

      SET
        OrganizationID = $1

      WHERE DailyBreakageID = $2
        AND IsDeleted = FALSE;
      `,
      [data.OrganizationID, data.DailyBreakageID],
    );

    // ============================================================
    // Delete Selected Details
    // ============================================================

    if (
      Array.isArray(data.DeleteDetailIDs) &&
      data.DeleteDetailIDs.length > 0
    ) {
      await client.query(
        `
        UPDATE Daily_Breakage_Entry_Details

        SET
          IsDeleted = TRUE,

          DeletedBy = $1,
          DeletedDate =
            CURRENT_TIMESTAMP

        WHERE DailyBreakageID = $2

          AND DailyBreakageDetailID =
            ANY($3::BIGINT[])

          AND IsDeleted = FALSE;
        `,
        [data.UserID, data.DailyBreakageID, data.DeleteDetailIDs],
      );
    }

    // ============================================================
    // Update / Insert Details
    // ============================================================

    for (const item of data.Details || []) {
      // ==========================================================
      // Update Existing Detail
      // ==========================================================

      if (item.DailyBreakageDetailID) {
        const updateResult = await client.query(
          `
            UPDATE Daily_Breakage_Entry_Details

            SET
              OrganizationID = $1,

              Item = $2,
              Nos = $3,
              PersonResponsible = $4,
              TotalCost = $5,

              ModifiedBy = $6,
              ModifiedDate =
                CURRENT_TIMESTAMP

            WHERE DailyBreakageDetailID = $7

              AND DailyBreakageID = $8

              AND IsDeleted = FALSE

            RETURNING
              DailyBreakageDetailID;
            `,
          [
            data.OrganizationID,

            item.Item,
            item.Nos,
            item.PersonResponsible,
            item.TotalCost,

            data.UserID,

            item.DailyBreakageDetailID,

            data.DailyBreakageID,
          ],
        );

        if (!updateResult.rows.length) {
          await client.query("ROLLBACK");

          return fail(
            `Daily Breakage detail ${item.DailyBreakageDetailID} not found.`,
            400,
          );
        }
      }

      // ==========================================================
      // Insert New Detail
      // ==========================================================
      else {
        await client.query(
          `
          INSERT INTO Daily_Breakage_Entry_Details
          (
            DailyBreakageID,
            OrganizationID,

            Item,
            Nos,
            PersonResponsible,
            TotalCost,

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
            data.DailyBreakageID,
            data.OrganizationID,

            item.Item,
            item.Nos,
            item.PersonResponsible,
            item.TotalCost,

            data.UserID,
          ],
        );
      }
    }

    // ============================================================
    // Ensure At Least One Detail Exists
    // ============================================================

    const detailCount = await client.query(
      `
        SELECT
          COUNT(*)::BIGINT
            AS DetailCount

        FROM Daily_Breakage_Entry_Details

        WHERE DailyBreakageID = $1
          AND IsDeleted = FALSE;
        `,
      [data.DailyBreakageID],
    );

    if (Number(detailCount.rows[0].detailcount) === 0) {
      await client.query("ROLLBACK");

      return fail("At least one Daily Breakage detail is required.", 400);
    }

    // ============================================================
    // Commit
    // ============================================================

    await client.query("COMMIT");

    return ok("Daily Breakage updated successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Update Daily Breakage");
  } finally {
    client.release();
  }
};
// ============================================================Get Apis Helper
// ======================Master Mapper Helper
const mapDailyBreakage = (row) => ({
  DailyBreakageID: Number(row.dailybreakageid),

  OrganizationID: Number(row.organizationid),

  OrganizationShortName: row.organizationshortname || null,

  OrganizationName: row.organizationname || null,

  Outlet: row.outlet,

  EntryDate: formatDate(row.entrydate),

  CreatedDate: formatDate(row.createddate),

  Details: [],
});
// ======================Detail Mapper Helper
const mapDailyBreakageDetail = (row) => ({
  DailyBreakageDetailID: Number(row.dailybreakagedetailid),

  DailyBreakageID: Number(row.dailybreakageid),

  OrganizationID: Number(row.organizationid),

  Item: row.item,

  Nos: row.nos == null ? 0 : Number(row.nos),

  PersonResponsible: row.personresponsible || null,

  TotalCost: row.totalcost == null ? 0 : Number(row.totalcost),

  CreatedDate: formatDate(row.createddate),
});
// ======================Summary Helper
const addSummary = (record) => {
  const details = Array.isArray(record.Details) ? record.Details : [];

  record.TotalItems = details.length;

  record.TotalNos = Number(
    details
      .reduce((total, item) => total + Number(item.Nos || 0), 0)
      .toFixed(2),
  );

  record.TotalCost = Number(
    details
      .reduce((total, item) => total + Number(item.TotalCost || 0), 0)
      .toFixed(2),
  );

  return record;
};
// ============================================================Get Daily Breakage By ID
const getDailyBreakageById = async (data) => {
  try {
    // ============================================================
    // Master
    // ============================================================

    const masterResult = await pool.query(
      `
        SELECT
          m.DailyBreakageID,
          m.OrganizationID,

          o.ShortName
            AS OrganizationShortName,

          o.OrganizationName,

          m.Outlet,
          m.EntryDate,
          m.CreatedDate

        FROM Daily_Breakage_Entry_Master m

        LEFT JOIN Organization_Master o
          ON o.OrganizationID =
            m.OrganizationID

          AND COALESCE(
            o.IsDeleted,
            FALSE
          ) = FALSE

        WHERE m.DailyBreakageID = $1
          AND m.IsDeleted = FALSE

        LIMIT 1;
        `,
      [data.DailyBreakageID],
    );

    if (!masterResult.rows.length) {
      return fail("Daily Breakage record not found.", 404);
    }

    // ============================================================
    // Details
    // ============================================================

    const detailResult = await pool.query(
      `
        SELECT
          DailyBreakageDetailID,
          DailyBreakageID,
          OrganizationID,

          Item,
          Nos,
          PersonResponsible,
          TotalCost,

          CreatedDate

        FROM Daily_Breakage_Entry_Details

        WHERE DailyBreakageID = $1
          AND IsDeleted = FALSE

        ORDER BY
          DailyBreakageDetailID ASC;
        `,
      [data.DailyBreakageID],
    );

    // ============================================================
    // Mapping
    // ============================================================

    const record = mapDailyBreakage(masterResult.rows[0]);

    record.Details = detailResult.rows.map(mapDailyBreakageDetail);

    addSummary(record);

    return ok("Daily Breakage fetched successfully.", record);
  } catch (error) {
    return databaseFailure(error, "Fetch Daily Breakage by ID");
  }
};
// ============================================================ Daily Breakage List
const getDailyBreakageList = async (data) => {
  try {
    // ============================================================
    // Pagination
    // ============================================================

    const page = Number(data.page) > 0 ? Number(data.page) : 1;

    const requestedPageSize = Number(data.PageSize);

    const pageSize =
      requestedPageSize > 0 ? Math.min(requestedPageSize, 100) : 10;

    const offset = (page - 1) * pageSize;

    // ============================================================
    // Filters
    // ============================================================

    const values = [];

    const conditions = ["m.IsDeleted = FALSE"];

    // ============================================================
    // Organization Filter
    // ============================================================

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(`m.OrganizationID = $${values.length}`);
    }

    // ============================================================
    // Outlet Filter
    // ============================================================

    if (data.Outlet) {
      values.push(`%${String(data.Outlet).trim()}%`);

      conditions.push(`m.Outlet ILIKE $${values.length}`);
    }

    // ============================================================
    // From Date Filter
    // ============================================================

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(`m.EntryDate >= $${values.length}::DATE`);
    }

    // ============================================================
    // To Date Filter
    // ============================================================

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(`m.EntryDate <= $${values.length}::DATE`);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    // ============================================================
    // Total Count
    // Same Filters As List
    // ============================================================

    const countResult = await pool.query(
      `
        SELECT
          COUNT(*)::BIGINT
            AS TotalCount

        FROM Daily_Breakage_Entry_Master m

        ${whereClause};
        `,
      values,
    );

    const totalCount = Number(countResult.rows[0].totalcount);

    // ============================================================
    // Pagination Values
    // ============================================================

    const listValues = [...values, pageSize, offset];

    const limitIndex = listValues.length - 1;

    const offsetIndex = listValues.length;

    // ============================================================
    // Master List
    // ============================================================

    const result = await pool.query(
      `
        SELECT
          m.DailyBreakageID,
          m.OrganizationID,

          o.ShortName
            AS OrganizationShortName,

          o.OrganizationName,

          m.Outlet,
          m.EntryDate,
          m.CreatedDate

        FROM Daily_Breakage_Entry_Master m

        LEFT JOIN Organization_Master o
          ON o.OrganizationID =
            m.OrganizationID

          AND COALESCE(
            o.IsDeleted,
            FALSE
          ) = FALSE

        ${whereClause}

        ORDER BY
          m.EntryDate DESC,
          m.DailyBreakageID DESC

        LIMIT $${limitIndex}

        OFFSET $${offsetIndex};
        `,
      listValues,
    );

    const records = result.rows.map(mapDailyBreakage);

    // ============================================================
    // Master IDs
    // ============================================================

    const masterIDs = records.map((item) => item.DailyBreakageID);

    // ============================================================
    // Fetch Details For Current Page
    // ============================================================

    if (masterIDs.length > 0) {
      const detailResult = await pool.query(
        `
          SELECT
            DailyBreakageDetailID,
            DailyBreakageID,
            OrganizationID,

            Item,
            Nos,
            PersonResponsible,
            TotalCost,

            CreatedDate

          FROM Daily_Breakage_Entry_Details

          WHERE DailyBreakageID =
            ANY($1::BIGINT[])

            AND IsDeleted = FALSE

          ORDER BY
            DailyBreakageID ASC,
            DailyBreakageDetailID ASC;
          `,
        [masterIDs],
      );

      // ==========================================================
      // Detail Map
      // ==========================================================

      const detailMap = new Map();

      for (const row of detailResult.rows) {
        const detail = mapDailyBreakageDetail(row);

        if (!detailMap.has(detail.DailyBreakageID)) {
          detailMap.set(detail.DailyBreakageID, []);
        }

        detailMap.get(detail.DailyBreakageID).push(detail);
      }

      // ==========================================================
      // Attach Details
      // ==========================================================

      for (const record of records) {
        record.Details = detailMap.get(record.DailyBreakageID) || [];

        addSummary(record);
      }
    }

    // ============================================================
    // No Records / No Details
    // ============================================================
    else {
      for (const record of records) {
        record.Details = [];

        addSummary(record);
      }
    }

    // ============================================================
    // Response
    // ============================================================

    return ok("Daily Breakage list fetched successfully.", records, {
      TotalCount: totalCount,

      PageCount: records.length,

      CurrentPage: page,

      PageSize: pageSize,

      TotalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Daily Breakage list");
  }
};
// ============================================================Delete Daily Breakage
const deleteDailyBreakage = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ============================================================
    // Check Existing Master
    // ============================================================

    const existing = await client.query(
      `
        SELECT
          DailyBreakageID

        FROM Daily_Breakage_Entry_Master

        WHERE DailyBreakageID = $1
          AND IsDeleted = FALSE

        FOR UPDATE;
        `,
      [data.DailyBreakageID],
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");

      return fail("Daily Breakage record not found.", 404);
    }

    // ============================================================
    // Soft Delete Details
    // ============================================================

    await client.query(
      `
      UPDATE Daily_Breakage_Entry_Details

      SET
        IsDeleted = TRUE,

        DeletedBy = $1,
        DeletedDate =
          CURRENT_TIMESTAMP

      WHERE DailyBreakageID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, data.DailyBreakageID],
    );

    // ============================================================
    // Soft Delete Master
    // ============================================================

    await client.query(
      `
      UPDATE Daily_Breakage_Entry_Master

      SET
        IsDeleted = TRUE,

        DeletedBy = $1,
        DeletedDate =
          CURRENT_TIMESTAMP

      WHERE DailyBreakageID = $2
        AND IsDeleted = FALSE;
      `,
      [data.UserID, data.DailyBreakageID],
    );

    // ============================================================
    // Commit
    // ============================================================

    await client.query("COMMIT");

    return ok("Daily Breakage deleted successfully.");
  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(error, "Delete Daily Breakage");
  } finally {
    client.release();
  }
};
// ============================================================
// Export
// ============================================================

module.exports = {
  createDailyBreakage,
  updateDailyBreakage,
  getDailyBreakageById,
  getDailyBreakageList,
  deleteDailyBreakage,
};
