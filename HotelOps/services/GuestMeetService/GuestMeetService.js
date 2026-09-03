const { pool } = require("../../db");
const {retryableDatabaseResponse} = require("../../utils/retryableDatabaseError");
const { formatDate } = require("../../utils/dateFormatter");
const { generatePdf } = require("../../utils/pdfHelper");

// ============================================================ Shared Responses(Success,Fail Massege Helper)
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

// ============================================================ Database Row Mapping(Get,Post Apis Helpers)
// PostgreSQL returns unquoted column keys in lowercase; map them to API casing here.
const mapDetail = (row) => ({
  GMDetailID: Number(row.gmdetailid),
  OrganizationID: Number(row.organizationid),
  GMMasterID: Number(row.gmmasterid),
  GuestName: row.guestname,
  RoomNo: row.roomno,
  BookingSource: row.bookingsource,
  Arrival: formatDate(row.arrival),
  Departure: formatDate(row.departure),
  Feedback: row.feedback,
  ActionTaken: row.actiontaken,
  MetBy: row.metby == null ? null : Number(row.metby),
  MetOn: row.meton,
  FeedbackType: row.feedbacktype,
  GuestStatus: row.gueststatus,
  CreatedDate: formatDate(row.createddate),
});
const mapMaster = (row) => ({
  GMMasterID: Number(row.gmmasterid),
  OrganizationID: Number(row.organizationid),
  EntryDate: formatDate(row.entrydate),
  Roomsinhouse: row.roomsinhouse,
  Guestsinhouse: row.guestsinhouse,
  Arrivals: row.arrivals,
  Departures: row.departures,
  Occupancy: row.occupancy == null ? null : Number(row.occupancy),
  CreatedDate: formatDate(row.createddate),
  GuestDetails: [],
});
// Fetch all details for a page of masters in one query to avoid N+1 queries.
const attachDetails = async (rows) => {
  if (!rows.length) return [];
  const ids = rows.map((row) => Number(row.gmmasterid));
  const details = await pool.query(
    `SELECT * FROM GuestMeet_Daily_Entry_Details
     WHERE GMMasterID = ANY($1::bigint[]) AND IsDeleted = FALSE
     ORDER BY GMMasterID, GMDetailID;`,
    [ids],
  );
  const mapped = new Map(
    rows.map((row) => {
      const master = mapMaster(row);
      return [master.GMMasterID, master];
    }),
  );
  for (const row of details.rows)
    mapped.get(Number(row.gmmasterid))?.GuestDetails.push(mapDetail(row));
  return rows.map((row) => mapped.get(Number(row.gmmasterid)));
};
// Add only supplied organization/date filters while keeping every value parameterized.
const addDateFilters = (data, values, alias = "m") => {
  const conditions = [];
  const add = (column, value, operator = "=") => {
    if (value !== null && value !== undefined) {
      values.push(value);
      conditions.push(`${alias}.${column} ${operator} $${values.length}`);
    }
  };
  add("OrganizationID", data.OrganizationID);
  add("EntryDate", data.EntryDate);
  add("EntryDate", data.FromDate, ">=");
  add("EntryDate", data.ToDate, "<=");
  return conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
};

