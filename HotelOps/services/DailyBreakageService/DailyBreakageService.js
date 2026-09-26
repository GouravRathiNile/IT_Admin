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

  Outlet: row.outlet,

  EntryDate: formatDate(row.entrydate),

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
const sanitizeDailyBreakageDetail = (detail) => {
  delete detail.DailyBreakageID;
  delete detail.OrganizationID;
  delete detail.CreatedDate;
  return detail;
};
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

    record.Details.forEach(sanitizeDailyBreakageDetail);

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

        record.Details.forEach(sanitizeDailyBreakageDetail);
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
// ============================================================Outlets Names
const getDailyBreakageOutlets = async (data) => {
  try {
    const { OrganizationID } = data;

    const result = await pool.query(
      `
      SELECT DISTINCT
        TRIM(Outlet) AS Outlet

      FROM Daily_Breakage_Entry_Master

      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
        AND Outlet IS NOT NULL
        AND TRIM(Outlet) <> ''

      ORDER BY Outlet ASC;
      `,
      [OrganizationID],
    );

    const outlets = result.rows.map(
      (row) => ({
        Outlet: row.outlet,
      }),
    );

    return ok(
      "Daily Breakage outlets fetched successfully.",
      outlets,
      {
        Count: outlets.length,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Daily Breakage outlets",
    );
  }
};
// ============================================================Person Responsible Names
const getDailyBreakagePersonResponsible = async (data) => {
  try {
    const { OrganizationID } = data;

    const result = await pool.query(
      `
      SELECT DISTINCT
        TRIM(PersonResponsible) AS PersonResponsible

      FROM Daily_Breakage_Entry_Details

      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
        AND PersonResponsible IS NOT NULL
        AND TRIM(PersonResponsible) <> ''

      ORDER BY PersonResponsible ASC;
      `,
      [OrganizationID],
    );

    const persons = result.rows.map(
      (row) => ({
        PersonResponsible:
          row.personresponsible,
      }),
    );

    return ok(
      "Daily Breakage person responsible fetched successfully.",
      persons,
      {
        Count: persons.length,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Daily Breakage person responsible",
    );
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
// =======================================================================Reports
// ============================================================Summary Report
const getDailyBreakageSummaryReport = async (data) => {
  try {
    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];


    // ============================================================
    // Organization Filter
    // ============================================================

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================
    // From Date
    // ============================================================

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.EntryDate >= $${values.length}::DATE`,
      );
    }


    // ============================================================
    // To Date
    // ============================================================

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.EntryDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================
    // Summary
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        COUNT(
          DISTINCT m.DailyBreakageID
        )::BIGINT
          AS TotalEntries,

        COUNT(
          d.DailyBreakageDetailID
        )::BIGINT
          AS TotalBreakageItems,

        COALESCE(
          SUM(d.Nos),
          0
        )::NUMERIC
          AS TotalNos,

        COALESCE(
          SUM(d.TotalCost),
          0
        )::NUMERIC
          AS TotalCost

      FROM Daily_Breakage_Entry_Master m

      LEFT JOIN Daily_Breakage_Entry_Details d
        ON d.DailyBreakageID =
          m.DailyBreakageID

        AND d.IsDeleted = FALSE

      ${whereClause};
      `,
      values,
    );


    const row =
      result.rows[0];


    return ok(
      "Daily Breakage summary report fetched successfully.",
      {
        TotalEntries:
          Number(
            row.totalentries,
          ),

        TotalBreakageItems:
          Number(
            row.totalbreakageitems,
          ),

        TotalNos:
          Number(
            row.totalnos,
          ),

        TotalCost:
          Number(
            row.totalcost,
          ),
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch Daily Breakage summary report",
    );
  }
};
// ============================================================Outlet Wise Report
const mapOutletWiseReport = (row) => ({
  Outlet:
    row.outlet,

  TotalEntries:
    Number(
      row.totalentries,
    ),

  TotalBreakageItems:
    Number(
      row.totalbreakageitems,
    ),

  TotalNos:
    Number(
      row.totalnos,
    ),

  TotalCost:
    Number(
      row.totalcost,
    ),
});
const getDailyBreakageOutletWiseReport = async (data) => {
  try {
    const page =
      Number(data.page) > 0
        ? Number(data.page)
        : 1;


    const requestedPageSize =
      Number(data.PageSize);


    const pageSize =
      requestedPageSize > 0
        ? Math.min(
            requestedPageSize,
            100,
          )
        : 10;


    const offset =
      (page - 1) *
      pageSize;


    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
      "d.IsDeleted = FALSE",
      "m.Outlet IS NOT NULL",
      "TRIM(m.Outlet) <> ''",
    ];


    // ============================================================
    // Organization Filter
    // ============================================================

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================
    // Outlet Filter
    // ============================================================

    if (data.Outlet) {
      values.push(
        `%${String(
          data.Outlet,
        ).trim()}%`,
      );

      conditions.push(
        `m.Outlet ILIKE $${values.length}`,
      );
    }


    // ============================================================
    // From Date
    // ============================================================

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.EntryDate >= $${values.length}::DATE`,
      );
    }


    // ============================================================
    // To Date
    // ============================================================

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.EntryDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================
    // Count
    // Same Scope As Data Query
    // ============================================================

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::BIGINT
          AS TotalCount

      FROM
      (
        SELECT
          LOWER(
            TRIM(m.Outlet)
          ) AS OutletKey

        FROM Daily_Breakage_Entry_Master m

        INNER JOIN Daily_Breakage_Entry_Details d
          ON d.DailyBreakageID =
            m.DailyBreakageID

        ${whereClause}

        GROUP BY
          LOWER(
            TRIM(m.Outlet)
          )
      ) x;
      `,
      values,
    );


    const totalCount =
      Number(
        countResult
          .rows[0]
          .totalcount,
      );


    // ============================================================
    // Pagination
    // ============================================================

    const listValues = [
      ...values,
      pageSize,
      offset,
    ];


    const limitIndex =
      listValues.length - 1;

    const offsetIndex =
      listValues.length;


    // ============================================================
    // Data
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        MIN(
          TRIM(m.Outlet)
        ) AS Outlet,

        COUNT(
          DISTINCT m.DailyBreakageID
        )::BIGINT
          AS TotalEntries,

        COUNT(
          d.DailyBreakageDetailID
        )::BIGINT
          AS TotalBreakageItems,

        COALESCE(
          SUM(d.Nos),
          0
        )::NUMERIC
          AS TotalNos,

        COALESCE(
          SUM(d.TotalCost),
          0
        )::NUMERIC
          AS TotalCost

      FROM Daily_Breakage_Entry_Master m

      INNER JOIN Daily_Breakage_Entry_Details d
        ON d.DailyBreakageID =
          m.DailyBreakageID

      ${whereClause}

      GROUP BY
        LOWER(
          TRIM(m.Outlet)
        )

      ORDER BY
        MIN(
          TRIM(m.Outlet)
        ) ASC

      LIMIT $${limitIndex}

      OFFSET $${offsetIndex};
      `,
      listValues,
    );


    const records =
      result.rows.map(
        mapOutletWiseReport,
      );


    return ok(
      "Outlet wise Daily Breakage report fetched successfully.",
      records,
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
          Math.ceil(
            totalCount /
            pageSize,
          ),
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch outlet wise Daily Breakage report",
    );
  }
};
// ============================================================Person Responsible Wise Report
const mapPersonResponsibleReport = (row) => ({
  PersonResponsible:
    row.personresponsible,

  TotalBreakageCount:
    Number(
      row.totalbreakagecount,
    ),

  TotalNos:
    Number(
      row.totalnos,
    ),

  TotalCost:
    Number(
      row.totalcost,
    ),
});
const getDailyBreakagePersonResponsibleReport = async (data) => {
  try {
    const page =
      Number(data.page) > 0
        ? Number(data.page)
        : 1;


    const requestedPageSize =
      Number(data.PageSize);


    const pageSize =
      requestedPageSize > 0
        ? Math.min(
            requestedPageSize,
            100,
          )
        : 10;


    const offset =
      (page - 1) *
      pageSize;


    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
      "d.IsDeleted = FALSE",
      "d.PersonResponsible IS NOT NULL",
      "TRIM(d.PersonResponsible) <> ''",
    ];


    // ============================================================
    // Organization Filter
    // ============================================================

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================
    // Person Responsible Filter
    // ============================================================

    if (data.PersonResponsible) {
      values.push(
        `%${String(
          data.PersonResponsible,
        ).trim()}%`,
      );

      conditions.push(
        `d.PersonResponsible ILIKE $${values.length}`,
      );
    }


    // ============================================================
    // From Date
    // ============================================================

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.EntryDate >= $${values.length}::DATE`,
      );
    }


    // ============================================================
    // To Date
    // ============================================================

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.EntryDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================
    // Count
    // Same Scope As Data Query
    // ============================================================

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::BIGINT
          AS TotalCount

      FROM
      (
        SELECT
          LOWER(
            TRIM(
              d.PersonResponsible
            )
          ) AS PersonResponsibleKey

        FROM Daily_Breakage_Entry_Details d

        INNER JOIN Daily_Breakage_Entry_Master m
          ON m.DailyBreakageID =
            d.DailyBreakageID

        ${whereClause}

        GROUP BY
          LOWER(
            TRIM(
              d.PersonResponsible
            )
          )
      ) x;
      `,
      values,
    );


    const totalCount =
      Number(
        countResult
          .rows[0]
          .totalcount,
      );


    // ============================================================
    // Pagination
    // ============================================================

    const listValues = [
      ...values,
      pageSize,
      offset,
    ];


    const limitIndex =
      listValues.length - 1;

    const offsetIndex =
      listValues.length;


    // ============================================================
    // Data
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        MIN(
          TRIM(
            d.PersonResponsible
          )
        ) AS PersonResponsible,

        COUNT(
          d.DailyBreakageDetailID
        )::BIGINT
          AS TotalBreakageCount,

        COALESCE(
          SUM(d.Nos),
          0
        )::NUMERIC
          AS TotalNos,

        COALESCE(
          SUM(d.TotalCost),
          0
        )::NUMERIC
          AS TotalCost

      FROM Daily_Breakage_Entry_Details d

      INNER JOIN Daily_Breakage_Entry_Master m
        ON m.DailyBreakageID =
          d.DailyBreakageID

      ${whereClause}

      GROUP BY
        LOWER(
          TRIM(
            d.PersonResponsible
          )
        )

      ORDER BY
        MIN(
          TRIM(
            d.PersonResponsible
          )
        ) ASC

      LIMIT $${limitIndex}

      OFFSET $${offsetIndex};
      `,
      listValues,
    );


    const records =
      result.rows.map(
        mapPersonResponsibleReport,
      );


    return ok(
      "Person responsible wise Daily Breakage report fetched successfully.",
      records,
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
          Math.ceil(
            totalCount /
            pageSize,
          ),
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch person responsible wise Daily Breakage report",
    );
  }
};
// =======================================================================PDFs
// ============================================================Daily Breakage List PDF
const generateDailyBreakageListPdf = async (data) => {
  try {
    // ============================================================
    // Fetch All Data From Existing GET Service
    // ============================================================

    let page = 1;
    const pageSize = 100;

    let totalPages = 1;
    let records = [];


    do {
      const listResult =
        await getDailyBreakageList({
          OrganizationID:
            data.OrganizationID || null,

          Outlet:
            data.Outlet || null,

          FromDate:
            data.FromDate || null,

          ToDate:
            data.ToDate || null,

          page,
          PageSize:
            pageSize,
        });


      if (!listResult.success) {
        return listResult;
      }


      records.push(
        ...(
          Array.isArray(
            listResult.data,
          )
            ? listResult.data
            : []
        ),
      );


      totalPages =
        Number(
          listResult.TotalPages,
        ) || 1;


      page += 1;

    } while (
      page <= totalPages
    );


    // ============================================================
    // PDF Rows
    // Same Data Returned By GET API
    // ============================================================

    const pdfRows = [];


    records.forEach(
      (
        record,
        recordIndex,
      ) => {

        const details =
          Array.isArray(
            record.Details,
          )
            ? record.Details
            : [];


        // ========================================================
        // Detail Rows
        // ========================================================

        if (
          details.length > 0
        ) {
          details.forEach(
            (
              detail,
              detailIndex,
            ) => {

              pdfRows.push({
                SrNo:
                  detailIndex === 0
                    ? String(
                        recordIndex + 1,
                      ).padStart(
                        2,
                        "0",
                      )
                    : "",

                EntryDate:
                  detailIndex === 0
                    ? record.EntryDate
                    : "",

                Outlet:
                  detailIndex === 0
                    ? record.Outlet
                    : "",

                Item:
                  detail.Item,

                Nos:
                  detail.Nos,

                PersonResponsible:
                  detail.PersonResponsible,

                TotalCost:
                  detail.TotalCost,

                IsTotal:
                  false,
              });
            },
          );


          // ======================================================
          // Total Row
          // ======================================================

          pdfRows.push({
            SrNo:
              "",

            EntryDate:
              "",

            Outlet:
              "",

            Item:
              "Total",

            Nos:
              "",

            PersonResponsible:
              "",

            TotalCost:
              record.TotalCost,

            IsTotal:
              true,
          });
        }


        // ========================================================
        // Master Without Details
        // ========================================================

        else {
          pdfRows.push({
            SrNo:
              String(
                recordIndex + 1,
              ).padStart(
                2,
                "0",
              ),

            EntryDate:
              record.EntryDate,

            Outlet:
              record.Outlet,

            Item:
              "-",

            Nos:
              "-",

            PersonResponsible:
              "-",

            TotalCost:
              "-",

            IsTotal:
              false,
          });
        }
      },
    );


    // ============================================================
    // Columns
    // Same Fields As Screen
    // ============================================================

    const columns = [
      {
        header:
          "SR#",

        value:
          (row) =>
            row.SrNo,

        width:
          32,

        align:
          "center",
      },

      {
        header:
          "DATE",

        value:
          (row) =>
            row.EntryDate || "",

        width:
          80,

        align:
          "center",
      },

      {
        header:
          "OUTLET",

        value:
          (row) =>
            row.Outlet || "",

        width:
          100,
      },

      {
        header:
          "ITEM",

        value:
          (row) =>
            row.Item || "-",

        width:
          "*",
      },

      {
        header:
          "NOS.",

        value:
          (row) => {
            if (
              row.Nos === "" ||
              row.Nos === null ||
              row.Nos === undefined
            ) {
              return "";
            }

            return row.Nos;
          },

        width:
          55,

        align:
          "center",
      },

      {
        header:
          "PERSON RESPONSIBLE",

        value:
          (row) =>
            row.PersonResponsible ||
            "",

        width:
          125,
      },

      {
        header:
          "TOTAL COST",

        value:
          (row) => {
            if (
              row.TotalCost === "" ||
              row.TotalCost === null ||
              row.TotalCost === undefined ||
              row.TotalCost === "-"
            ) {
              return "-";
            }

            return `₹${Number(
              row.TotalCost,
            ).toFixed(2)}`;
          },

        width:
          90,

        align:
          "right",
      },
    ];


    // ============================================================
    // Metadata
    // ============================================================

    const metadata = [];


    if (data.OrganizationID) {
      metadata.push({
        label:
          "Organization",

        value:
          records[0]
            ?.OrganizationName ||
          records[0]
            ?.OrganizationShortName ||
          data.OrganizationID,
      });
    }


    if (data.Outlet) {
      metadata.push({
        label:
          "Outlet",

        value:
          data.Outlet,
      });
    }


    if (data.FromDate) {
      metadata.push({
        label:
          "From Date",

        value:
          formatDate(
            data.FromDate,
          ),
      });
    }


    if (data.ToDate) {
      metadata.push({
        label:
          "To Date",

        value:
          formatDate(
            data.ToDate,
          ),
      });
    }


    metadata.push({
      label:
        "Total Entries",

      value:
        records.length,
    });


    // ============================================================
    // Generate PDF
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "DAILY BREAKAGE REPORT",

        reportName:
          "Daily Breakage Report",

        organizationId:
          data.OrganizationID ||
          records[0]
            ?.OrganizationID ||
          null,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          pdfRows,

        pageMargins:
          [
            20,
            24,
            20,
            35,
          ],
      });


    // ============================================================
    // Response
    // ============================================================

    return {
      success:
        true,

      message:
        "Daily Breakage list PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Daily_Breakage_List_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "Daily Breakage List PDF Error:",
      error,
    );

    return {
      success:
        false,

      statusCode:
        503,

      message:
        "Unable to generate Daily Breakage list PDF.",
    };
  }
};
// ============================================================Outlet Wise Report PDF
const generateDailyBreakageOutletWiseReportPdf = async (data) => {
  try {

    // ============================================================
    // Fetch All Data From Existing GET Report API
    // GET API PageSize Max = 100
    // ============================================================

    let page = 1;
    const pageSize = 100;

    let totalPages = 1;
    let records = [];


    do {
      const reportResult =
        await getDailyBreakageOutletWiseReport({
          OrganizationID:
            data.OrganizationID || null,

          Outlet:
            data.Outlet || null,

          FromDate:
            data.FromDate || null,

          ToDate:
            data.ToDate || null,

          page,
          PageSize:
            pageSize,
        });


      if (!reportResult.success) {
        return reportResult;
      }


      records.push(
        ...(
          Array.isArray(
            reportResult.data,
          )
            ? reportResult.data
            : []
        ),
      );


      totalPages =
        Number(
          reportResult.TotalPages,
        ) || 0;


      page += 1;

    } while (
      page <= totalPages
    );


    // ============================================================
    // PDF Rows
    // SAME DATA RETURNED BY GET API
    // ============================================================

    const pdfRows =
      records.map(
        (record, index) => ({
          SrNo:
            index + 1,

          Outlet:
            record.Outlet,

          TotalEntries:
            record.TotalEntries,

          TotalBreakageItems:
            record.TotalBreakageItems,

          TotalNos:
            record.TotalNos,

          TotalCost:
            record.TotalCost,
        }),
      );


    // ============================================================
    // PDF Columns
    // SAME FIELDS AS GET RESPONSE
    // ============================================================

    const columns = [
      {
        header:
          "SR#",

        value:
          (row) =>
            row.SrNo,

        width:
          40,

        align:
          "center",
      },

      {
        header:
          "OUTLET",

        value:
          (row) =>
            row.Outlet || "-",

        width:
          "*",
      },

      {
        header:
          "TOTAL ENTRIES",

        value:
          (row) =>
            row.TotalEntries,

        width:
          95,

        align:
          "center",
      },

      {
        header:
          "TOTAL BREAKAGE ITEMS",

        value:
          (row) =>
            row.TotalBreakageItems,

        width:
          120,

        align:
          "center",
      },

      {
        header:
          "TOTAL NOS",

        value:
          (row) =>
            row.TotalNos,

        width:
          85,

        align:
          "center",
      },

      {
        header:
          "TOTAL COST [INR]",

        value:
          (row) =>
            Number(
              row.TotalCost || 0,
            ).toFixed(2),

        width:
          100,

        align:
          "center",
      },
    ];


    // ============================================================
    // Metadata
    // SAME FILTERS USED IN GET API
    // ============================================================

    const metadata = [];


    if (data.OrganizationID) {
      metadata.push({
        label:
          "Organization ID",

        value:
          data.OrganizationID,
      });
    }


    if (data.Outlet) {
      metadata.push({
        label:
          "Outlet",

        value:
          data.Outlet,
      });
    }


    if (data.FromDate) {
      metadata.push({
        label:
          "From Date",

        value:
          formatDate(
            data.FromDate,
          ),
      });
    }


    if (data.ToDate) {
      metadata.push({
        label:
          "To Date",

        value:
          formatDate(
            data.ToDate,
          ),
      });
    }


    metadata.push({
      label:
        "Total Outlets",

      value:
        records.length,
    });


    // ============================================================
    // Generate PDF
    // Existing PDF Config
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "OUTLET WISE BREAKAGE REPORT",

        reportName:
          "Daily Breakage Outlet Wise Report",

        organizationId:
          data.OrganizationID || null,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          pdfRows,

        pageMargins:
          [
            20,
            24,
            20,
            35,
          ],
      });


    // ============================================================
    // Response
    // ============================================================

    return {
      success: true,

      message:
        "Outlet wise Daily Breakage report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Daily_Breakage_Outlet_Wise_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {

    console.error(
      "Outlet Wise Daily Breakage PDF Error:",
      error,
    );


    return {
      success: false,

      statusCode: 503,

      message:
        "Unable to generate outlet wise Daily Breakage report PDF.",
    };
  }
};
// ============================================================Person Responsible Wise Report PDF
const generateDailyBreakagePersonResponsibleReportPdf = async (data) => {
  try {

    // ============================================================
    // Fetch All Data From Existing GET Report API
    // Existing GET PageSize Max = 100
    // ============================================================

    let page = 1;
    const pageSize = 100;

    let totalPages = 1;
    let records = [];


    do {
      const reportResult =
        await getDailyBreakagePersonResponsibleReport({
          OrganizationID:
            data.OrganizationID || null,

          PersonResponsible:
            data.PersonResponsible || null,

          FromDate:
            data.FromDate || null,

          ToDate:
            data.ToDate || null,

          page,

          PageSize:
            pageSize,
        });


      if (!reportResult.success) {
        return reportResult;
      }


      records.push(
        ...(
          Array.isArray(reportResult.data)
            ? reportResult.data
            : []
        ),
      );


      totalPages =
        Number(
          reportResult.TotalPages,
        ) || 0;


      page += 1;

    } while (
      page <= totalPages
    );


    // ============================================================
    // PDF Rows
    // SAME DATA RETURNED BY GET API
    // ============================================================

    const pdfRows =
      records.map(
        (record, index) => ({
          SrNo:
            index + 1,

          PersonResponsible:
            record.PersonResponsible,

          TotalBreakageCount:
            record.TotalBreakageCount,

          TotalNos:
            record.TotalNos,

          TotalCost:
            record.TotalCost,
        }),
      );


    // ============================================================
    // PDF Columns
    // SAME FIELDS AS GET RESPONSE
    // ============================================================

    const columns = [
      {
        header:
          "SR#",

        value:
          (row) =>
            row.SrNo,

        width:
          45,

        align:
          "center",
      },

      {
        header:
          "PERSON RESPONSIBLE",

        value:
          (row) =>
            row.PersonResponsible || "-",

        width:
          "*",
      },

      {
        header:
          "TOTAL BREAKAGE COUNT",

        value:
          (row) =>
            row.TotalBreakageCount,

        width:
          130,

        align:
          "center",
      },

      {
        header:
          "TOTAL NOS",

        value:
          (row) =>
            row.TotalNos,

        width:
          100,

        align:
          "center",
      },

      {
        header:
          "TOTAL COST [INR]",

        value:
          (row) =>
            Number(
              row.TotalCost || 0,
            ).toFixed(2),

        width:
          110,

        align:
          "center",
      },
    ];


    // ============================================================
    // Metadata
    // SAME FILTERS AS GET API
    // ============================================================

    const metadata = [];


    if (data.OrganizationID) {
      metadata.push({
        label:
          "Organization ID",

        value:
          data.OrganizationID,
      });
    }


    if (data.PersonResponsible) {
      metadata.push({
        label:
          "Person Responsible",

        value:
          data.PersonResponsible,
      });
    }


    if (data.FromDate) {
      metadata.push({
        label:
          "From Date",

        value:
          formatDate(
            data.FromDate,
          ),
      });
    }


    if (data.ToDate) {
      metadata.push({
        label:
          "To Date",

        value:
          formatDate(
            data.ToDate,
          ),
      });
    }


    metadata.push({
      label:
        "Total Persons",

      value:
        records.length,
    });


    // ============================================================
    // Generate PDF
    // Existing PDF Helper
    // ============================================================

    const pdfBuffer =
      await generatePdf({
        title:
          "RESPONSIBLE PERSON WISE BREAKAGE REPORT",

        reportName:
          "Daily Breakage Person Responsible Wise Report",

        organizationId:
          data.OrganizationID || null,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          pdfRows,

        pageMargins:
          [
            20,
            24,
            20,
            35,
          ],
      });


    // ============================================================
    // Response
    // ============================================================

    return {
      success: true,

      message:
        "Person responsible wise Daily Breakage report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Daily_Breakage_Person_Responsible_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {

    console.error(
      "Person Responsible Wise Daily Breakage PDF Error:",
      error,
    );


    return {
      success: false,

      statusCode: 503,

      message:
        "Unable to generate person responsible wise Daily Breakage report PDF.",
    };
  }
};
// ============================================================Daily Breakage Details PDF
const generateDailyBreakageDetailPdf = async (data) => {
  try {
    // ============================================================
    // Validate
    // ============================================================

    const dailyBreakageID =
      Number(data.DailyBreakageID);


    if (
      !Number.isInteger(
        dailyBreakageID,
      ) ||
      dailyBreakageID <= 0
    ) {
      return fail(
        "Valid DailyBreakageID is required.",
        400,
      );
    }


    // ============================================================
    // SAME GET BY ID API
    // No Duplicate SQL
    // ============================================================

    const dailyBreakageResult =
      await getDailyBreakageById({
        DailyBreakageID:
          dailyBreakageID,
      });


    if (
      !dailyBreakageResult.success
    ) {
      return dailyBreakageResult;
    }


    const detail =
      dailyBreakageResult.data;


    // ============================================================
    // PDF Design
    // ============================================================

    const COLORS = {
      navy:
        "#082B5C",

      label:
        "#082B5C",

      text:
        "#172033",

      muted:
        "#64748B",

      border:
        "#CFD7E3",

      labelBackground:
        "#F4F6F9",
    };


    const displayValue = (
      value,
    ) =>
      value === null ||
      value === undefined ||
      String(value).trim() === ""
        ? "-"
        : String(value);


    // ============================================================
    // Canvas Helpers
    // ============================================================

    const line = (
      x1,
      y1,
      x2,
      y2,
      lineWidth = 1.1,
    ) => ({
      type:
        "line",

      x1,
      y1,
      x2,
      y2,

      lineWidth,

      lineColor:
        COLORS.navy,
    });


    const rect = (
      x,
      y,
      w,
      h,
      r = 0,
    ) => ({
      type:
        "rect",

      x,
      y,
      w,
      h,
      r,

      lineWidth:
        1.1,

      lineColor:
        COLORS.navy,
    });


    const ellipse = (
      x,
      y,
      r1,
      r2 = r1,
    ) => ({
      type:
        "ellipse",

      x,
      y,
      r1,
      r2,

      lineWidth:
        1.1,

      lineColor:
        COLORS.navy,
    });


    // ============================================================
    // Icons
    // ============================================================

    const fieldIcon = (
      type,
    ) => {
      const icons = {

        organization: [
          rect(
            4,
            2,
            10,
            15,
            1,
          ),

          line(
            1,
            17,
            17,
            17,
          ),

          line(
            7,
            6,
            7,
            8,
          ),

          line(
            11,
            6,
            11,
            8,
          ),

          line(
            7,
            11,
            7,
            13,
          ),

          line(
            11,
            11,
            11,
            13,
          ),
        ],


        calendar: [
          rect(
            1,
            4,
            16,
            13,
            1,
          ),

          line(
            1,
            8,
            17,
            8,
          ),

          line(
            5,
            2,
            5,
            6,
          ),

          line(
            13,
            2,
            13,
            6,
          ),
        ],


        location: [
          ellipse(
            9,
            7,
            5,
          ),

          ellipse(
            9,
            7,
            1.5,
          ),

          {
            type:
              "polyline",

            points: [
              {
                x: 5,
                y: 10,
              },

              {
                x: 9,
                y: 18,
              },

              {
                x: 13,
                y: 10,
              },
            ],

            lineWidth:
              1.1,

            lineColor:
              COLORS.navy,
          },
        ],


        quantity: [
          rect(
            2,
            3,
            14,
            12,
            1,
          ),

          line(
            5,
            7,
            13,
            7,
          ),

          line(
            5,
            11,
            13,
            11,
          ),
        ],


        money: [
          ellipse(
            9,
            9,
            7,
          ),

          line(
            9,
            4,
            9,
            14,
          ),

          line(
            6,
            6,
            12,
            6,
          ),

          line(
            6,
            12,
            12,
            12,
          ),
        ],
      };


      const iconScale =
        0.82;


      return (
        icons[type] ||
        icons.quantity
      ).map(
        (shape) => {

          const scaledShape = {
            ...shape,

            lineWidth:
              (
                shape.lineWidth ||
                1
              ) *
              iconScale,
          };


          for (
            const coordinate
            of [
              "x",
              "y",
              "x1",
              "y1",
              "x2",
              "y2",
              "w",
              "h",
              "r",
              "r1",
              "r2",
            ]
          ) {
            if (
              typeof scaledShape[
                coordinate
              ] ===
              "number"
            ) {
              scaledShape[
                coordinate
              ] *=
                iconScale;
            }
          }


          if (
            Array.isArray(
              scaledShape.points,
            )
          ) {
            scaledShape.points =
              scaledShape.points.map(
                (point) => ({
                  x:
                    point.x *
                    iconScale,

                  y:
                    point.y *
                    iconScale,
                }),
              );
          }


          return scaledShape;
        },
      );
    };


    // ============================================================
    // Cell Helpers
    // ============================================================

    const labelCell = (
      label,
      icon,
    ) => ({
      columns: [
        {
          width:
            22,

          canvas:
            fieldIcon(
              icon,
            ),

          margin:
            [
              0,
              0,
              0,
              0,
            ],
        },

        {
          width:
            "*",

          text:
            label,

          style:
            "fieldLabel",

          margin:
            [
              2,
              3,
              0,
              0,
            ],
        },
      ],

      fillColor:
        COLORS.labelBackground,

      margin:
        [
          8,
          6,
          5,
          6,
        ],
    });


    const valueCell = (
      value,
    ) => ({
      text:
        displayValue(
          value,
        ),

      style:
        "fieldValue",

      margin:
        [
          9,
          8,
          7,
          7,
        ],
    });


    const tableLayout = {
      hLineColor:
        () =>
          COLORS.border,

      vLineColor:
        () =>
          COLORS.border,

      hLineWidth:
        () =>
          0.7,

      vLineWidth:
        () =>
          0.7,

      paddingLeft:
        () =>
          0,

      paddingRight:
        () =>
          0,

      paddingTop:
        () =>
          0,

      paddingBottom:
        () =>
          0,
    };


    const sectionHeading = (
      title,
    ) => ({
      text:
        title,

      fontSize:
        11,

      bold:
        true,

      color:
        COLORS.navy,

      margin:
        [
          0,
          4,
          0,
          7,
        ],
    });


    // ============================================================
    // Logo
    // ============================================================

    const logo =
      await loadLogo(
        detail.OrganizationID,
        data.logoUrl,
      );


    const generatedOn =
      formatDate(
        new Date(),
        "DD MMM YYYY hh:mm A",
      );


    // ============================================================
    // Breakage Detail Table Body
    // ============================================================

    const breakageDetailsBody = [
      [
        {
          text:
            "Sr.No.",

          style:
            "tableHeader",

          alignment:
            "center",
        },

        {
          text:
            "Item",

          style:
            "tableHeader",
        },

        {
          text:
            "Nos.",

          style:
            "tableHeader",

          alignment:
            "center",
        },

       

        {
          text:
            "Total Cost [INR]",

          style:
            "tableHeader",

          alignment:
            "center",
        },

         {
          text:
            "Person Responsible",

          style:
            "tableHeader",
        },
      ],
    ];


    // ============================================================
    // Detail Rows
    // ============================================================

    if (
      detail.Details &&
      detail.Details.length > 0
    ) {
      detail.Details.forEach(
        (
          item,
          index,
        ) => {

          breakageDetailsBody.push([
            {
              text:
                index + 1,

              style:
                "tableValue",

              alignment:
                "center",
            },

            {
              text:
                displayValue(
                  item.Item,
                ),

              style:
                "tableValue",
            },

            {
              text:
                displayValue(
                  item.Nos,
                ),

              style:
                "tableValue",

              alignment:
                "center",
            },

           

            {
              text:
                Number(
                  item.TotalCost ||
                  0,
                ).toFixed(
                  2,
                ),

              style:
                "tableValue",

              alignment:
                "center",
            },
             {
              text:
                displayValue(
                  item.PersonResponsible,
                ),

              style:
                "tableValue",
            },
          ]);
        },
      );


      // ==========================================================
      // Total Row
      // ==========================================================

      breakageDetailsBody.push([
        {
          text:
            "",

          colSpan:
            0,
            style:
            "tableTotal",
        },

        { text:
            "Total",

          style:
            "tableTotal",

          alignment:
            "left",},

        {
          text:
            Number(
              detail.TotalNos ||
              0,
            ).toFixed(
              2,
            ),

          style:
            "tableTotal",

          alignment:
            "center",
        },

        {
          text:
            Number(
              detail.TotalCost ||
              0,
            ).toFixed(
              2,
            ),

          style:
            "tableTotal",

          alignment:
            "center",
        },

        {
         text:
            "",

          colSpan:
            0,
            style:
            "tableTotal",
        },
      ]);

    } else {

      breakageDetailsBody.push([
        {
          text:
            "No breakage details found.",

          colSpan:
            5,

          alignment:
            "center",

          color:
            COLORS.muted,

          margin:
            [
              0,
              8,
              0,
              8,
            ],
        },

        {},
        {},
        {},
        {},
      ]);
    }


    // ============================================================
    // Document Definition
    // ============================================================

    const documentDefinition = {

      pageSize:
        "A4",

      pageOrientation:
        "portrait",

      pageMargins:
        [
          22,
          26,
          22,
          72,
        ],


      defaultStyle: {
        font:
          "Roboto",

        fontSize:
          9,

        color:
          COLORS.text,
      },


      content: [

        // ========================================================
        // Header
        // ========================================================

        {
          table: {
            widths: [
              130,
              "*",
              80,
            ],

            body: [
              [
                logo
                  ? {
                      image:
                        logo,

                      fit:
                        [
                          88,
                          50,
                        ],

                      border:
                        [
                          false,
                          false,
                          false,
                          false,
                        ],
                    }
                  : {
                      text:
                        "",

                      border:
                        [
                          false,
                          false,
                          false,
                          false,
                        ],
                    },


                {
                  text:
                    "Daily Breakage Detail Report",

                  style:
                    "title",

                  alignment:
                    "center",

                  margin:
                    [
                      0,
                      18,
                      0,
                      0,
                    ],

                  border:
                    [
                      false,
                      false,
                      false,
                      false,
                    ],
                },


                {
                  text:
                    "",

                  border:
                    [
                      false,
                      false,
                      false,
                      false,
                    ],
                },
              ],
            ],
          },

          layout:
            "noBorders",
        },


        // ========================================================
        // Header Line
        // ========================================================

        {
          canvas: [
            {
              type:
                "line",

              x1:
                0,

              y1:
                0,

              x2:
                551,

              y2:
                0,

              lineWidth:
                0.8,

              lineColor:
                COLORS.navy,
            },
          ],

          margin:
            [
              0,
              7,
              0,
              14,
            ],
        },


        // ========================================================
        // Daily Breakage Details
        // ========================================================

        sectionHeading(
          "Daily Breakage Details",
        ),


        {
          table: {
            widths: [
              115,
              "*",
              115,
              "*",
            ],

           body: [

  // ==================================================
  // Row 1
  // ==================================================

  [
    labelCell(
      "Organization",
      "organization",
    ),

    valueCell(
      detail.OrganizationShortName ||
      detail.OrganizationName,
    ),

    labelCell(
      "Entry Date",
      "calendar",
    ),

    valueCell(
      detail.EntryDate,
    ),
  ],


  // ==================================================
  // Row 2
  // ==================================================

  [
    labelCell(
      "Outlet",
      "location",
    ),

    valueCell(
      detail.Outlet,
    ),

    labelCell(
      "Total Items",
      "quantity",
    ),

    valueCell(
      detail.TotalItems,
    ),
  ],
],
          },

          layout:
            tableLayout,

          margin:
            [
              0,
              0,
              0,
              15,
            ],
        },


        // ========================================================
        // Breakage Item Details
        // ========================================================

        sectionHeading(
          "Breakage Item Details",
        ),


        {
          table: {
            headerRows:
              1,

            dontBreakRows:
              true,

            widths: [
              42,
              "*",
              55,
              140,
              90,
            ],

            body:
              breakageDetailsBody,
          },


          layout: {
            hLineColor:
              () =>
                COLORS.border,

            vLineColor:
              () =>
                COLORS.border,

            hLineWidth:
              () =>
                0.7,

            vLineWidth:
              () =>
                0.7,

            paddingLeft:
              () =>
                8,

            paddingRight:
              () =>
                8,

            paddingTop:
              () =>
                7,

            paddingBottom:
              () =>
                7,
          },
        },
      ],


      // ==========================================================
      // Footer
      // ==========================================================

      footer:
        () => ({
          margin:
            [
              22,
              8,
              22,
              0,
            ],

          stack: [
            {
              canvas: [
                {
                  type:
                    "line",

                  x1:
                    0,

                  y1:
                    0,

                  x2:
                    551,

                  y2:
                    0,

                  lineWidth:
                    0.7,

                  lineColor:
                    COLORS.navy,
                },
              ],

              margin:
                [
                  0,
                  0,
                  0,
                  8,
                ],
            },


            {
              columns: [
                {
                  stack: [
                    {
                      text:
                        "Powered by HotelOps",

                      bold:
                        true,

                      color:
                        COLORS.navy,

                      fontSize:
                        8,
                    },
                  ],
                },


                {
                  width:
                    130,

                  stack: [
                    {
                      text:
                        `Generated On   :  ${generatedOn}`,

                      fontSize:
                        7,

                      color:
                        COLORS.label,
                    },
                  ],
                },
              ],
            },
          ],
        }),


      // ==========================================================
      // Styles
      // ==========================================================

      styles: {

        title: {
          fontSize:
            18,

          bold:
            true,

          color:
            COLORS.navy,
        },


        fieldLabel: {
          fontSize:
            8.5,

          bold:
            true,

          color:
            COLORS.label,
        },


        fieldValue: {
          fontSize:
            9,

          color:
            COLORS.text,
        },


        tableHeader: {
          fontSize:
            8.5,

          bold:
            true,

          color:
            COLORS.navy,

          fillColor:
            COLORS.labelBackground,

          margin:
            [
              0,
              2,
              0,
              2,
            ],
        },


        tableValue: {
          fontSize:
            8.5,

          color:
            COLORS.text,

          margin:
            [
              0,
              2,
              0,
              2,
            ],
        },


        tableTotal: {
          fontSize:
            8.5,

          bold:
            true,

          color:
            COLORS.navy,

          fillColor:
            COLORS.labelBackground,

          margin:
            [
              0,
              2,
              0,
              2,
            ],
        },
      },
    };


    // ============================================================
    // Generate PDF Buffer
    // ============================================================

    const pdfBuffer =
      await new Promise(
        (
          resolve,
          reject,
        ) => {
          try {

            const pdfDocument =
              new PdfPrinter(
                DAILY_BREAKAGE_DETAIL_PDF_FONTS,
              )
                .createPdfKitDocument(
                  documentDefinition,
                );


            const chunks = [];


            pdfDocument.on(
              "data",
              (chunk) =>
                chunks.push(
                  chunk,
                ),
            );


            pdfDocument.on(
              "end",
              () =>
                resolve(
                  Buffer.concat(
                    chunks,
                  ),
                ),
            );


            pdfDocument.on(
              "error",
              reject,
            );


            pdfDocument.end();

          } catch (error) {
            reject(error);
          }
        },
      );


    // ============================================================
    // Return
    // ============================================================

    return {
      success:
        true,

      message:
        "Daily Breakage detail PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Daily-Breakage-Detail-${dailyBreakageID}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {

    console.error(
      "Generate Daily Breakage detail PDF error:",
      error,
    );


    return databaseFailure(
      error,
      "Generate Daily Breakage detail PDF",
    );
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
  getDailyBreakageOutlets,
  getDailyBreakageSummaryReport,
  getDailyBreakageOutletWiseReport,
  getDailyBreakagePersonResponsibleReport,
  getDailyBreakagePersonResponsible,
  generateDailyBreakageListPdf,
  generateDailyBreakageOutletWiseReportPdf,
  generateDailyBreakagePersonResponsibleReportPdf,
  generateDailyBreakageDetailPdf
};
