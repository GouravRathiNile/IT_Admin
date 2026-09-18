const { pool } = require("../../db");
const { retryableDatabaseResponse,} = require("../../utils/retryableDatabaseError");
const { formatDate } = require("../../utils/dateFormatter");
// ===============================================Pdf Helper
const { generatePdf, loadLogo } = require("../../utils/pdfHelper");
const PdfPrinter = require("pdfmake");
const path = require("path");
const MOM_DETAIL_PDF_FONTS = {
  Roboto: {
    normal: path.join(process.cwd(), "fonts/Roboto-Regular.ttf"),
    bold: path.join(process.cwd(), "fonts/Roboto-Medium.ttf"),
    italics: path.join(process.cwd(), "fonts/Roboto-SemiBold.ttf"),
    bolditalics: path.join(process.cwd(), "fonts/Roboto-Bold.ttf"),
  },
};

// ===================== Response Helpers
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

// ============================================================ Create MOM
const createMOM = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      OrganizationID,
      Title,
      MeetingDate,
      MeetingTime,
      NextReviewDate,
      NotesTaker,
      Attendees,
      Absentees,
      Actions,
      UserID,
    } = data;


    // ============================================================ Insert Master

    const masterResult = await client.query(
      `
      INSERT INTO MOM_Entry_Master
      (
        OrganizationID,
        Title,
        MeetingDate,
        MeetingTime,
        NextReviewDate,
        NotesTaker,
        Attendees,
        Absentees,
        CompletionPercentage,
        Status,
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
        0.00,
        'Active',
        FALSE,
        $9,
        CURRENT_TIMESTAMP
      )
      RETURNING MeetingID;
      `,
      [
        OrganizationID,
        Title,
        MeetingDate,
        MeetingTime || null,
        NextReviewDate || null,
        NotesTaker || [],
        Attendees || [],
        Absentees || [],
        UserID,
      ],
    );

    const meetingID =
      masterResult.rows[0].meetingid;


    // ============================================================ Insert Action Details

    for (let i = 0; i < (Actions || []).length; i++) {
      const item = Actions[i];

      if (!item.Action) {
        continue;
      }

      await client.query(
        `
        INSERT INTO MOM_Entry_Action_Details
        (
          MeetingID,
          OrganizationID,
          Action,
          ResponsiblePerson,
          Deadline,
          Status,
          SrNo,
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
          'Pending',
          $6,
          FALSE,
          $7,
          CURRENT_TIMESTAMP
        );
        `,
        [
          meetingID,
          OrganizationID,
          item.Action,
          item.ResponsiblePerson || [],
          item.Deadline || null,
          item.SrNo || i + 1,
          UserID,
        ],
      );
    }


    // ============================================================ Commit

    await client.query("COMMIT");

    return ok(
      "Meeting created successfully."
    );

  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(
      error,
      "Create MOM",
    );

  } finally {
    client.release();
  }
};
// ============================================================ Get MOM By ID
//==================== MOM Mapper Helper
const mapMOM = (row) => ({
  MeetingID: Number(row.meetingid),
  OrganizationID: Number(row.organizationid),
  OrganizationShortName: row.organizationshortname || null,

  Title: row.title,
  MeetingDate: formatDate(row.meetingdate),
  MeetingTime: row.meetingtime,
  NextReviewDate: formatDate(row.nextreviewdate),

  NotesTaker: Array.isArray(row.notestaker)
    ? row.notestaker.map(Number)
    : [],

  NotesTakerNames: row.notetakernames || [],

  Attendees: Array.isArray(row.attendees)
    ? row.attendees.map(Number)
    : [],

  AttendeeNames: row.attendeenames || [],

  Absentees: Array.isArray(row.absentees)
    ? row.absentees.map(Number)
    : [],

  AbsenteeNames: row.absenteenames || [],

  CompletionPercentage:
    row.completionpercentage == null
      ? 0
      : Number(row.completionpercentage),

  Status: row.status,

  CreatedDate: formatDate(row.createddate),

  Actions: [],
});
//===================== MOM Action Mapper Helper
const mapMOMAction = (row) => ({
  ActionID: Number(row.actionid),
  MeetingID: Number(row.meetingid),
  OrganizationID: Number(row.organizationid),

  Action: row.action,

  ResponsiblePerson: Array.isArray(row.responsibleperson)
    ? row.responsibleperson.map(Number)
    : [],

  ResponsiblePersonNames: row.responsiblepersonnames || [],

  Deadline: formatDate(row.deadline),

  Status: row.status,

  SrNo:
    row.srno == null ? null : Number(row.srno),

  CreatedDate: formatDate(row.createddate),

});
//===================== Get By Id
const getMOMById = async (data) => {
  try {
    const { MeetingID } = data;


    // ============================================================ Master

    const masterResult = await pool.query(
      `
      SELECT
        m.MeetingID,
        m.OrganizationID,

        o.ShortName AS OrganizationShortName,

        m.Title,
        m.MeetingDate,
        m.MeetingTime,
        m.NextReviewDate,

        m.NotesTaker,
        m.Attendees,
        m.Absentees,

        m.CompletionPercentage,
        m.Status,
        m.CreatedDate

      FROM MOM_Entry_Master m

      LEFT JOIN Organization_Master o
        ON o.OrganizationID = m.OrganizationID
        AND COALESCE(o.IsDeleted, FALSE) = FALSE

      WHERE m.MeetingID = $1
        AND m.IsDeleted = FALSE

      LIMIT 1;
      `,
      [MeetingID],
    );


    if (!masterResult.rows.length) {
      return fail(
        "MOM record not found.",
        404,
      );
    }

    const masterRow =
      masterResult.rows[0];


    // ============================================================ Note Taker Names

    const noteTakerResult = await pool.query(
      `
      SELECT
        u.FullName
      FROM UNNEST(
        $1::BIGINT[]
      ) WITH ORDINALITY AS x(UserID, ord)

      INNER JOIN user_master u
        ON u.UserID = x.UserID
        AND COALESCE(u.IsDeleted, FALSE) = FALSE

      ORDER BY x.ord;
      `,
      [
        masterRow.notestaker || [],
      ],
    );


    // ============================================================ Attendee Names

    const attendeeResult = await pool.query(
      `
      SELECT
        u.FullName
      FROM UNNEST(
        $1::BIGINT[]
      ) WITH ORDINALITY AS x(UserID, ord)

      INNER JOIN user_master u
        ON u.UserID = x.UserID
        AND COALESCE(u.IsDeleted, FALSE) = FALSE

      ORDER BY x.ord;
      `,
      [
        masterRow.attendees || [],
      ],
    );


    // ============================================================ Absentee Names

    const absenteeResult = await pool.query(
      `
      SELECT
        u.FullName
      FROM UNNEST(
        $1::BIGINT[]
      ) WITH ORDINALITY AS x(UserID, ord)

      INNER JOIN user_master u
        ON u.UserID = x.UserID
        AND COALESCE(u.IsDeleted, FALSE) = FALSE

      ORDER BY x.ord;
      `,
      [
        masterRow.absentees || [],
      ],
    );


    // ============================================================ Action Details

    const actionResult = await pool.query(
      `
      SELECT
        a.ActionID,
        a.MeetingID,
        a.OrganizationID,
        a.Action,
        a.ResponsiblePerson,

        ARRAY(
          SELECT u.FullName
          FROM UNNEST(
            COALESCE(
              a.ResponsiblePerson,
              ARRAY[]::BIGINT[]
            )
          ) WITH ORDINALITY AS x(UserID, ord)

          INNER JOIN user_master u
            ON u.UserID = x.UserID
            AND COALESCE(u.IsDeleted, FALSE) = FALSE

          ORDER BY x.ord
        ) AS ResponsiblePersonNames,

        a.Deadline,
        a.Status,
        a.SrNo,
        a.CreatedDate

      FROM MOM_Entry_Action_Details a

      WHERE a.MeetingID = $1
        AND a.IsDeleted = FALSE

      ORDER BY
        a.SrNo ASC,
        a.ActionID ASC;
      `,
      [MeetingID],
    );


    // ============================================================ Mapping

    masterRow.notetakernames =
      noteTakerResult.rows.map(
        (item) => item.fullname,
      );

    masterRow.attendeenames =
      attendeeResult.rows.map(
        (item) => item.fullname,
      );

    masterRow.absenteenames =
      absenteeResult.rows.map(
        (item) => item.fullname,
      );

    const mom = mapMOM(masterRow);

    mom.Actions =
      actionResult.rows.map(
        mapMOMAction,
      );


    return ok(
      "MOM fetched successfully.",
      mom,
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch MOM by ID",
    );
  }
};
// ============================================================ Update MOM
const updateMOM = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      MeetingID,
      OrganizationID,
      Title,
      MeetingDate,
      MeetingTime,
      NextReviewDate,
      NotesTaker,
      Attendees,
      Absentees,
      Actions,
      DeleteActionIDs,
      UserID,
    } = data;


    // ============================================================ Check MOM

    const existing = await client.query(
      `
      SELECT MeetingID
      FROM MOM_Entry_Master
      WHERE MeetingID = $1
        AND IsDeleted = FALSE
      FOR UPDATE;
      `,
      [MeetingID],
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");

      return fail(
        "MOM record not found.",
        404,
      );
    }


    // ============================================================ Update Master

    await client.query(
      `
      UPDATE MOM_Entry_Master
      SET
        OrganizationID = $1,
        Title = $2,
        MeetingDate = $3,
        MeetingTime = $4,
        NextReviewDate = $5,
        NotesTaker = $6,
        Attendees = $7,
        Absentees = $8,
        ModifiedBy = $9,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE MeetingID = $10
        AND IsDeleted = FALSE;
      `,
      [
        OrganizationID,
        Title,
        MeetingDate,
        MeetingTime || null,
        NextReviewDate || null,
        NotesTaker || [],
        Attendees || [],
        Absentees || [],
        UserID,
        MeetingID,
      ],
    );


    // ============================================================ Delete Action Details

    if ((DeleteActionIDs || []).length > 0) {
      await client.query(
        `
        UPDATE MOM_Entry_Action_Details
        SET
          IsDeleted = TRUE,
          DeletedBy = $1,
          DeletedDate = CURRENT_TIMESTAMP
        WHERE MeetingID = $2
          AND ActionID = ANY($3::BIGINT[])
          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          MeetingID,
          DeleteActionIDs,
        ],
      );
    }


    // ============================================================ Update / Insert Actions

    for (let i = 0; i < (Actions || []).length; i++) {
      const item = Actions[i];

      if (!item.Action) {
        continue;
      }

      // Existing Action
      if (item.ActionID) {
        await client.query(
          `
          UPDATE MOM_Entry_Action_Details
          SET
            Action = $1,
            ResponsiblePerson = $2,
            Deadline = $3,
            Status = COALESCE($4, Status),
            SrNo = $5,
            ModifiedBy = $6,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE ActionID = $7
            AND MeetingID = $8
            AND IsDeleted = FALSE;
          `,
          [
            item.Action,
            item.ResponsiblePerson || [],
            item.Deadline || null,
            item.Status || null,
            item.SrNo || i + 1,
            UserID,
            item.ActionID,
            MeetingID,
          ],
        );
      }

      // New Action
      else {
        await client.query(
          `
          INSERT INTO MOM_Entry_Action_Details
          (
            MeetingID,
            OrganizationID,
            Action,
            ResponsiblePerson,
            Deadline,
            Status,
            SrNo,
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
            'Pending',
            $6,
            FALSE,
            $7,
            CURRENT_TIMESTAMP
          );
          `,
          [
            MeetingID,
            OrganizationID,
            item.Action,
            item.ResponsiblePerson || [],
            item.Deadline || null,
            item.SrNo || i + 1,
            UserID,
          ],
        );
      }
    }


    // ============================================================ Recalculate Completion Percentage

    await client.query(
      `
      UPDATE MOM_Entry_Master
      SET CompletionPercentage = (
        SELECT
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              (
                COUNT(*) FILTER (
                  WHERE LOWER(TRIM(Status)) = 'completed'
                )::NUMERIC
                / COUNT(*)::NUMERIC
              ) * 100,
              2
            )
          END
        FROM MOM_Entry_Action_Details
        WHERE MeetingID = $1
          AND IsDeleted = FALSE
      )
      WHERE MeetingID = $1
        AND IsDeleted = FALSE;
      `,
      [MeetingID],
    );


    // ============================================================ Commit

    await client.query("COMMIT");

    return ok(
      "Meeting updated successfully.",
    );

  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(
      error,
      "Update MOM",
    );

  } finally {
    client.release();
  }
};
// ============================================================ Delete MOM
const deleteMOM = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      MeetingID,
      UserID,
    } = data;


    // ============================================================ Check MOM

    const existing = await client.query(
      `
      SELECT MeetingID
      FROM MOM_Entry_Master
      WHERE MeetingID = $1
        AND IsDeleted = FALSE
      FOR UPDATE;
      `,
      [MeetingID],
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");

      return fail(
        "MOM record not found.",
        404,
      );
    }


    // ============================================================ Delete Action Details

    await client.query(
      `
      UPDATE MOM_Entry_Action_Details
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE MeetingID = $2
        AND IsDeleted = FALSE;
      `,
      [
        UserID,
        MeetingID,
      ],
    );


    // ============================================================ Delete Master

    await client.query(
      `
      UPDATE MOM_Entry_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE MeetingID = $2
        AND IsDeleted = FALSE;
      `,
      [
        UserID,
        MeetingID,
      ],
    );


    // ============================================================ Commit

    await client.query("COMMIT");

    return ok(
      "Meeting deleted successfully.",
    );

  } catch (error) {
    await client.query("ROLLBACK");

    return databaseFailure(
      error,
      "Delete MOM",
    );

  } finally {
    client.release();
  }
};
// ============================================================ MOM List
//===================== MOM List Mapper Helper
const mapMOMList = (row) => ({
  MeetingID: Number(row.meetingid),

  OrganizationID: Number(row.organizationid),

  OrganizationShortName:
    row.organizationshortname || null,

  Title: row.title,

  MeetingDate: formatDate(row.meetingdate),

  NotesTaker:
    Array.isArray(row.notestaker)
      ? row.notestaker.map(Number)
      : [],

  NotesTakerNames:
    row.notestakernames || [],

  NextReviewDate:
    formatDate(row.nextreviewdate),

  CompletionPercentage:
    row.completionpercentage == null
      ? 0
      : Number(row.completionpercentage),

  Status: row.status,
});
//===================== Get MOM List
const getAllMOM = async (data) => {
  try {
    const page = Number(data.page) || 1;
    const pageSize = Number(data.PageSize) || 10;
    const offset = (page - 1) * pageSize;

    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];


    // ============================================================ Organization Filter

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================ Status Filter

    if (data.Status) {
      values.push(data.Status);

      conditions.push(
        `LOWER(TRIM(m.Status)) = LOWER(TRIM($${values.length}))`,
      );
    }


    // ============================================================ From Date Filter

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.MeetingDate >= $${values.length}::DATE`,
      );
    }


    // ============================================================ To Date Filter

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.MeetingDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================ Total Count

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::BIGINT AS TotalCount

      FROM MOM_Entry_Master m

      ${whereClause};
      `,
      values,
    );

    const totalCount =
      Number(countResult.rows[0].totalcount);


    // ============================================================ Pagination Values

    const listValues = [
      ...values,
      pageSize,
      offset,
    ];

    const limitIndex =
      listValues.length - 1;

    const offsetIndex =
      listValues.length;


    // ============================================================ MOM List

    const result = await pool.query(
      `
      SELECT
        m.MeetingID,
        m.OrganizationID,

        o.ShortName AS OrganizationShortName,

        m.Title,
        m.MeetingDate,

        m.NotesTaker,

        ARRAY(
          SELECT u.FullName

          FROM UNNEST(
            COALESCE(
              m.NotesTaker,
              ARRAY[]::BIGINT[]
            )
          ) WITH ORDINALITY AS x(UserID, ord)

          INNER JOIN user_master u
            ON u.UserID = x.UserID
            AND COALESCE(u.IsDeleted, FALSE) = FALSE

          ORDER BY x.ord
        ) AS NotesTakerNames,

        m.NextReviewDate,


        CASE
          WHEN COUNT(a.ActionID) = 0
            THEN 0

          ELSE ROUND(
            (
              COUNT(a.ActionID) FILTER (
                WHERE LOWER(TRIM(a.Status)) = 'completed'
              )::NUMERIC
              /
              COUNT(a.ActionID)::NUMERIC
            ) * 100,
            2
          )
        END AS CompletionPercentage,

        m.Status


      FROM MOM_Entry_Master m


      LEFT JOIN Organization_Master o
        ON o.OrganizationID = m.OrganizationID
        AND COALESCE(o.IsDeleted, FALSE) = FALSE


      LEFT JOIN MOM_Entry_Action_Details a
        ON a.MeetingID = m.MeetingID
        AND a.IsDeleted = FALSE


      ${whereClause}


      GROUP BY
        m.MeetingID,
        m.OrganizationID,
        o.ShortName,
        m.Title,
        m.MeetingDate,
        m.NotesTaker,
        m.NextReviewDate,
        m.Status


      ORDER BY
        m.MeetingDate DESC,
        m.MeetingID DESC


      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
      `,
      listValues,
    );


    // ============================================================ Mapping

    const records =
      result.rows.map(mapMOMList);


    // ============================================================ Response

    return ok(
      "MOM list fetched successfully.",
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
      "Fetch MOM list",
    );
  }
};
// ============================================================ Update MOM Status
const updateMOMStatus = async (data) => {
  try {
    const {
      MeetingID,
      Status,
      UserID,
    } = data;

    const result = await pool.query(
      `
      UPDATE MOM_Entry_Master
      SET
        Status = $1,
        ModifiedBy = $2,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE MeetingID = $3
        AND IsDeleted = FALSE
      RETURNING MeetingID;
      `,
      [
        Status,
        UserID,
        MeetingID,
      ],
    );

    if (!result.rows.length) {
      return fail(
        "MOM record not found.",
        404,
      );
    }

    return ok(
      Status === "Archive"
        ? "Meeting archived successfully."
        : "Meeting activated successfully.",
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Update MOM status",
    );
  }
};
// ============================================================ Get MOM Titles
const getMOMTitles = async (data) => {
  try {
    const { OrganizationID } = data;

    const result = await pool.query(
      `
      SELECT DISTINCT
        TRIM(Title) AS Title
      FROM MOM_Entry_Master
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
        AND Title IS NOT NULL
        AND TRIM(Title) <> ''
      ORDER BY Title ASC;
      `,
      [OrganizationID],
    );

    const titles = result.rows.map(
      (row) => ({
        Title: row.title,
      }),
    );

    return ok(
      "MOM titles fetched successfully.",
      titles,
      {
        Count: titles.length,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch MOM titles",
    );
  }
};
// ============================================================ Get MOM Actions 
const getMOMActions = async (data) => {
  try {
    const { OrganizationID } = data;

    const result = await pool.query(
      `
      SELECT DISTINCT
        TRIM(Action) AS Action
      FROM MOM_Entry_Action_Details
      WHERE OrganizationID = $1
        AND IsDeleted = FALSE
        AND Action IS NOT NULL
        AND TRIM(Action) <> ''
      ORDER BY Action ASC;
      `,
      [OrganizationID],
    );

    const actions = result.rows.map(
      (row) => ({
        Action: row.action,
      }),
    );

    return ok(
      "MOM actions fetched successfully.",
      actions,
      {
        Count: actions.length,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch MOM actions",
    );
  }
};
// ===================================================================== Report
// ============================================================ MOM Summary Report
const getMOMSummaryReport = async (data) => {
  try {
    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.MeetingDate >= $${values.length}::DATE`,
      );
    }

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.MeetingDate <= $${values.length}::DATE`,
      );
    }

    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;

    const result = await pool.query(
      `
      WITH filtered_meetings AS
      (
        SELECT
          m.MeetingID,
          m.Status

        FROM MOM_Entry_Master m

        ${whereClause}
      ),

      filtered_actions AS
      (
        SELECT
          a.ActionID,
          a.Status

        FROM MOM_Entry_Action_Details a

        INNER JOIN filtered_meetings fm
          ON fm.MeetingID = a.MeetingID

        WHERE a.IsDeleted = FALSE
      )

      SELECT
        (
          SELECT COUNT(*)::BIGINT
          FROM filtered_meetings
        ) AS TotalMeetings,

        (
          SELECT COUNT(*)::BIGINT
          FROM filtered_meetings
          WHERE LOWER(TRIM(Status)) = 'active'
        ) AS ActiveMeetings,

        (
          SELECT COUNT(*)::BIGINT
          FROM filtered_meetings
          WHERE LOWER(TRIM(Status)) = 'archive'
        ) AS ArchivedMeetings,

        (
          SELECT COUNT(*)::BIGINT
          FROM filtered_actions
        ) AS TotalActions,

        (
          SELECT COUNT(*)::BIGINT
          FROM filtered_actions
          WHERE LOWER(TRIM(Status)) = 'pending'
        ) AS PendingActions,

        (
          SELECT COUNT(*)::BIGINT
          FROM filtered_actions
          WHERE LOWER(TRIM(Status)) = 'completed'
        ) AS CompletedActions;
      `,
      values,
    );

    const row = result.rows[0];

    const totalActions =
      Number(row.totalactions);

    const completedActions =
      Number(row.completedactions);

    const completionPercentage =
      totalActions === 0
        ? 0
        : Number(
            (
              (completedActions / totalActions) * 100
            ).toFixed(2),
          );

    return ok(
      "MOM summary report fetched successfully.",
      {
        TotalMeetings:
          Number(row.totalmeetings),

        ActiveMeetings:
          Number(row.activemeetings),

        ArchivedMeetings:
          Number(row.archivedmeetings),

        TotalActions:
          totalActions,

        PendingActions:
          Number(row.pendingactions),

        CompletedActions:
          completedActions,

        CompletionPercentage:
          completionPercentage,
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch MOM summary report",
    );
  }
};
// ============================================================ Responsible Person Wise Report
// ===================== Responsible Person Report Mapper Helper
const mapResponsiblePersonReport = (row) => ({
  ResponsiblePersonID:
    Number(row.responsiblepersonid),

  ResponsiblePersonName:
    row.responsiblepersonname || null,

  TotalActions:
    Number(row.totalactions),

  PendingActions:
    Number(row.pendingactions),

  CompletedActions:
    Number(row.completedactions),

  CompletionPercentage:
    row.completionpercentage == null
      ? 0
      : Number(row.completionpercentage),
});
// ===================== Responsible Person Report
const getMOMResponsiblePersonReport = async (data) => {
  try {
    const page = Number(data.page) || 1;
    const pageSize = Number(data.PageSize) || 10;
    const offset = (page - 1) * pageSize;

    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
      "a.IsDeleted = FALSE",
    ];


    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.MeetingDate >= $${values.length}::DATE`,
      );
    }


    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.MeetingDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================ Responsible Person Filter

    let responsiblePersonFilter = "";

    if (data.ResponsiblePersonID) {
      values.push(data.ResponsiblePersonID);

      responsiblePersonFilter =
        `WHERE rp.UserID = $${values.length}`;
    }


    // ============================================================ Count

    const countResult = await pool.query(
      `
      WITH action_users AS
      (
        SELECT DISTINCT
          rp.UserID

        FROM MOM_Entry_Action_Details a

        INNER JOIN MOM_Entry_Master m
          ON m.MeetingID = a.MeetingID

        CROSS JOIN LATERAL
        UNNEST(
          COALESCE(
            a.ResponsiblePerson,
            ARRAY[]::BIGINT[]
          )
        ) AS rp(UserID)

        ${whereClause}
      )

      SELECT
        COUNT(*)::BIGINT AS TotalCount

      FROM action_users rp

      ${responsiblePersonFilter};
      `,
      values,
    );

    const totalCount =
      Number(countResult.rows[0].totalcount);


    // ============================================================ Pagination

    const listValues = [
      ...values,
      pageSize,
      offset,
    ];

    const limitIndex =
      listValues.length - 1;

    const offsetIndex =
      listValues.length;


    // ============================================================ Data

    const result = await pool.query(
      `
      WITH action_users AS
      (
        SELECT
          a.ActionID,
          a.Status,
          rp.UserID

        FROM MOM_Entry_Action_Details a

        INNER JOIN MOM_Entry_Master m
          ON m.MeetingID = a.MeetingID

        CROSS JOIN LATERAL
        UNNEST(
          COALESCE(
            a.ResponsiblePerson,
            ARRAY[]::BIGINT[]
          )
        ) AS rp(UserID)

        ${whereClause}
      )

      SELECT
        au.UserID AS ResponsiblePersonID,

        u.FullName AS ResponsiblePersonName,

        COUNT(*)::BIGINT AS TotalActions,

        COUNT(*) FILTER
        (
          WHERE LOWER(TRIM(au.Status)) = 'pending'
        )::BIGINT AS PendingActions,

        COUNT(*) FILTER
        (
          WHERE LOWER(TRIM(au.Status)) = 'completed'
        )::BIGINT AS CompletedActions,

        CASE
          WHEN COUNT(*) = 0
            THEN 0

          ELSE ROUND(
            (
              COUNT(*) FILTER
              (
                WHERE LOWER(TRIM(au.Status)) = 'completed'
              )::NUMERIC
              /
              COUNT(*)::NUMERIC
            ) * 100,
            2
          )
        END AS CompletionPercentage

      FROM action_users au

      LEFT JOIN user_master u
        ON u.UserID = au.UserID
        AND COALESCE(u.IsDeleted, FALSE) = FALSE

      ${data.ResponsiblePersonID
        ? `WHERE au.UserID = $${values.length}`
        : ""
      }

      GROUP BY
        au.UserID,
        u.FullName

      ORDER BY
        u.FullName ASC

      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
      `,
      listValues,
    );

    const records =
      result.rows.map(
        mapResponsiblePersonReport,
      );

    return ok(
      "Responsible person wise MOM report fetched successfully.",
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
      "Fetch responsible person MOM report",
    );
  }
};
// ============================================================ MOM Action Detail Report
// ==================== Action Detail Report Mapper
const mapActionDetailReport = (row) => ({
  ActionID:
    Number(row.actionid),

  MeetingID:
    Number(row.meetingid),

  OrganizationID:
    Number(row.organizationid),

  OrganizationShortName:
    row.organizationshortname || null,

  Title:
    row.title,

  MeetingDate:
    formatDate(row.meetingdate),

  Action:
    row.action,

  ResponsiblePerson:
    Array.isArray(row.responsibleperson)
      ? row.responsibleperson.map(Number)
      : [],

  ResponsiblePersonNames:
    row.responsiblepersonnames || [],

  Deadline:
    formatDate(row.deadline),

  Status:
    row.status,

  SrNo:
    row.srno == null
      ? null
      : Number(row.srno),
});
const getMOMActionDetailReport = async (data) => {
  try {
    const page = Number(data.page) || 1;
    const pageSize = Number(data.PageSize) || 10;
    const offset = (page - 1) * pageSize;

    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
      "a.IsDeleted = FALSE",
    ];


    // ============================================================ Organization

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================ Title

    if (data.Title) {
      values.push(`%${String(data.Title).trim()}%`);

      conditions.push(
        `m.Title ILIKE $${values.length}`,
      );
    }


    // ============================================================ Action

    if (data.Action) {
      values.push(`%${String(data.Action).trim()}%`);

      conditions.push(
        `a.Action ILIKE $${values.length}`,
      );
    }


    // ============================================================ Status

    if (data.Status) {
      values.push(data.Status);

      conditions.push(
        `LOWER(TRIM(a.Status)) = LOWER(TRIM($${values.length}))`,
      );
    }


    // ============================================================ Responsible Person

    if (data.ResponsiblePersonId) {
      values.push(data.ResponsiblePersonId);

      conditions.push(
        `$${values.length}::BIGINT = ANY(
          COALESCE(
            a.ResponsiblePerson,
            ARRAY[]::BIGINT[]
          )
        )`,
      );
    }


    // ============================================================ Meeting Date

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.MeetingDate >= $${values.length}::DATE`,
      );
    }


    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.MeetingDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================ Count

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::BIGINT AS TotalCount

      FROM MOM_Entry_Action_Details a

      INNER JOIN MOM_Entry_Master m
        ON m.MeetingID = a.MeetingID

      ${whereClause};
      `,
      values,
    );

    const totalCount =
      Number(countResult.rows[0].totalcount);


    // ============================================================ Pagination

    const listValues = [
      ...values,
      pageSize,
      offset,
    ];

    const limitIndex =
      listValues.length - 1;

    const offsetIndex =
      listValues.length;


    // ============================================================ Data

    const result = await pool.query(
      `
      SELECT
        a.ActionID,
        a.MeetingID,

        m.OrganizationID,

        o.ShortName AS OrganizationShortName,

        m.Title,
        m.MeetingDate,

        a.Action,
        a.ResponsiblePerson,

        ARRAY(
          SELECT u.FullName

          FROM UNNEST(
            COALESCE(
              a.ResponsiblePerson,
              ARRAY[]::BIGINT[]
            )
          ) WITH ORDINALITY AS x(UserID, ord)

          INNER JOIN user_master u
            ON u.UserID = x.UserID
            AND COALESCE(u.IsDeleted, FALSE) = FALSE

          ORDER BY x.ord
        ) AS ResponsiblePersonNames,

        a.Deadline,
        a.Status,
        a.SrNo

      FROM MOM_Entry_Action_Details a

      INNER JOIN MOM_Entry_Master m
        ON m.MeetingID = a.MeetingID

      LEFT JOIN Organization_Master o
        ON o.OrganizationID = m.OrganizationID
        AND COALESCE(o.IsDeleted, FALSE) = FALSE

      ${whereClause}

      ORDER BY
        m.MeetingDate DESC,
        a.SrNo ASC,
        a.ActionID ASC

      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
      `,
      listValues,
    );

    const records =
      result.rows.map(
        mapActionDetailReport,
      );

    const organizationID = records.length > 0
      ? records[0].OrganizationID
      : data.OrganizationID
        ? Number(data.OrganizationID)
        : null;

    const organizationShortName = records.length > 0
      ? records[0].OrganizationShortName
      : null;

    const actionDetails = records.map((record) => {
      const {
        OrganizationID: _organizationID,
        OrganizationShortName: _organizationShortName,
        ...actionDetail
      } = record;

      return actionDetail;
    });

    return ok(
      "MOM action detail report fetched successfully.",
      actionDetails,
      {
        OrganizationID: organizationID,
        OrganizationShortName: organizationShortName,
        TotalCount: totalCount,
        PageCount: actionDetails.length,
        CurrentPage: page,
        PageSize: pageSize,
        TotalPages:
          Math.ceil(totalCount / pageSize),
      },
    );

  } catch (error) {
    return databaseFailure(
      error,
      "Fetch MOM action detail report",
    );
  }
};
// ===================================================================== Pdfs
// ============================================================ MOM List PDF
const generateMOMListPdf = async (data) => {
  try {
    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
    ];


    // ============================================================ Organization Filter

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================ Status Filter

    if (data.Status) {
      values.push(data.Status);

      conditions.push(
        `LOWER(TRIM(m.Status)) = LOWER(TRIM($${values.length}))`,
      );
    }


    // ============================================================ From Date Filter

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.MeetingDate >= $${values.length}::DATE`,
      );
    }


    // ============================================================ To Date Filter

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.MeetingDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================
    // MOM LIST
    // Same query as GET API
    // Only LIMIT / OFFSET removed
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        m.MeetingID,
        m.OrganizationID,

        o.ShortName AS OrganizationShortName,
        o.OrganizationName AS OrganizationFullName,

        m.Title,
        m.MeetingDate,

        m.NotesTaker,

        ARRAY(
          SELECT u.FullName

          FROM UNNEST(
            COALESCE(
              m.NotesTaker,
              ARRAY[]::BIGINT[]
            )
          ) WITH ORDINALITY AS x(UserID, ord)

          INNER JOIN user_master u
            ON u.UserID = x.UserID
            AND COALESCE(u.IsDeleted, FALSE) = FALSE

          ORDER BY x.ord
        ) AS NotesTakerNames,

        m.NextReviewDate,


        CASE
          WHEN COUNT(a.ActionID) = 0
            THEN 0

          ELSE ROUND(
            (
              COUNT(a.ActionID) FILTER (
                WHERE LOWER(TRIM(a.Status)) = 'completed'
              )::NUMERIC
              /
              COUNT(a.ActionID)::NUMERIC
            ) * 100,
            2
          )
        END AS CompletionPercentage,

        m.Status


      FROM MOM_Entry_Master m


      LEFT JOIN Organization_Master o
        ON o.OrganizationID = m.OrganizationID
        AND COALESCE(o.IsDeleted, FALSE) = FALSE


      LEFT JOIN MOM_Entry_Action_Details a
        ON a.MeetingID = m.MeetingID
        AND a.IsDeleted = FALSE


      ${whereClause}


      GROUP BY
        m.MeetingID,
        m.OrganizationID,
        o.ShortName,
        o.OrganizationName,
        m.Title,
        m.MeetingDate,
        m.NotesTaker,
        m.NextReviewDate,
        m.Status


      ORDER BY
        m.MeetingDate DESC,
        m.MeetingID DESC;
      `,
      values,
    );


    // ============================================================
    // SAME MAPPER AS GET API
    // ============================================================

    const records =
      result.rows.map(mapMOMList);


    // ============================================================ PDF Rows

    const pdfRows = records.map((row) => ({
      ...row,

      NoteTaker:
        row.NotesTakerNames?.length
          ? row.NotesTakerNames.join(", ")
          : "-",

      Completion:
        `${Number(row.CompletionPercentage || 0).toFixed(2)}%`,
    }));


    // ============================================================
    // PDF Columns
    // Same fields visible in Meeting List image
    // ============================================================

    const columns = [
      {
        header: "HOTEL",
        value: (row) =>
          row.OrganizationShortName || "-",
        width: 60,
      },

      {
        header: "TITLE",
        value: (row) =>
          row.Title || "-",
        width: "*",
      },

      {
        header: "DATE",
        value: (row) =>
          row.MeetingDate || "-",
        width: 75,
        align: "center",
      },

      {
        header: "NOTE TAKER",
        value: (row) =>
          row.NoteTaker,
        width: 130,
      },

      {
        header: "NEXT REVIEW DATE",
        value: (row) =>
          row.NextReviewDate || "-",
        width: 90,
        align: "center",
      },

      {
        header: "COMPLETION %",
        value: (row) =>
          row.Completion,
        width: 70,
        align: "center",
      },

      {
        header: "STATUS",
        value: (row) =>
          row.Status || "-",
        width: 60,
        align: "center",
      },
    ];


    // ============================================================ Metadata

    const metadata = [];

    if (data.OrganizationID && records.length > 0) {
      metadata.push({
        label: "Organization",
        value:
          result.rows[0]?.organizationfullname ||
          "-",
      });
    }

    if (data.Status) {
      metadata.push({
        label: "Status",
        value: data.Status,
      });
    }

    if (data.FromDate) {
      metadata.push({
        label: "From Date",
        value: formatDate(data.FromDate),
      });
    }

    if (data.ToDate) {
      metadata.push({
        label: "To Date",
        value: formatDate(data.ToDate),
      });
    }

    // ============================================================ Generate PDF

    const pdfBuffer = await generatePdf({
      title: "MEETING LIST",

      reportName: "MOM Meeting List",

      organizationId:
        data.OrganizationID || null,

      orientation: "landscape",

      metadata,

      columns,

      rows: pdfRows,

      pageMargins:
        [20, 24, 20, 35],
    });


    // ============================================================ Response

    return {
      success: true,

      message:
        "MOM meeting list PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `MOM_Meeting_List_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "MOM Meeting List PDF Error:",
      error,
    );

    return {
      success: false,
      statusCode: 503,
      message:
        "Unable to generate MOM meeting list PDF.",
    };
  }
};
// ============================================================ Responsible Person Report PDF
const generateMOMResponsiblePersonReportPdf = async (data) => {
  try {
    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
      "a.IsDeleted = FALSE",
    ];


    // ============================================================ Organization Filter

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================ From Date Filter

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.MeetingDate >= $${values.length}::DATE`,
      );
    }


    // ============================================================ To Date Filter

    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.MeetingDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================ Responsible Person Filter

    if (data.ResponsiblePersonID) {
      values.push(data.ResponsiblePersonID);
    }


    // ============================================================
    // SAME QUERY AS GET API
    // Only LIMIT / OFFSET removed
    // ============================================================

    const result = await pool.query(
      `
      WITH action_users AS
      (
        SELECT
          a.ActionID,
          a.Status,
          rp.UserID

        FROM MOM_Entry_Action_Details a

        INNER JOIN MOM_Entry_Master m
          ON m.MeetingID = a.MeetingID

        CROSS JOIN LATERAL
        UNNEST(
          COALESCE(
            a.ResponsiblePerson,
            ARRAY[]::BIGINT[]
          )
        ) AS rp(UserID)

        ${whereClause}
      )

      SELECT
        au.UserID AS ResponsiblePersonID,

        u.FullName AS ResponsiblePersonName,

        COUNT(*)::BIGINT AS TotalActions,

        COUNT(*) FILTER
        (
          WHERE LOWER(TRIM(au.Status)) = 'pending'
        )::BIGINT AS PendingActions,

        COUNT(*) FILTER
        (
          WHERE LOWER(TRIM(au.Status)) = 'completed'
        )::BIGINT AS CompletedActions,

        CASE
          WHEN COUNT(*) = 0
            THEN 0

          ELSE ROUND(
            (
              COUNT(*) FILTER
              (
                WHERE LOWER(TRIM(au.Status)) = 'completed'
              )::NUMERIC
              /
              COUNT(*)::NUMERIC
            ) * 100,
            2
          )
        END AS CompletionPercentage

      FROM action_users au

      LEFT JOIN user_master u
        ON u.UserID = au.UserID
        AND COALESCE(u.IsDeleted, FALSE) = FALSE

      ${
        data.ResponsiblePersonID
          ? `WHERE au.UserID = $${values.length}`
          : ""
      }

      GROUP BY
        au.UserID,
        u.FullName

      ORDER BY
        u.FullName ASC;
      `,
      values,
    );


    // ============================================================
    // SAME MAPPER AS GET API
    // ============================================================

    const records =
      result.rows.map(
        mapResponsiblePersonReport,
      );


    // ============================================================ Organization Details

    let organization = null;

    if (data.OrganizationID) {
      const organizationResult = await pool.query(
        `
        SELECT
          OrganizationID,
          OrganizationName,
          ShortName
        FROM Organization_Master
        WHERE OrganizationID = $1
          AND COALESCE(IsDeleted, FALSE) = FALSE
        LIMIT 1;
        `,
        [data.OrganizationID],
      );

      organization =
        organizationResult.rows[0] || null;
    }


    // ============================================================ PDF Rows

    const pdfRows = records.map((row, index) => ({
      ...row,

      SrNo:
        index + 1,

      Completion:
        `${Number(
          row.CompletionPercentage || 0,
        ).toFixed(2)}%`,
    }));


    // ============================================================ PDF Columns

    const columns = [
      {
        header: "Sr.No.",
        value: (row) => row.SrNo,
        width: 50,
        align: "center",
      },

      {
        header: "Responsible Person",
        value: (row) =>
          row.ResponsiblePersonName || "-",
        width: "*",
      },

      {
        header: "Total Actions",
        value: (row) =>
          row.TotalActions,
        width: 105,
        align: "center",
      },

      {
        header: "Pending Actions",
        value: (row) =>
          row.PendingActions,
        width: 110,
        align: "center",
      },

      {
        header: "Completed Actions",
        value: (row) =>
          row.CompletedActions,
        width: 115,
        align: "center",
      },

      {
        header: "Completion %",
        value: (row) =>
          row.Completion,
        width: 110,
        align: "center",
      },
    ];


    // ============================================================ Metadata

    const metadata = [];

    if (data.OrganizationID) {
      metadata.push({
        label: "Organization",
        value:
          organization?.organizationname ||
          organization?.shortname ||
          "-",
      });
    }

    if (data.ResponsiblePersonID) {
      metadata.push({
        label: "Responsible Person",
        value:
          records[0]?.ResponsiblePersonName ||
          "-",
      });
    }

    if (data.FromDate) {
      metadata.push({
        label: "From Date",
        value:
          formatDate(data.FromDate),
      });
    }

    if (data.ToDate) {
      metadata.push({
        label: "To Date",
        value:
          formatDate(data.ToDate),
      });
    }

    // ============================================================ Generate PDF

    const pdfBuffer = await generatePdf({
      title:
        "RESPONSIBLE PERSON WISE REPORT",

      reportName:
        "MOM Responsible Person Wise Report",

      organizationId:
        data.OrganizationID || null,

      orientation:
        "landscape",

      metadata,

      columns,

      rows:
        pdfRows,

      pageMargins:
        [20, 24, 20, 35],
    });


    // ============================================================ Response

    return {
      success: true,

      message:
        "Responsible person wise MOM report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `MOM_Responsible_Person_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "MOM Responsible Person Report PDF Error:",
      error,
    );

    return {
      success: false,
      statusCode: 503,
      message:
        "Unable to generate responsible person wise MOM report PDF.",
    };
  }
};
// ============================================================ MOM Action Detail Report PDF
const generateMOMActionDetailReportPdf = async (data) => {
  try {
    const values = [];

    const conditions = [
      "m.IsDeleted = FALSE",
      "a.IsDeleted = FALSE",
    ];


    // ============================================================ Organization

    if (data.OrganizationID) {
      values.push(data.OrganizationID);

      conditions.push(
        `m.OrganizationID = $${values.length}`,
      );
    }


    // ============================================================ Title

    if (data.Title) {
      values.push(
        `%${String(data.Title).trim()}%`,
      );

      conditions.push(
        `m.Title ILIKE $${values.length}`,
      );
    }


    // ============================================================ Action

    if (data.Action) {
      values.push(
        `%${String(data.Action).trim()}%`,
      );

      conditions.push(
        `a.Action ILIKE $${values.length}`,
      );
    }


    // ============================================================ Status

    if (data.Status) {
      values.push(data.Status);

      conditions.push(
        `LOWER(TRIM(a.Status)) = LOWER(TRIM($${values.length}))`,
      );
    }


    // ============================================================ Responsible Person

    if (data.ResponsiblePersonId) {
      values.push(
        data.ResponsiblePersonId,
      );

      conditions.push(
        `$${values.length}::BIGINT = ANY(
          COALESCE(
            a.ResponsiblePerson,
            ARRAY[]::BIGINT[]
          )
        )`,
      );
    }


    // ============================================================ Meeting Date

    if (data.FromDate) {
      values.push(data.FromDate);

      conditions.push(
        `m.MeetingDate >= $${values.length}::DATE`,
      );
    }


    if (data.ToDate) {
      values.push(data.ToDate);

      conditions.push(
        `m.MeetingDate <= $${values.length}::DATE`,
      );
    }


    const whereClause =
      `WHERE ${conditions.join(" AND ")}`;


    // ============================================================
    // SAME QUERY AS GET API
    // Only LIMIT / OFFSET removed
    // ============================================================

    const result = await pool.query(
      `
      SELECT
        a.ActionID,
        a.MeetingID,

        m.OrganizationID,

        o.ShortName AS OrganizationShortName,
        o.OrganizationName AS OrganizationFullName,

        m.Title,
        m.MeetingDate,

        a.Action,
        a.ResponsiblePerson,

        ARRAY(
          SELECT u.FullName

          FROM UNNEST(
            COALESCE(
              a.ResponsiblePerson,
              ARRAY[]::BIGINT[]
            )
          ) WITH ORDINALITY AS x(UserID, ord)

          INNER JOIN user_master u
            ON u.UserID = x.UserID
            AND COALESCE(u.IsDeleted, FALSE) = FALSE

          ORDER BY x.ord
        ) AS ResponsiblePersonNames,

        a.Deadline,
        a.Status,
        a.SrNo

      FROM MOM_Entry_Action_Details a

      INNER JOIN MOM_Entry_Master m
        ON m.MeetingID = a.MeetingID

      LEFT JOIN Organization_Master o
        ON o.OrganizationID = m.OrganizationID
        AND COALESCE(o.IsDeleted, FALSE) = FALSE

      ${whereClause}

      ORDER BY
        m.MeetingDate DESC,
        a.SrNo ASC,
        a.ActionID ASC;
      `,
      values,
    );


    // ============================================================
    // SAME MAPPER AS GET API
    // ============================================================

    const records =
      result.rows.map(
        mapActionDetailReport,
      );


    // ============================================================
    // Same Organization Data As GET API
    // ============================================================

    const organizationID =
      records.length > 0
        ? records[0].OrganizationID
        : data.OrganizationID
          ? Number(data.OrganizationID)
          : null;

    const organizationShortName =
      records.length > 0
        ? records[0].OrganizationShortName
        : null;

    const organizationFullName =
      result.rows[0]?.organizationfullname || null;


    // ============================================================ PDF Rows

    const pdfRows = records.map(
      (record, index) => ({
        ...record,

        DisplaySrNo:
          index + 1,

        ResponsiblePersonName:
          record.ResponsiblePersonNames?.length
            ? record.ResponsiblePersonNames.join(", ")
            : "-",
      }),
    );


    // ============================================================ PDF Columns

    const columns = [
      {
        header: "Sr.No.",
        value: (row) =>
          row.DisplaySrNo,
        width: 35,
        align: "center",
      },

      {
        header: "Title",
        value: (row) =>
          row.Title || "-",
        width: 150,
      },

      {
        header: "Meeting Date",
        value: (row) =>
          row.MeetingDate || "-",
        width: 70,
        align: "center",
      },

      {
        header: "Action",
        value: (row) =>
          row.Action || "-",
        width: 200,
      },

      {
        header: "Responsible Person",
        value: (row) =>
          row.ResponsiblePersonName,
        width: 110,
      },

      {
        header: "Deadline",
        value: (row) =>
          row.Deadline || "-",
        width: 70,
        align: "center",
      },

      {
        header: "Status",
        value: (row) =>
          row.Status || "-",
        width: 60,
        align: "center",
      },
    ];


    // ============================================================ Metadata

    const metadata = [];

    if (organizationID) {
      metadata.push({
        label: "Organization",
        value:
          organizationFullName ||
          organizationShortName ||
          "-",
      });
    }

    if (data.Title) {
      metadata.push({
        label: "Title",
        value: data.Title,
      });
    }

    if (data.Action) {
      metadata.push({
        label: "Action",
        value: data.Action,
      });
    }

    if (data.Status) {
      metadata.push({
        label: "Status",
        value: data.Status,
      });
    }

    if (data.ResponsiblePersonId) {
      metadata.push({
        label: "Responsible Person",
        value:
          records[0]?.ResponsiblePersonNames?.join(", ") ||
          "-",
      });
    }

    if (data.FromDate) {
      metadata.push({
        label: "From Date",
        value:
          formatDate(data.FromDate),
      });
    }

    if (data.ToDate) {
      metadata.push({
        label: "To Date",
        value:
          formatDate(data.ToDate),
      });
    }

    metadata.push({
      label: "Total Actions",
      value: records.length,
    });


    // ============================================================ Generate PDF

    const pdfBuffer =
      await generatePdf({
        title:
          "MOM ACTION DETAIL REPORT",

        reportName:
          "MOM Action Detail Report",

        organizationId:
          organizationID,

        orientation:
          "landscape",

        metadata,

        columns,

        rows:
          pdfRows,

        pageMargins:
          [20, 24, 20, 35],
      });


    // ============================================================ Response

    return {
      success: true,

      message:
        "MOM action detail report PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `MOM_Action_Detail_Report_${Date.now()}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "MOM Action Detail Report PDF Error:",
      error,
    );

    return {
      success: false,

      statusCode: 503,

      message:
        "Unable to generate MOM action detail report PDF.",
    };
  }
};
// ============================================================ MOM Detail PDF
const generateMOMDetailPdf = async (data) => {
  try {
    const meetingID =
      Number(data.MeetingID);

    if (
      !Number.isInteger(meetingID) ||
      meetingID <= 0
    ) {
      return fail(
        "Valid MeetingID is required.",
        400,
      );
    }


    // =========================================================
    // SAME GET BY ID API
    // Same Query
    // Same Conditions
    // Same Mapper
    // =========================================================

    const momResult =
      await getMOMById({
        MeetingID:
          meetingID,
      });

    if (!momResult.success) {
      return momResult;
    }

    const detail =
      momResult.data;


    // =========================================================
    // ACTION STATUS FILTER
    // Blank = All
    // Pending = Pending only
    // Completed = Completed only
    // =========================================================

    const allActions =
      detail.Actions || [];

    let actions = allActions;

    if (
      data.Status &&
      String(data.Status).trim()
    ) {
      const status =
        String(data.Status)
          .trim()
          .toLowerCase();

      actions =
        actions.filter(
          (item) =>
            String(
              item.Status || "",
            )
              .trim()
              .toLowerCase() ===
            status,
        );
    }


    // =========================================================
    // PDF DESIGN
    // =========================================================

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


    const displayValue = (value) =>
      value === null ||
      value === undefined ||
      String(value).trim() === ""
        ? "-"
        : String(value);


    // =========================================================
    // Canvas Helpers
    // =========================================================

    const line = (
      x1,
      y1,
      x2,
      y2,
      lineWidth = 1.1,
    ) => ({
      type: "line",
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
      type: "rect",
      x,
      y,
      w,
      h,
      r,
      lineWidth: 1.1,
      lineColor:
        COLORS.navy,
    });


    const ellipse = (
      x,
      y,
      r1,
      r2 = r1,
    ) => ({
      type: "ellipse",
      x,
      y,
      r1,
      r2,
      lineWidth: 1.1,
      lineColor:
        COLORS.navy,
    });


    // =========================================================
    // Icons
    // =========================================================

    const fieldIcon = (type) => {
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


        person: [
          ellipse(
            9,
            5,
            3,
          ),

          {
            type:
              "polyline",

            points: [
              {
                x: 2,
                y: 17,
              },
              {
                x: 3,
                y: 13,
              },
              {
                x: 6,
                y: 11,
              },
              {
                x: 12,
                y: 11,
              },
              {
                x: 15,
                y: 13,
              },
              {
                x: 16,
                y: 17,
              },
            ],

            lineWidth:
              1.1,

            lineColor:
              COLORS.navy,
          },
        ],


        status: [
          ellipse(
            9,
            9,
            7,
          ),

          line(
            5,
            9,
            8,
            12,
          ),

          line(
            8,
            12,
            14,
            6,
          ),
        ],


        title: [
          rect(
            2,
            2,
            14,
            14,
            1,
          ),

          line(
            5,
            6,
            13,
            6,
          ),

          line(
            5,
            9,
            13,
            9,
          ),

          line(
            5,
            12,
            11,
            12,
          ),
        ],


        time: [
          ellipse(
            9,
            9,
            7,
          ),

          line(
            9,
            9,
            9,
            5,
          ),

          line(
            9,
            9,
            13,
            11,
          ),
        ],


        percentage: [
          ellipse(
            5,
            5,
            2,
          ),

          ellipse(
            13,
            13,
            2,
          ),

          line(
            5,
            14,
            13,
            4,
          ),
        ],
      };


      const iconScale =
        0.82;


      return (
        icons[type] ||
        icons.title
      ).map((shape) => {

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
      });
    };


    // =========================================================
    // Cell Helpers
    // =========================================================

    const labelCell = (
      label,
      icon,
    ) => ({
      columns: [
        {
          width: 22,

          canvas:
            fieldIcon(icon),

          margin: [
            0,
            0,
            0,
            0,
          ],
        },

        {
          width: "*",

          text:
            label,

          style:
            "fieldLabel",

          margin: [
            2,
            3,
            0,
            0,
          ],
        },
      ],

      fillColor:
        COLORS.labelBackground,

      margin: [
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

      margin: [
        9,
        8,
        7,
        7,
      ],
    });


    const tableLayout = {
      hLineColor: () =>
        COLORS.border,

      vLineColor: () =>
        COLORS.border,

      hLineWidth: () =>
        0.7,

      vLineWidth: () =>
        0.7,

      paddingLeft: () =>
        0,

      paddingRight: () =>
        0,

      paddingTop: () =>
        0,

      paddingBottom: () =>
        0,
    };


    // =========================================================
    // Section Heading
    // =========================================================

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

      margin: [
        0,
        4,
        0,
        7,
      ],
    });


    // =========================================================
    // Display Values
    // =========================================================

    const noteTakers =
      detail.NotesTakerNames?.length
        ? detail.NotesTakerNames.join(
            ", ",
          )
        : "-";


    const attendees =
      detail.AttendeeNames?.length
        ? detail.AttendeeNames.join(
            ", ",
          )
        : "-";


    const absentees =
      detail.AbsenteeNames?.length
        ? detail.AbsenteeNames.join(
            ", ",
          )
        : "-";


    const completedActionCount =
      allActions.filter(
        (item) =>
          String(item.Status || "")
            .trim()
            .toLowerCase() === "completed",
      ).length;

    const completionPercentage =
      allActions.length > 0
        ? (completedActionCount / allActions.length) * 100
        : 0;

    const completion =
      `${completionPercentage.toFixed(2)}%`;


    // =========================================================
    // Logo
    // =========================================================

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


    // =========================================================
    // ACTION TABLE BODY
    // Same Style As Breakdown Spare Parts Table
    // =========================================================

    const actionTableBody = [
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
            "Action",

          style:
            "tableHeader",
        },

        {
          text:
            "Responsible Person",

          style:
            "tableHeader",
        },

        {
          text:
            "Deadline",

          style:
            "tableHeader",

          alignment:
            "center",
        },

        {
          text:
            "Status",

          style:
            "tableHeader",

          alignment:
            "center",
        },
      ],
    ];


    if (
      actions.length > 0
    ) {
      actions.forEach(
        (
          item,
          index,
        ) => {

          actionTableBody.push([
            {
              text:
                displayValue(
                  item.SrNo ||
                  index + 1,
                ),

              style:
                "tableValue",

              alignment:
                "center",
            },

            {
              text:
                displayValue(
                  item.Action,
                ),

              style:
                "tableValue",
            },

            {
              text:
                item
                  .ResponsiblePersonNames
                  ?.length
                  ? item
                      .ResponsiblePersonNames
                      .join(
                        ", ",
                      )
                  : "-",

              style:
                "tableValue",
            },

            {
              text:
                displayValue(
                  item.Deadline,
                ),

              style:
                "tableValue",

              alignment:
                "center",
            },

            {
              text:
                displayValue(
                  item.Status,
                ),

              style:
                "tableValue",

              alignment:
                "center",
            },
          ]);
        },
      );
    } else {

      actionTableBody.push([
        {
          text:
            data.Status
              ? `No ${data.Status} actions found.`
              : "No action details found.",

          colSpan:
            5,

          alignment:
            "center",

          color:
            COLORS.muted,

          margin: [
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


    // =========================================================
    // DOCUMENT DEFINITION
    // =========================================================

    const documentDefinition = {

      pageSize:
        "A4",

      pageOrientation:
        "portrait",

      pageMargins: [
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

        // =====================================================
        // HEADER
        // =====================================================

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

                      fit: [
                        88,
                        50,
                      ],

                      border: [
                        false,
                        false,
                        false,
                        false,
                      ],
                    }
                  : {
                      text:
                        "",

                      border: [
                        false,
                        false,
                        false,
                        false,
                      ],
                    },


                {
                  text:
                    "Meeting Details",

                  style:
                    "title",

                  alignment:
                    "center",

                  margin: [
                    0,
                    18,
                    0,
                    0,
                  ],

                  border: [
                    false,
                    false,
                    false,
                    false,
                  ],
                },


                {
                  text:
                    "",

                  border: [
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


        // =====================================================
        // HEADER LINE
        // =====================================================

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

          margin: [
            0,
            7,
            0,
            14,
          ],
        },


        // =====================================================
        // MEETING DETAILS
        // =====================================================

        sectionHeading(
          "Meeting Details",
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

              // =================================================
              // ROW 1
              // =================================================

              [
                labelCell(
                  "Organization",
                  "organization",
                ),

                valueCell(
                  detail
                    .OrganizationShortName,
                ),

                labelCell(
                  "Created Date",
                  "calendar",
                ),

                valueCell(
                  detail.CreatedDate,
                ),
              ],


              // =================================================
              // ROW 2
              // =================================================

              [
                labelCell(
                  "Meeting Date",
                  "calendar",
                ),

                valueCell(
                  detail
                    .MeetingDate,
                ),

                labelCell(
                  "Meeting Time",
                  "time",
                ),

                valueCell(
                  detail
                    .MeetingTime,
                ),
              ],


              // =================================================
              // ROW 3
              // =================================================

              [
                labelCell(
                  "Next Review Date",
                  "calendar",
                ),

                valueCell(
                  detail
                    .NextReviewDate,
                ),

                labelCell(
                  "Status",
                  "status",
                ),

                valueCell(
                  detail.Status,
                ),
              ],


              // =================================================
              // ROW 4
              // =================================================

              [
                labelCell(
                  "Note Taker",
                  "person",
                ),

                valueCell(
                  noteTakers,
                ),

                labelCell(
                  "Completion%",
                  "percentage",
                ),

                valueCell(
                  completion,
                ),
              ],


              // =================================================
              // TITLE - FULL WIDTH
              // =================================================

              [
                labelCell(
                  "Title",
                  "title",
                ),

                {
                  ...valueCell(
                    detail.Title,
                  ),

                  colSpan:
                    3,
                },

                {},

                {},
              ],


              // =================================================
              // ATTENDEES - FULL WIDTH
              // =================================================

              [
                labelCell(
                  "Attendees",
                  "person",
                ),

                {
                  ...valueCell(
                    attendees,
                  ),

                  colSpan:
                    3,
                },

                {},

                {},
              ],


              // =================================================
              // ABSENTEES - FULL WIDTH
              // =================================================

              [
                labelCell(
                  "Absentees",
                  "person",
                ),

                {
                  ...valueCell(
                    absentees,
                  ),

                  colSpan:
                    3,
                },

                {},

                {},
              ],
            ],
          },

          layout:
            tableLayout,

          margin: [
            0,
            0,
            0,
            15,
          ],
        },


        // =====================================================
        // ACTION DETAILS
        // =====================================================

        sectionHeading(
          data.Status
            ? `Action Details - ${data.Status}`
            : "Action Details",
        ),


        {
          table: {
            headerRows:
              1,

            dontBreakRows:
              true,

            widths: [
              38,
              "*",
              125,
              72,
              65,
            ],

            body:
              actionTableBody,
          },


          // ===================================================
          // SAME TYPE TABLE AS BREAKDOWN SPARE PARTS
          // ===================================================

          layout: {
            hLineColor: () =>
              COLORS.border,

            vLineColor: () =>
              COLORS.border,

            hLineWidth: () =>
              0.7,

            vLineWidth: () =>
              0.7,

            paddingLeft: () =>
              8,

            paddingRight: () =>
              8,

            paddingTop: () =>
              7,

            paddingBottom: () =>
              7,
          },
        },
      ],


      // =======================================================
      // FOOTER
      // Same As Breakdown PDF
      // =======================================================

      footer: () => ({
        margin: [
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

            margin: [
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


      // =======================================================
      // STYLES
      // =======================================================

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

          margin: [
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

          margin: [
            0,
            2,
            0,
            2,
          ],
        },
      },
    };


    // =========================================================
    // GENERATE PDF BUFFER
    // =========================================================

    const pdfBuffer =
      await new Promise(
        (
          resolve,
          reject,
        ) => {
          try {
            const pdfDocument =
              new PdfPrinter(
                MOM_DETAIL_PDF_FONTS,
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


    // =========================================================
    // RETURN
    // =========================================================

    return {
      success:
        true,

      message:
        "MOM detail PDF generated successfully.",

      data:
        pdfBuffer,

      fileName:
        `MOM-Detail-${meetingID}.pdf`,

      contentType:
        "application/pdf",
    };

  } catch (error) {
    console.error(
      "Generate MOM detail PDF error:",
      error,
    );

    return databaseFailure(
      error,
      "Unable to generate MOM detail PDF.",
    );
  }
};


module.exports = {
  createMOM,
  getMOMById,
  updateMOM,
  deleteMOM,
  getAllMOM,
  updateMOMStatus,
  getMOMSummaryReport,
  getMOMResponsiblePersonReport,
  getMOMActionDetailReport,
  getMOMTitles,
  getMOMActions,
  generateMOMListPdf,
  generateMOMResponsiblePersonReportPdf,
  generateMOMActionDetailReportPdf,
  generateMOMDetailPdf
};