// ============================================================ Create or Update Daily Entry
// An advisory transaction lock prevents concurrent duplicate active rows for org/date.
const createDailyEntry = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

   // EntryDate frontend body se aa rahi hai
    const entryDate = data.EntryDate; 

    // Lock based on Organization + Current Date
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1));",
      [`GuestMeet:${data.OrganizationID}:${entryDate}`]
    );

    const existing = await client.query(
      `SELECT GMMasterID
       FROM GuestMeet_Daily_Entry_Master
       WHERE OrganizationID = $1
         AND EntryDate = $2
         AND IsDeleted = FALSE
       ORDER BY GMMasterID
       LIMIT 1
       FOR UPDATE;`,
      [data.OrganizationID, entryDate]
    );

    let result;
    let created;

    const values = [
      data.Roomsinhouse,
      data.Guestsinhouse,
      data.Arrivals,
      data.Departures,
      data.Occupancy,
    ];

    if (existing.rows.length) {
      created = false;

      result = await client.query(
        `UPDATE GuestMeet_Daily_Entry_Master
         SET
           Roomsinhouse = $1,
           Guestsinhouse = $2,
           Arrivals = $3,
           Departures = $4,
           Occupancy = $5,
           ModifiedBy = $6,
           ModifiedDate = CURRENT_TIMESTAMP
         WHERE GMMasterID = $7
           AND IsDeleted = FALSE
         RETURNING *;`,
        [
          ...values,
          data.UserID,
          existing.rows[0].gmmasterid
        ]
      );
    } else {
      created = true;

      result = await client.query(
        `INSERT INTO GuestMeet_Daily_Entry_Master
         (
           OrganizationID,
           EntryDate,
           Roomsinhouse,
           Guestsinhouse,
           Arrivals,
           Departures,
           Occupancy,
           IsDeleted,
           CreatedBy,
           CreatedDate
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8,CURRENT_TIMESTAMP)
         RETURNING *;`,
        [
          data.OrganizationID,
          entryDate,
          ...values,
          data.UserID
        ]
      );
    }

    await client.query("COMMIT");

    return ok(
      created
        ? "Guest Meet daily entry created successfully."
        : "Guest Meet daily entry updated successfully.",
      // mapMaster(result.rows[0]),
      // { created }
    );

  } catch (error) {
    await client.query("ROLLBACK");
    return databaseFailure(error, "Save Guest Meet daily entry");
  } finally {
    client.release();
  }
};
// ============================================================ Get One Daily Entry
// Organization/date select one master; pagination applies only to its guest details.
const getAllDailyEntries = async (data) => {
  try {
    const page = Number(data.page) || 1;
    const pageSize = Number(data.PageSize) || 10;
    const offset = (page - 1) * pageSize;

    // Without both exact filters, return the normal paginated daily-entry list.
    if (!data.OrganizationID || !data.EntryDate) {
      const values = [];
      const filter = addDateFilters(data, values);
      const countResult = await pool.query(
        `SELECT COUNT(*)::bigint AS TotalCount
         FROM GuestMeet_Daily_Entry_Master m
         WHERE m.IsDeleted = FALSE${filter};`,
        values,
      );

      const totalCount = Number(countResult.rows[0].totalcount);
      values.push(pageSize, offset);
      const masterResult = await pool.query(
        `SELECT *
         FROM GuestMeet_Daily_Entry_Master m
         WHERE m.IsDeleted = FALSE${filter}
         ORDER BY m.EntryDate DESC, m.GMMasterID DESC
         LIMIT $${values.length - 1} OFFSET $${values.length};`,
        values,
      );

      const records = await attachDetails(masterResult.rows);
      return ok("Guest Meet daily entries fetched successfully.", records, {
        TotalCount: totalCount,
        PageCount: records.length,
        CurrentPage: page,
        PageSize: pageSize,
        TotalPages: Math.ceil(totalCount / pageSize),
      });
    }

    const masterResult = await pool.query(
      `SELECT *
       FROM GuestMeet_Daily_Entry_Master
       WHERE OrganizationID = $1
         AND EntryDate = $2
         AND IsDeleted = FALSE
       ORDER BY GMMasterID
       LIMIT 1;`,
      [data.OrganizationID, data.EntryDate],
    );

    if (!masterResult.rows.length) {
      return ok("Guest Meet daily entry fetched successfully.", [], {
        TotalCount: 0,
        PageCount: 0,
        CurrentPage: page,
        PageSize: pageSize,
        TotalPages: 0,
      });
    }

    const master = mapMaster(masterResult.rows[0]);

    const [countResult, detailsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::bigint AS TotalCount
         FROM GuestMeet_Daily_Entry_Details
         WHERE GMMasterID = $1 AND IsDeleted = FALSE;`,
        [master.GMMasterID],
      ),
      pool.query(
        `SELECT *
         FROM GuestMeet_Daily_Entry_Details
         WHERE GMMasterID = $1 AND IsDeleted = FALSE
         ORDER BY GMDetailID ASC
         LIMIT $2 OFFSET $3;`,
        [master.GMMasterID, pageSize, offset],
      ),
    ]);

    const totalCount = Number(countResult.rows[0].totalcount);
    master.GuestDetails = detailsResult.rows.map(mapDetail);

    return ok("Guest Meet daily entry fetched successfully.", [master], {
      TotalCount: totalCount,
      PageCount: master.GuestDetails.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    return databaseFailure(error, "Fetch Guest Meet daily entry");
  }
};
// ============================================================ Delete Daily Entry
// Soft-delete the master and all active child details in the same transaction.
const deleteDailyEntry = async (data) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const master = await client.query(
      `UPDATE GuestMeet_Daily_Entry_Master SET IsDeleted=TRUE, DeletedBy=$1, DeletedDate=CURRENT_TIMESTAMP,
       ModifiedBy=$1, ModifiedDate=CURRENT_TIMESTAMP WHERE GMMasterID=$2 AND IsDeleted=FALSE RETURNING GMMasterID;`,
      [data.UserID, data.GMMasterID],
    );
    if (!master.rows.length) {
      await client.query("ROLLBACK");
      return fail("Guest Meet daily entry not found.", 404);
    }
    await client.query(
      `UPDATE GuestMeet_Daily_Entry_Details SET IsDeleted=TRUE, DeletedBy=$1, DeletedDate=CURRENT_TIMESTAMP,
       ModifiedBy=$1, ModifiedDate=CURRENT_TIMESTAMP WHERE GMMasterID=$2 AND IsDeleted=FALSE;`,
      [data.UserID, data.GMMasterID],
    );
    await client.query("COMMIT");
    return ok("Guest Meet daily entry deleted successfully.", {
      GMMasterID: data.GMMasterID,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return databaseFailure(error, "Delete Guest Meet daily entry");
  } finally {
    client.release();
  }
};

// ===========================================================Helper for update
// Whitelist database columns that the guest partial-update API may change.
const detailFields = {
  GuestName: "GuestName",
  RoomNo: "RoomNo",
  BookingSource: "BookingSource",
  Arrival: "Arrival",
  Departure: "Departure",
  Feedback: "Feedback",
  ActionTaken: "ActionTaken",
  MetBy: "MetBy",
  MetOn: "MetOn",
  FeedbackType: "FeedbackType",
  GuestStatus: "GuestStatus",
};
// ============================================================ Create Guest Detail
// The parent must be active and belong to the OrganizationID supplied in the request.
const createGuestDetail = async (data) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const master = await client.query(
      `SELECT 1 FROM GuestMeet_Daily_Entry_Master WHERE GMMasterID=$1 AND OrganizationID=$2 AND IsDeleted=FALSE FOR UPDATE;`,
      [data.GMMasterID, data.OrganizationID],
    );
    if (!master.rows.length) {
      await client.query("ROLLBACK");
      return fail(
        "Active Guest Meet daily entry not found for this organization.",
        404,
      );
    }
    const result = await client.query(
      `INSERT INTO GuestMeet_Daily_Entry_Details
       (OrganizationID,GMMasterID,GuestName,RoomNo,BookingSource,Arrival,Departure,Feedback,ActionTaken,MetBy,MetOn,FeedbackType,GuestStatus,IsDeleted,CreatedBy,CreatedDate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE,$14,CURRENT_TIMESTAMP) RETURNING *;`,
      [
        data.OrganizationID,
        data.GMMasterID,
        data.GuestName,
        data.RoomNo,
        data.BookingSource,
        data.Arrival,
        data.Departure,
        data.Feedback,
        data.ActionTaken,
        data.MetBy,
        data.MetOn,
        data.FeedbackType,
        data.GuestStatus,
        data.UserID,
      ],
    );
    await client.query("COMMIT");
    return ok("Guest detail created successfully.", );
  } catch (error) {
    await client.query("ROLLBACK");
    return databaseFailure(error, "Create Guest Meet detail");
  } finally {
    client.release();
  }
};
// ============================================================ Update Guest Detail
const updateGuestDetail = async (data) => {
  try {
    const assignments = [];
    const values = [];
    for (const [field, column] of Object.entries(detailFields)) {
      if (Object.prototype.hasOwnProperty.call(data.Changes, field)) {
        values.push(data.Changes[field]);
        assignments.push(`${column}=$${values.length}`);
      }
    }
    if (!assignments.length)
      return fail("No guest detail changes were provided.", 400);
    values.push(data.UserID, data.GMDetailID);
    const result = await pool.query(
      `UPDATE GuestMeet_Daily_Entry_Details SET ${assignments.join(",")},
       ModifiedBy=$${values.length - 1}, ModifiedDate=CURRENT_TIMESTAMP
       WHERE GMDetailID=$${values.length} AND IsDeleted=FALSE RETURNING *;`,
      values,
    );
    if (!result.rows.length) return fail("Guest detail not found.", 404);
    return ok("Guest detail updated successfully.");
  } catch (error) {
    return databaseFailure(error, "Update Guest Meet detail");
  }
};
// ============================================================ Delete Guest Detail
// Guest records are retained and marked deleted for audit/history purposes.
const deleteGuestDetail = async (data) => {
  try {
    const result = await pool.query(
      `UPDATE GuestMeet_Daily_Entry_Details SET IsDeleted=TRUE, DeletedBy=$1, DeletedDate=CURRENT_TIMESTAMP,
       ModifiedBy=$1, ModifiedDate=CURRENT_TIMESTAMP WHERE GMDetailID=$2 AND IsDeleted=FALSE RETURNING GMDetailID;`,
      [data.UserID, data.GMDetailID],
    );
    if (!result.rows.length) return fail("Guest detail not found.", 404);
    return ok("Guest detail deleted successfully.");
  } catch (error) {
    return databaseFailure(error, "Delete Guest Meet detail");
  }
};
// ============================================================ Get Guest Detail By ID
const getGuestDetailById = async (data) => {
  try {
    const result = await pool.query(
      `SELECT * FROM GuestMeet_Daily_Entry_Details WHERE GMDetailID=$1 AND IsDeleted=FALSE LIMIT 1;`,
      [data.GMDetailID],
    );
    if (!result.rows.length) return fail("Guest detail not found.", 404);
    return ok("Guest detail fetched successfully.", mapDetail(result.rows[0]));
  } catch (error) {
    return databaseFailure(error, "Fetch Guest Meet detail");
  }
};

// =============================================================================Date Range Report
// Keep date-range reporting independent from the single-day guest-pagination API.
const getDateRangeReport = async (data) => {
  try {
    if (!data.OrganizationID || !data.FromDate || !data.ToDate) {
      return fail("OrganizationID, FromDate and ToDate are required.", 400);
    }

    if (data.FromDate > data.ToDate) {
      return fail("FromDate cannot be greater than ToDate.", 400);
    }

    const parameters = [data.OrganizationID, data.FromDate, data.ToDate];
    const page = Number(data.page) || 1;
    const pageSize = Number(data.PageSize) || 10;
    const offset = (page - 1) * pageSize;

    const masterResult = await pool.query(
      `SELECT
         ARRAY_AGG(m.GMMasterID ORDER BY m.EntryDate DESC, m.GMMasterID DESC) AS GMMasterIDs,
         COALESCE(SUM(m.Roomsinhouse), 0)::bigint AS Roomsinhouse,
         COALESCE(SUM(m.Guestsinhouse), 0)::bigint AS Guestsinhouse,
         COALESCE(SUM(m.Arrivals), 0)::bigint AS Arrivals,
         COALESCE(SUM(m.Departures), 0)::bigint AS Departures,
         COALESCE(AVG(m.Occupancy), 0)::numeric(10,2) AS Occupancy,
         (ARRAY_AGG(m.CreatedDate ORDER BY m.EntryDate DESC, m.GMMasterID DESC))[1] AS CreatedDate
       FROM GuestMeet_Daily_Entry_Master m
       WHERE m.OrganizationID = $1
         AND m.EntryDate BETWEEN $2 AND $3
         AND m.IsDeleted = FALSE;`,
      parameters,
    );

    const master = masterResult.rows[0];
    if (!master.gmmasterids) {
      return ok("Guest Meet date range report fetched successfully.", [], {
        TotalCount: 0,
        PageCount: 0,
        CurrentPage: page,
        PageSize: pageSize,
        TotalPages: 0,
      });
    }

    const [countResult, detailsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::bigint AS TotalCount
         FROM GuestMeet_Daily_Entry_Details d
         INNER JOIN GuestMeet_Daily_Entry_Master m
           ON m.GMMasterID = d.GMMasterID
          AND m.IsDeleted = FALSE
         WHERE m.OrganizationID = $1
           AND m.EntryDate BETWEEN $2 AND $3
           AND d.IsDeleted = FALSE;`,
        parameters,
      ),
      pool.query(
        `SELECT d.*
         FROM GuestMeet_Daily_Entry_Details d
         INNER JOIN GuestMeet_Daily_Entry_Master m
           ON m.GMMasterID = d.GMMasterID
          AND m.IsDeleted = FALSE
         WHERE m.OrganizationID = $1
           AND m.EntryDate BETWEEN $2 AND $3
           AND d.IsDeleted = FALSE
         ORDER BY m.EntryDate DESC, m.GMMasterID DESC, d.GMDetailID ASC
         LIMIT $4 OFFSET $5;`,
        [...parameters, pageSize, offset],
      ),
    ]);

    const masterIDs = master.gmmasterids.map(Number);
    const totalCount = Number(countResult.rows[0].totalcount);

    const report = {
      GMMasterID: masterIDs[masterIDs.length - 1],
      OrganizationID: Number(data.OrganizationID),
      EntryDateFrom: formatDate(data.FromDate),
      EntryDateTo: formatDate(data.ToDate),
      Roomsinhouse: Number(master.roomsinhouse),
      Guestsinhouse: Number(master.guestsinhouse),
      Arrivals: Number(master.arrivals),
      Departures: Number(master.departures),
      Occupancy: Number(master.occupancy),
      CreatedDate: formatDate(master.createddate),
      GuestDetails: detailsResult.rows.map(mapDetail),
    };

    return ok("Guest Meet date range report fetched successfully.", [report], {
      TotalCount: totalCount,
      PageCount: report.GuestDetails.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    return databaseFailure(error, "Generate Guest Meet date range report");
  }
};
// ============================================================ Feedback Report
// Group active guest details by their normalized feedback type in PostgreSQL.
const getFeedbackReport = async (data) => {
  try {
    const values = [];
    const filter = addDateFilters(data, values);
    const result = await pool.query(
      `WITH FeedbackCounts AS
       (
         SELECT
           m.OrganizationID,
           om.ShortName,
           COALESCE(NULLIF(TRIM(d.FeedbackType), ''), 'Unspecified') AS FeedbackType,
           COUNT(*)::bigint AS TotalGuests
         FROM GuestMeet_Daily_Entry_Master m
         INNER JOIN GuestMeet_Daily_Entry_Details d
           ON d.GMMasterID = m.GMMasterID
          AND d.IsDeleted = FALSE
         INNER JOIN Organization_Master om
           ON om.OrganizationID = m.OrganizationID
         WHERE m.IsDeleted = FALSE${filter}
         GROUP BY
           m.OrganizationID,
           om.ShortName,
           COALESCE(NULLIF(TRIM(d.FeedbackType), ''), 'Unspecified')
       )
       SELECT
         OrganizationID,
         ShortName,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'FeedbackType', FeedbackType,
             'TotalGuests', TotalGuests
           )
           ORDER BY TotalGuests DESC, FeedbackType
         ) AS FeedbackData
       FROM FeedbackCounts
       GROUP BY OrganizationID, ShortName
       ORDER BY ShortName, OrganizationID;`,
      values,
    );
    return ok(
      "Guest Meet feedback report fetched successfully.",
      result.rows.map((row) => ({
        OrganizationID: Number(row.organizationid),
        ShortName: row.shortname,
        FeedbackData: row.feedbackdata,
      })),
    );
  } catch (error) {
    return databaseFailure(error, "Generate Guest Meet feedback report");
  }
};
// ============================================================ Met By Report
// Join user_master only for the employee display name; MetBy remains the group key.
const getMetByReport = async (data) => {
  try {
    const values = [];
    const filter = addDateFilters(data, values);
    const result = await pool.query(
      `SELECT d.MetBy, um.FullName, COUNT(*)::bigint AS TotalGuestsMet
       FROM GuestMeet_Daily_Entry_Master m
       JOIN GuestMeet_Daily_Entry_Details d ON d.GMMasterID=m.GMMasterID AND d.IsDeleted=FALSE
       LEFT JOIN user_master um ON um.UserID=d.MetBy
       WHERE m.IsDeleted=FALSE AND d.MetBy IS NOT NULL${filter}
       GROUP BY d.MetBy, um.FullName ORDER BY TotalGuestsMet DESC, um.FullName;`,
      values,
    );
    return ok(
      "Guest Meet Met By report fetched successfully.",
      result.rows.map((row) => ({
        MetBy: Number(row.metby),
        FullName: row.fullname,
        TotalGuestsMet: Number(row.totalguestsmet),
      })),
    );
  } catch (error) {
    return databaseFailure(error, "Generate Guest Meet Met By report");
  }
};

