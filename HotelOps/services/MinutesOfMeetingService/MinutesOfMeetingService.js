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
const ok = (message, data) => ({
  success: true,
  message,
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
      "Meeting created successfully.",
      {
        MeetingID: Number(meetingID),
      },
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
            SrNo = $4,
            ModifiedBy = $5,
            ModifiedDate = CURRENT_TIMESTAMP
          WHERE ActionID = $6
            AND MeetingID = $7
            AND IsDeleted = FALSE;
          `,
          [
            item.Action,
            item.ResponsiblePerson || [],
            item.Deadline || null,
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




module.exports = {
  createMOM,
  getMOMById,
  updateMOM,
};