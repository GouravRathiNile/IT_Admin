//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
// =========================================================Get Data From service
const MinutesOfMeetingService = require("../../services/MinutesOfMeetingService/MinutesOfMeetingService");


// ============================ Queue Helper
const sendQueueResponse = async (
  req,
  res,
  action,
  data,
  successCode = STATUS_CODES.SUCCESS,
) => {
  try {
    const response = await producer.sendMessage(
      QUEUE.MOM.REQUEST,
      QUEUE.MOM.RESPONSE,
      {
        action,

        data: {
          ...data,

          // Trusted JWT Fields
          UserID: req.user.UserID,
          UserType: req.user.UserType,
          DepartmentName: req.user.DepartmentName,
          LoginType: req.user.LoginType,
          AllOrganizationAccess: req.user.AllOrganizationAccess,
        },
      },
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to process MOM request.",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(response.queued ? 202 : successCode)
      .json(response);

  } catch (error) {
    if (
      ["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(
        error.message,
      )
    ) {
      return handleError(
        new AppError(
          "MOM service is temporarily unavailable.",
          STATUS_CODES.SERVICE_UNAVAILABLE,
        ),
        res,
      );
    }

    return handleError(error, res);
  }
};
// ============================ Date Validation Helper
const validateDateFormat = (value, fieldName) => {
  if (!value) return;

  const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateFormat.test(value)) {
    throw new AppError(
      `${fieldName} must be in YYYY-MM-DD format`,
      STATUS_CODES.BAD_REQUEST,
    );
  }
};
// ============================================================ Create MOM
exports.createMOM = async (req, res) => {
  try {
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
    } = req.body || {};

    if (!OrganizationID) {
      throw new AppError(
        "Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!Title) {
      throw new AppError(
        "Title is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!MeetingDate) {
      throw new AppError(
        "Meeting Date is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================ Date Format Validation

    validateDateFormat(MeetingDate, "Meeting Date");
    validateDateFormat(NextReviewDate, "Next Review Date");

    for (const item of Actions || []) {
      validateDateFormat(item.Deadline, "Deadline");
    }

    const data = {
      OrganizationID,
      Title,
      MeetingDate,
      MeetingTime: MeetingTime || null,
      NextReviewDate: NextReviewDate || null,

      NotesTaker: NotesTaker || [],
      Attendees: Attendees || [],
      Absentees: Absentees || [],

      Actions: Actions || [],
    };

    return sendQueueResponse(
      req,
      res,
      "CREATE_MOM",
      data,
      STATUS_CODES.CREATED,
    );

  } catch (error) {
    return handleError(error, res);
  }
};