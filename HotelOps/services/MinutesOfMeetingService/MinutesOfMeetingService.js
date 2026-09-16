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
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        0.00,
        'Active',
        FALSE,
        $9,
        CURRENT_TIMESTAMP
      )
      RETURNING MeetingID
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
      ]
    );

    const meetingID = masterResult.rows[0].meetingid;


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
    $1, $2, $3, $4, $5,
    'Pending',
    $6,
    FALSE,
    $7,
    CURRENT_TIMESTAMP
  )
  `,
  [
    meetingID,
    OrganizationID,
    item.Action,
    item.ResponsiblePerson || [],
    item.Deadline || null,
    item.SrNo || i + 1,
    UserID,
  ]
);
    }


    // ============================================================ Commit

    await client.query("COMMIT");

    return {
      success: true,
      message: "MOM created successfully.",
      data: {
        MeetingID: meetingID,
      },
    };

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Create MOM Error:", error);

    return {
      success: false,
      statusCode: 500,
      message: "Unable to create MOM.",
    };

  } finally {
    client.release();
  }
};


module.exports = {
  createMOM,
};