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
// ============================================================ Create / Update MOM
exports.saveMOM = async (req, res) => {
  try {
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

    // ============================================================ Date Validation

    validateDateFormat(MeetingDate, "Meeting Date");
    validateDateFormat(NextReviewDate, "Next Review Date");

    for (const item of Actions || []) {
      validateDateFormat(item.Deadline, "Deadline");

      if (
        item.Status !== undefined &&
        !["pending", "completed"].includes(
          String(item.Status).trim().toLowerCase(),
        )
      ) {
        throw new AppError(
          "Action Status must be Pending or Completed",
          STATUS_CODES.BAD_REQUEST,
        );
      }
    }

    // ============================================================ Create / Update Check

    const isCreate =
      MeetingID === undefined ||
      MeetingID === null ||
      String(MeetingID).trim() === "" ||
      Number(MeetingID) === 0;

    if (!isCreate && (!Number.isInteger(Number(MeetingID)) || Number(MeetingID) <= 0)) {
      throw new AppError(
        "Meeting ID must be a valid positive integer",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    // ============================================================ Data

    const data = {
      OrganizationID,
      Title,
      MeetingDate,
      MeetingTime: MeetingTime || null,
      NextReviewDate: NextReviewDate || null,

      NotesTaker: NotesTaker || [],
      Attendees: Attendees || [],
      Absentees: Absentees || [],

      Actions: (Actions || []).map((item) => ({
        ...item,
        ...(item.Status !== undefined
          ? {
              Status:
                String(item.Status).trim().toLowerCase() === "completed"
                  ? "Completed"
                  : "Pending",
            }
          : {}),
      })),
    };

    // ============================================================ Create

    if (isCreate) {
      return sendQueueResponse(
        req,
        res,
        "CREATE_MOM",
        data,
        STATUS_CODES.CREATED,
      );
    }

    // ============================================================ Update

    data.MeetingID = Number(MeetingID);
    data.DeleteActionIDs = DeleteActionIDs || [];

    return sendQueueResponse(
      req,
      res,
      "UPDATE_MOM",
      data,
    );

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ Get MOM By ID
exports.getMOMById = async (req, res) => {
  try {
    const { MeetingID } = req.params;

    if (!MeetingID) {
      throw new AppError(
        "Meeting ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response = await MinutesOfMeetingService.getMOMById({
      MeetingID,
    });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch MOM",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ Delete MOM
exports.deleteMOM = async (req, res) => {
  try {
    const { MeetingID } = req.body || {};

    if (!MeetingID) {
      throw new AppError(
        "Meeting ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    return sendQueueResponse(
      req,
      res,
      "DELETE_MOM",
      {
        MeetingID,
      },
    );

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ MOM List
exports.getAllMOM = async (req, res) => {
  try {
    const {
      OrganizationID,
      Status,
      FromDate,
      ToDate,
      page,
      PageSize,
    } = req.query;

    validateDateFormat(FromDate, "From Date");
    validateDateFormat(ToDate, "To Date");

    if (FromDate && ToDate && FromDate > ToDate) {
      throw new AppError(
        "From Date cannot be greater than To Date",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await MinutesOfMeetingService.getAllMOM({
        OrganizationID,
        Status,
        FromDate,
        ToDate,
        page,
        PageSize,
      });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch MOM list",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};
// ============================================================ Update MOM Status
exports.updateMOMStatus = async (req, res) => {
  try {
    const {
      MeetingID,
      Status,
    } = req.body || {};

    if (!MeetingID) {
      throw new AppError(
        "Meeting ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!Status) {
      throw new AppError(
        "Status is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (!["Active", "Archive"].includes(Status)) {
      throw new AppError(
        "Status must be Active or Archive",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    return sendQueueResponse(
      req,
      res,
      "UPDATE_MOM_STATUS",
      {
        MeetingID,
        Status,
      },
    );

  } catch (error) {
    return handleError(error, res);
  }
};