// =============================================================Date Range Report PDF
const generateDateRangeReportPdf = async (data) => {
  try {
    // ============================================================
    // VALIDATION
    // ============================================================

    if (
      !data.OrganizationID ||
      !data.FromDate ||
      !data.ToDate
    ) {
      return {
        success: false,
        message:
          "OrganizationID, FromDate and ToDate are required.",
        statusCode: 400,
      };
    }

    if (data.FromDate > data.ToDate) {
      return {
        success: false,
        message:
          "FromDate cannot be greater than ToDate.",
        statusCode: 400,
      };
    }

    const parameters = [
      data.OrganizationID,
      data.FromDate,
      data.ToDate,
    ];

    // ============================================================
    // MASTER SUMMARY
    // Same query as getDateRangeReport
    // ============================================================

    const masterResult = await pool.query(
      `
      SELECT
        ARRAY_AGG(
          m.GMMasterID
          ORDER BY
            m.EntryDate DESC,
            m.GMMasterID DESC
        ) AS GMMasterIDs,

        COALESCE(
          SUM(m.Roomsinhouse),
          0
        )::bigint AS Roomsinhouse,

        COALESCE(
          SUM(m.Guestsinhouse),
          0
        )::bigint AS Guestsinhouse,

        COALESCE(
          SUM(m.Arrivals),
          0
        )::bigint AS Arrivals,

        COALESCE(
          SUM(m.Departures),
          0
        )::bigint AS Departures,

        COALESCE(
          AVG(m.Occupancy),
          0
        )::numeric(10,2) AS Occupancy,

        (
          ARRAY_AGG(
            m.CreatedDate
            ORDER BY
              m.EntryDate DESC,
              m.GMMasterID DESC
          )
        )[1] AS CreatedDate

      FROM GuestMeet_Daily_Entry_Master m

      WHERE m.OrganizationID = $1
        AND m.EntryDate BETWEEN $2 AND $3
        AND m.IsDeleted = FALSE;
      `,
      parameters,
    );

    const master = masterResult.rows[0];

    // ============================================================
    // GUEST DETAILS
    // Same query without LIMIT / OFFSET
    // ============================================================

    const detailsResult = await pool.query(
  `
  SELECT
    d.*,
    um.FullName AS MetByName

  FROM GuestMeet_Daily_Entry_Details d

  INNER JOIN GuestMeet_Daily_Entry_Master m
    ON m.GMMasterID = d.GMMasterID
   AND m.IsDeleted = FALSE

  LEFT JOIN user_master um
    ON um.UserID = d.MetBy
   AND um.IsDeleted = FALSE

  WHERE m.OrganizationID = $1
    AND m.EntryDate BETWEEN $2 AND $3
    AND d.IsDeleted = FALSE

  ORDER BY
    m.EntryDate DESC,
    m.GMMasterID DESC,
    d.GMDetailID ASC;
  `,
  parameters,
);

    // ============================================================
    // MAP DETAILS
    // Same mapper as GET API
    // ============================================================

    const guestDetails =
      detailsResult.rows.map(mapDetail);

    const organizationId =
      Number(data.OrganizationID);

    // ============================================================
    // PDF COLUMNS
    // ============================================================

    const columns = [
      {
        header: "Guest Name",
        value: (row) => row.GuestName,
        width: 75,
      },
      {
        header: "RN#.",
        value: (row) => row.RoomNo,
        width: 30,
        align: "center",
      },
      {
        header: "Booking Source",
        value: (row) => row.BookingSource,
        width: 60,
      },
      {
        header: "Arrival",
        value: (row) => row.Arrival,
        width: 55,
        align: "center",
      },
      {
        header: "Departure",
        value: (row) => row.Departure,
        width: 55,
        align: "center",
      },
      {
        header: "Feedback",
        value: (row) => row.Feedback,
        width: 105,
      },
      {
        header: "Action Taken",
        value: (row) => row.ActionTaken,
        width: 105,
      },
      {
        header: "Met By",
        value: (row) => row.MetBy,
        width: 45,
        align: "center",
      },
      {
        header: "Met On",
        value: (row) => row.MetOn,
        width: 55,
        align: "center",
      },
      {
        header: "Feedback",
        value: (row) => row.FeedbackType,
        width: 50,
        align: "center",
      },
      {
        header: "Guest Status",
        value: (row) => row.GuestStatus,
        width: 55,
        align: "center",
      },
      
    ];

    // ============================================================
    // METADATA
    // ============================================================

    const metadata = [
      {
        label: "Filters",
        value:
          `From Date: ${formatDate(data.FromDate)}` +
          `    |    To Date: ${formatDate(data.ToDate)}`,
      },
      {
        label: "Total Records",
        value: guestDetails.length,
      },
      {
        label: "Rooms In House",
        value: Number(master?.roomsinhouse || 0),
      },
      {
        label: "Guests In House",
        value: Number(master?.guestsinhouse || 0),
      },
      {
        label: "Arrivals",
        value: Number(master?.arrivals || 0),
      },
      {
        label: "Departures",
        value: Number(master?.departures || 0),
      },
      {
        label: "Avg. Occupancy",
        value: `${Number(master?.occupancy || 0)}%`,
      },
      {
        label: "Created Date",
        value: master?.createddate
          ? formatDate(master.createddate)
          : "-",
      },
    ];

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer = await generatePdf({
      title: "GUEST MEET DATE RANGE REPORT",

      reportName:
        "Guest Meet Date Range Report",

      organizationId,

      logoUrl:
        data.logoUrl,

      orientation:
        "landscape",

      metadata,

      columns,

      rows:
        guestDetails,

      pageMargins:
        [20, 25, 20, 35],
    });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Guest Meet date range PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Guest_Meet_Date_Range_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Guest Meet Date Range PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate Guest Meet date range PDF.",

      statusCode:
        503,
    };
  }
};
// ============================================================ Feedback Report Pdf
const generateFeedbackReportPdf = async (data) => {
  try {
    // ============================================================
    // FILTERS
    // Same filters as getFeedbackReport
    // ============================================================

    const values = [];
    const filter = addDateFilters(data, values);

    // ============================================================
    // FEEDBACK REPORT QUERY
    // ============================================================

    const result = await pool.query(
      `
      WITH FeedbackCounts AS
      (
        SELECT
          m.OrganizationID,
          om.ShortName,

          COALESCE(
            NULLIF(
              TRIM(d.FeedbackType),
              ''
            ),
            'Unspecified'
          ) AS FeedbackType,

          COUNT(*)::bigint AS TotalGuests

        FROM GuestMeet_Daily_Entry_Master m

        INNER JOIN GuestMeet_Daily_Entry_Details d
          ON d.GMMasterID = m.GMMasterID
         AND d.IsDeleted = FALSE

        INNER JOIN Organization_Master om
          ON om.OrganizationID = m.OrganizationID

        WHERE m.IsDeleted = FALSE
          ${filter}

        GROUP BY
          m.OrganizationID,
          om.ShortName,

          COALESCE(
            NULLIF(
              TRIM(d.FeedbackType),
              ''
            ),
            'Unspecified'
          )
      )

      SELECT
        OrganizationID,
        ShortName,

        JSON_AGG(
          JSON_BUILD_OBJECT(
            'FeedbackType',
            FeedbackType,
            'TotalGuests',
            TotalGuests
          )
          ORDER BY
            TotalGuests DESC,
            FeedbackType
        ) AS FeedbackData

      FROM FeedbackCounts

      GROUP BY
        OrganizationID,
        ShortName

      ORDER BY
        ShortName,
        OrganizationID;
      `,
      values,
    );

    // ============================================================
    // MAP QUERY RESULT
    // ============================================================

    const reportData = result.rows.map((row) => ({
      OrganizationID:
        Number(row.organizationid),

      ShortName:
        row.shortname,

      FeedbackData:
        row.feedbackdata || [],
    }));

    // ============================================================
    // ORGANIZATION-WISE FEEDBACK COUNTS
    // Negative and Positive as separate columns
    // ============================================================

    const feedbackRows = reportData.map((organization) => {
      const feedbackCounts = {};

      for (const feedback of organization.FeedbackData) {
        const feedbackType = String(
          feedback.FeedbackType || "Unspecified",
        )
          .trim()
          .toUpperCase();

        feedbackCounts[feedbackType] =
          Number(feedback.TotalGuests || 0);
      }

      return {
        OrganizationID:
          organization.OrganizationID,

        ShortName:
          organization.ShortName,

        Negative:
          feedbackCounts.NEGATIVE || 0,

        Positive:
          feedbackCounts.POSITIVE || 0,
      };
    });

    // ============================================================
    // ORGANIZATION FOR LOGO
    // ============================================================

    const organizationId =
      data.OrganizationID ||
      reportData[0]?.OrganizationID ||
      null;

    // ============================================================
    // PDF COLUMNS
    // ============================================================

    const columns = [
      {
        header: "Organization",
        value: (row) => row.ShortName,
        width: "*",
      },
      {
        header: "Negative Feedback",
        value: (row) => row.Negative,
        width: "*",
        align: "center",
        bold: true,
      },
      {
        header: "Positive Feedback",
        value: (row) => row.Positive,
        width: "*",
        align: "center",
        bold: true,
      },
    ];

    // ============================================================
    // METADATA FILTER VALUES
    // ============================================================

    const organizationFilter =
      data.OrganizationID
        ? data.OrganizationID
        : "All Organizations";

    const fromDateFilter =
      data.FromDate
        ? formatDate(data.FromDate)
        : "All";

    const toDateFilter =
      data.ToDate
        ? formatDate(data.ToDate)
        : "All";

    // Same count as the original feedback report:
    // one record per organization and feedback type
    const totalRecords = reportData.reduce(
      (total, organization) =>
        total + organization.FeedbackData.length,
      0,
    );

    // ============================================================
    // PDF METADATA
    // Filters first line and Total Records second line
    // ============================================================

    const metadata = [
  {
    label: "Organization",
    value: organizationFilter,
  },
  {
    label: "From Date",
    value: fromDateFilter,
  },
  {
    label: "To Date",
    value: toDateFilter,
  },
  {
    label: "Total Records",
    value: totalRecords,
  },
];

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer = await generatePdf({
      title:
        "GUEST MEET FEEDBACK REPORT",

      reportName:
        "Guest Meet Feedback Report",

      organizationId,

      logoUrl:
        data.logoUrl,

      orientation:
        "portrait",

      metadata,

      columns,

      rows:
        feedbackRows,

      pageMargins:
        [24, 26, 24, 34],
    });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Guest Meet feedback PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Guest_Meet_Feedback_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Guest Meet Feedback PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate Guest Meet feedback PDF.",

      statusCode:
        503,
    };
  }
};
// ============================================================ Met By Report Pdf
const generateMetByReportPdf = async (data) => {
  try {
    // ============================================================
    // FILTERS
    // Same filters as getMetByReport
    // ============================================================

    const values = [];
    const filter = addDateFilters(data, values);

    // ============================================================
    // MET BY REPORT QUERY
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        d.MetBy,
        um.FullName,
        COUNT(*)::bigint AS TotalGuestsMet

      FROM GuestMeet_Daily_Entry_Master m

      INNER JOIN GuestMeet_Daily_Entry_Details d
        ON d.GMMasterID = m.GMMasterID
       AND d.IsDeleted = FALSE

      LEFT JOIN user_master um
        ON um.UserID = d.MetBy

      WHERE m.IsDeleted = FALSE
        AND d.MetBy IS NOT NULL
        ${filter}

      GROUP BY
        d.MetBy,
        um.FullName

      ORDER BY
        TotalGuestsMet DESC,
        um.FullName;
      `,
      values,
    );

    // ============================================================
    // MAP REPORT DATA
    // ============================================================

    const metByRows = result.rows.map((row) => ({
      MetBy:
        Number(row.metby),

      FullName:
        row.fullname || "-",

      TotalGuestsMet:
        Number(row.totalguestsmet),
    }));

    // ============================================================
    // ORGANIZATION FOR LOGO
    // ============================================================

    const organizationId =
      data.OrganizationID || null;

    // ============================================================
    // PDF COLUMNS
    // ============================================================

    const columns = [
      {
        header: "Met By",
        value: (row) => row.FullName,
        width: "*",
      },
      {
        header: "Total Guests Met",
        value: (row) => row.TotalGuestsMet,
        width: 130,
        align: "center",
        bold: true,
      },
    ];

    // ============================================================
    // METADATA VALUES
    // ============================================================

    const organizationFilter =
      data.OrganizationID
        ? data.OrganizationID
        : "All Organizations";

    const fromDateFilter =
      data.FromDate
        ? formatDate(data.FromDate)
        : "All";

    const toDateFilter =
      data.ToDate
        ? formatDate(data.ToDate)
        : "All";

    // ============================================================
    // METADATA
    // ============================================================

    const metadata = [
      {
        label: "Organization",
        value: organizationFilter,
      },
      {
        label: "From Date",
        value: fromDateFilter,
      },
      {
        label: "To Date",
        value: toDateFilter,
      },
      {
        label: "Total Records",
        value: metByRows.length,
      },
    ];

    // ============================================================
    // GENERATE PDF
    // ============================================================

    const pdfBuffer = await generatePdf({
      title:
        "GUEST MEET MET BY REPORT",

      reportName:
        "Guest Meet Met By Report",

      organizationId,

      logoUrl:
        data.logoUrl,

      orientation:
        "portrait",

      metadata,

      columns,

      rows:
        metByRows,

      pageMargins:
        [24, 26, 24, 34],
    });

    // ============================================================
    // RESPONSE
    // ============================================================

    return {
      success: true,

      message:
        "Guest Meet Met By PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `Guest_Meet_Met_By_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };
  } catch (error) {
    console.error(
      "Guest Meet Met By PDF Error:",
      error,
    );

    return {
      success: false,

      message:
        "Unable to generate Guest Meet Met By PDF.",

      statusCode:
        503,
    };
  }
};
// ===============================================================Guest details pdf
const generateGuestDetailPdf = async (data) => {
  try {
    // =========================================================
    // Validate input
    // =========================================================

    const organizationID = Number(data.OrganizationID);
    const gmDetailID = Number(data.GMDetailID);

    if (!Number.isInteger(organizationID) || organizationID <= 0) {
      return fail("Valid OrganizationID is required.", 400);
    }

    if (!Number.isInteger(gmDetailID) || gmDetailID <= 0) {
      return fail("Valid GMDetailID is required.", 400);
    }

    // =========================================================
    // Fetch guest detail
    // =========================================================

    const result = await pool.query(
      `
      SELECT
        d.GMDetailID,
        d.OrganizationID,
        d.GMMasterID,
        d.GuestName,
        d.RoomNo,
        d.BookingSource,
        d.Arrival,
        d.Departure,
        d.Feedback,
        d.ActionTaken,
        d.MetBy,
        d.MetOn,
        d.FeedbackType,
        d.GuestStatus,
        d.CreatedDate,

        m.EntryDate,

        om.OrganizationName,
        om.ShortName AS OrganizationShortName,

        um.FullName AS MetByName

      FROM GuestMeet_Daily_Entry_Details d

      INNER JOIN GuestMeet_Daily_Entry_Master m
        ON m.GMMasterID = d.GMMasterID
        AND m.OrganizationID = d.OrganizationID
        AND m.IsDeleted = FALSE

      INNER JOIN Organization_Master om
        ON om.OrganizationID = d.OrganizationID
        AND om.IsDeleted = FALSE

      LEFT JOIN user_master um
        ON um.UserID = d.MetBy
        AND um.IsDeleted = FALSE

      WHERE d.OrganizationID = $1
        AND d.GMDetailID = $2
        AND d.IsDeleted = FALSE

      LIMIT 1;
      `,
      [organizationID, gmDetailID],
    );

    if (result.rows.length === 0) {
      return fail("Guest detail not found.", 404);
    }

    const row = result.rows[0];

    const guestDetail = {
      GMDetailID: Number(row.gmdetailid),
      OrganizationID: Number(row.organizationid),
      GMMasterID: Number(row.gmmasterid),

      OrganizationName: row.organizationname,
      OrganizationShortName: row.organizationshortname,

      EntryDate: formatDate(row.entrydate),

      GuestName: row.guestname,
      RoomNo: row.roomno,
      BookingSource: row.bookingsource,

      Arrival: formatDate(row.arrival),
      Departure: formatDate(row.departure),

      Feedback: row.feedback,
      ActionTaken: row.actiontaken,

      MetBy: row.metby == null ? null : Number(row.metby),
      MetByName: row.metbyname,
      MetOn: row.meton,

      FeedbackType: row.feedbacktype,
      GuestStatus: row.gueststatus,

      CreatedDate: formatDate(row.createddate),
    };

    // =========================================================
    // Generate PDF
    // =========================================================

    const pdfBuffer = await generatePdf({
      title: "Guest Detail Report",
      reportName: "Guest Detail Report",
      organizationId: organizationID,
      orientation: "portrait",

      metadata: [
        {
          label: "Organization",
          value:
            guestDetail.OrganizationName ||
            guestDetail.OrganizationShortName,
        },
        {
          label: "Entry Date",
          value: guestDetail.EntryDate,
        },
        {
          label: "Guest Name",
          value: guestDetail.GuestName,
        },
        {
          label: "Room No.",
          value: guestDetail.RoomNo,
        },
        {
          label: "Arrival",
          value: guestDetail.Arrival,
        },
        {
          label: "Departure",
          value: guestDetail.Departure,
        },
        {
          label: "Booking Source",
          value: guestDetail.BookingSource,
        },
        {
          label: "Guest Status",
          value: guestDetail.GuestStatus,
        },
        {
          label: "Feedback Type",
          value: guestDetail.FeedbackType,
        },
        {
          label: "Met By",
          value:
            guestDetail.MetByName ||
            (guestDetail.MetBy
              ? `User ID: ${guestDetail.MetBy}`
              : null),
        },
        {
          label: "Met On",
          value: guestDetail.MetOn,
        },
        {
          label: "Created Date",
          value: guestDetail.CreatedDate,
        },
      ],

      sections: [
        {
          title: "Guest Feedback & Action Taken",
          items: [
            {
              label: "Guest Feedback",
              value: guestDetail.Feedback,
            },
            {
              label: "Action Taken",
              value: guestDetail.ActionTaken,
            },
          ],
        },
      ],

      styles: {
        pdfValue: {
          fontSize: 9,
          color: "#172033",
          lineHeight: 1.25,
        },
      },
    });

    const fileName = `Guest-Detail-${gmDetailID}.pdf`;

    return {
      success: true,
      message: "Guest detail PDF generated successfully.",
      data: pdfBuffer,
      fileName,
      contentType: "application/pdf",
    };
  } catch (error) {
    console.error("Generate guest detail PDF error:", error);

    return databaseFailure(
      error,
      "Unable to generate guest detail PDF.",
    );
  }
};

// ============================================================ Public Service API
module.exports = {
  createDailyEntry,
  getAllDailyEntries,
  deleteDailyEntry,
  createGuestDetail,
  updateGuestDetail,
  deleteGuestDetail,
  getGuestDetailById,
  getDateRangeReport,
  getFeedbackReport,
  getMetByReport,
  generateDateRangeReportPdf,
  generateFeedbackReportPdf,
  generateMetByReportPdf,
  generateGuestDetailPdf
};
