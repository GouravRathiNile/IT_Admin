const { pool } = require("../../db");
const { retryableDatabaseResponse,} = require("../../utils/retryableDatabaseError");
const { formatDate } = require("../../utils/dateFormatter");
// ===============================================Pdf Helper
const { generatePdf, loadLogo } = require("../../utils/pdfHelper");
const PdfPrinter = require("pdfmake");
const path = require("path");
const  MOM_DETAIL_PDF_FONTS = {
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
// ============================================================ Generate MOM List PDF
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
    ];


    // ============================================================ Metadata

    const metadata = [];

    if (data.OrganizationID && records.length > 0) {
      metadata.push({
        label: "Organization",
        value:
          records[0].OrganizationShortName ||
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

    metadata.push({
      label: "Total Meetings",
      value: records.length,
    });


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
};
