const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
const STATUS_CODES = require("../../utils/statusCodes");

// Send every Guest Meet request through RabbitMQ and return its response.
const sendQueueResponse = async (req, res, action, data, successCode = STATUS_CODES.SUCCESS) => {
  try {
    const response = await producer.sendMessage(
      QUEUE.GUEST_MEET.REQUEST,
      QUEUE.GUEST_MEET.RESPONSE,
      {
        action,
        data: {
          ...data,
          UserID: req.user.UserID,
        },
      },
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to process Guest Meet request",
        response.statusCode || STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res.status(response.queued ? 202 : successCode).json(response);
  } catch (error) {
    if (["Response Timeout", "RabbitMQ Channel Not Initialized"].includes(error.message)) {
      return handleError(
        new AppError("Guest Meet service is temporarily unavailable.", STATUS_CODES.SERVICE_UNAVAILABLE),
        res,
      );
    }
    return handleError(error, res);
  }
};

// ============================================================ Daily Entry APIs
exports.createDailyEntry = async (req, res) => {
  const {
    OrganizationID,
    EntryDate,
    Roomsinhouse,
    Guestsinhouse,
    Arrivals,
    Departures,
    Occupancy,
  } = req.body || {};

  return sendQueueResponse(
    req,
    res,
    "CREATE_GUEST_MEET_DAILY",
    {
      OrganizationID,
      EntryDate,
      Roomsinhouse,
      Guestsinhouse,
      Arrivals,
      Departures,
      Occupancy,
    },
    STATUS_CODES.CREATED,
  );
};

exports.getAllDailyEntries = async (req, res) => sendQueueResponse(
  req,
  res,
  "GET_ALL_GUEST_MEET_DAILY",
  {
    OrganizationID: req.query.OrganizationID || null,
    EntryDate: req.query.EntryDate || null,
    FromDate: req.query.FromDate || null,
    ToDate: req.query.ToDate || null,
    page: Number(req.query.page) || 1,
    PageSize: Number(req.query.PageSize) || 10,
  },
);

exports.deleteDailyEntry = async (req, res) => sendQueueResponse(
  req,
  res,
  "DELETE_GUEST_MEET_DAILY",
  { GMMasterID: req.params.id },
);

// ============================================================ Guest Detail APIs
exports.createGuestDetail = async (req, res) => {
  const {
    OrganizationID,
    GMMasterID,
    GuestName,
    RoomNo,
    BookingSource,
    Arrival,
    Departure,
    Feedback,
    ActionTaken,
    MetBy,
    MetOn,
    FeedbackType,
    GuestStatus,
  } = req.body || {};

  return sendQueueResponse(req, res, "CREATE_GUEST_MEET_DETAIL", {
    OrganizationID,
    GMMasterID,
    GuestName,
    RoomNo,
    BookingSource,
    Arrival,
    Departure,
    Feedback,
    ActionTaken,
    MetBy,
    MetOn,
    FeedbackType,
    GuestStatus,
  }, STATUS_CODES.CREATED);
};

exports.updateGuestDetail = async (req, res) => sendQueueResponse(
  req,
  res,
  "UPDATE_GUEST_MEET_DETAIL",
  {
    GMDetailID: req.params.id,
    Changes: req.body || {},
  },
);

exports.deleteGuestDetail = async (req, res) => sendQueueResponse(
  req,
  res,
  "DELETE_GUEST_MEET_DETAIL",
  { GMDetailID: req.params.id },
);

exports.getGuestDetailById = async (req, res) => sendQueueResponse(
  req,
  res,
  "GET_GUEST_MEET_DETAIL",
  { GMDetailID: req.params.id },
);

// ============================================================ Report APIs
exports.getDateRangeReport = async (req, res) => sendQueueResponse(
  req,
  res,
  "REPORT_GUEST_MEET_DATE_RANGE",
  {
    OrganizationID: req.query.OrganizationID || null,
    EntryDate: req.query.EntryDate || null,
    FromDate: req.query.FromDate || null,
    ToDate: req.query.ToDate || null,
    page: Number(req.query.page) || 1,
    PageSize: Number(req.query.PageSize) || 10,
  },
);

exports.getFeedbackReport = async (req, res) => sendQueueResponse(
  req,
  res,
  "REPORT_GUEST_MEET_FEEDBACK",
  {
    OrganizationID: req.query.OrganizationID || null,
    EntryDate: req.query.EntryDate || null,
    FromDate: req.query.FromDate || null,
    ToDate: req.query.ToDate || null,
  },
);

exports.getSummaryReport = async (req, res) => sendQueueResponse(
  req,
  res,
  "REPORT_GUEST_MEET_SUMMARY",
  {
    OrganizationID: req.query.OrganizationID || null,
    EntryDate: req.query.EntryDate || null,
    FromDate: req.query.FromDate || null,
    ToDate: req.query.ToDate || null,
  },
);

exports.getMetByReport = async (req, res) => sendQueueResponse(
  req,
  res,
  "REPORT_GUEST_MEET_MET_BY",
  {
    OrganizationID: req.query.OrganizationID || null,
    EntryDate: req.query.EntryDate || null,
    FromDate: req.query.FromDate || null,
    ToDate: req.query.ToDate || null,
  },
);
