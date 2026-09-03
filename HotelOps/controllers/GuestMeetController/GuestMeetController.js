//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
// =========================================================Get Data From service
const GuestMeetService = require("../../services/GuestMeetService/GuestMeetService");

//=============================================================Queue integrate helper for all apis
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
 // Roomsinhouse is required
  if (
    Roomsinhouse === undefined ||
    Roomsinhouse === null ||
    Roomsinhouse === ""
  ) {
    return res.status(400).json({
      success: false,
      message: "Roomsinhouse is required.",
    });
  }
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
exports.getAllDailyEntries = async (req, res) => {
  try {
    const data = {
      OrganizationID: req.query.OrganizationID || null,
      EntryDate: req.query.EntryDate || null,
      page: Number(req.query.page) || 1,
      PageSize: Number(req.query.PageSize) || 10,
    };

    const response = await GuestMeetService.getAllDailyEntries(data);

    return res
      .status(response.statusCode || STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};
exports.deleteDailyEntry = async (req, res) => sendQueueResponse(
  req,
  res,
  "DELETE_GUEST_MEET_DAILY",
  { GMMasterID: req.body.GMMasterID, },
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
// Required fields validation
  if (
    GuestName === undefined ||
    GuestName === null ||
    GuestName.trim() === ""
  ) {
    return res.status(400).json({
      success: false,
      message: "GuestName is required.",
    });
  }

  if (
    RoomNo === undefined ||
    RoomNo === null ||
    RoomNo === ""
  ) {
    return res.status(400).json({
      success: false,
      message: "RoomNo is required.",
    });
  }

  if (
    MetBy === undefined ||
    MetBy === null ||
    MetBy === ""
  ) {
    return res.status(400).json({
      success: false,
      message: "MetBy is required.",
    });
  }
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
    GMDetailID: req.body.GMDetailID,
    Changes: req.body || {},
  },
);
exports.deleteGuestDetail = async (req, res) => sendQueueResponse(
  req,
  res,
  "DELETE_GUEST_MEET_DETAIL",
  { GMDetailID: req.body.GMDetailID,UserID: req.user.UserID, },
);
exports.getGuestDetailById = async (req, res) => {
  try {
    const response = await GuestMeetService.getGuestDetailById({
      GMDetailID: req.params.id,
    });

    return res.status(response.statusCode || STATUS_CODES.SUCCESS).json(response);
  } catch (error) {
    return handleError(error, res);
  }
};

// ============================================================ Report APIs
exports.getDateRangeReport = async (req, res) => {
  try {
    const data = {
      OrganizationID: req.query.OrganizationID || null,
      FromDate: req.query.FromDate || null,
      ToDate: req.query.ToDate || null,
      page: Number(req.query.page) || 1,
      PageSize: Number(req.query.PageSize) || 10,
    };

    const response = await GuestMeetService.getDateRangeReport(data);

    return res
      .status(response.statusCode || STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};
exports.getFeedbackReport = async (req, res) => {
  try {
    const data = {
      OrganizationID: req.query.OrganizationID || null,
      FromDate: req.query.FromDate || null,
      ToDate: req.query.ToDate || null,
    };

    const response = await GuestMeetService.getFeedbackReport(data);

    return res
      .status(response.statusCode || STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};
exports.getMetByReport = async (req, res) => {
  try {
    const data = {
      OrganizationID: req.query.OrganizationID || null,
      EntryDate: req.query.EntryDate || null,
      FromDate: req.query.FromDate || null,
      ToDate: req.query.ToDate || null,
    };

    const response = await GuestMeetService.getMetByReport(data);

    return res
      .status(response.statusCode || STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(error, res);
  }
};

// ============================================================ Report APIs PDfs
exports.getDateRangeReportPdf = async (req, res) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID || null,

      FromDate:
        req.query.FromDate || null,

      ToDate:
        req.query.ToDate || null,
    };

    const response =
      await GuestMeetService.generateDateRangeReportPdf(
        data,
      );

    if (!response.success) {
      return res
        .status(response.statusCode || 400)
        .json(response);
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(response.data);
  } catch (error) {
    return handleError(error, res);
  }
};
exports.getFeedbackReportPdf = async (req, res) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID || null,

      FromDate:
        req.query.FromDate || null,

      ToDate:
        req.query.ToDate || null,

      logoUrl:
        req.query.logoUrl || null,
    };

    const response =
      await GuestMeetService.generateFeedbackReportPdf(
        data,
      );

    if (!response.success) {
      return res
        .status(response.statusCode || 400)
        .json(response);
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(response.data);
  } catch (error) {
    return handleError(error, res);
  }
};
exports.getMetByReportPdf = async (req, res) => {
  try {
    const data = {
      OrganizationID:
        req.query.OrganizationID || null,

      FromDate:
        req.query.FromDate || null,

      ToDate:
        req.query.ToDate || null,

      logoUrl:
        req.query.logoUrl || null,
    };

    const response =
      await GuestMeetService.generateMetByReportPdf(
        data,
      );

    if (!response.success) {
      return res
        .status(response.statusCode || 400)
        .json(response);
    }

    res.setHeader(
      "Content-Type",
      response.contentType,
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${response.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      response.data.length,
    );

    return res
      .status(200)
      .send(response.data);
  } catch (error) {
    return handleError(error, res);
  }
};
exports.generateGuestDetailPdf = async (req, res) => {
  try {
    const result =
      await GuestMeetService.generateGuestDetailPdf({
        OrganizationID: req.query.OrganizationID,
        GMDetailID: req.params.id,
        UserID: req.user?.UserID || null,
      });

    if (!result?.success) {
      return res.status(result?.statusCode || 400).json({
        success: false,
        message:
          result?.message ||
          "Unable to generate guest detail PDF.",
        ...(result?.error
          ? { error: result.error }
          : {}),
      });
    }

    // Prefer the standard direct Buffer response used by the other Guest Meet
    // PDF services, while retaining compatibility with the older Base64 DTO.
    const pdfBuffer =
      (Buffer.isBuffer(result.pdfBuffer) && result.pdfBuffer) ||
      (Buffer.isBuffer(result.data) && result.data) ||
      (Buffer.isBuffer(result.data?.pdfBuffer) && result.data.pdfBuffer) ||
      (typeof result.data?.FileData === "string" && result.data.FileData
        ? Buffer.from(result.data.FileData, "base64")
        : null);

    const fileName =
      result.fileName ||
      result.data?.fileName ||
      result.data?.FileName ||
      `Guest-Detail-${req.params.id}.pdf`;

    if (!Buffer.isBuffer(pdfBuffer)) {
      console.error("Invalid PDF service response:", {
        success: result?.success,
        hasDirectBuffer: Buffer.isBuffer(result?.pdfBuffer),
        hasDataBuffer: Buffer.isBuffer(result?.data),
        hasNestedPdfBuffer: Buffer.isBuffer(
          result?.data?.pdfBuffer,
        ),
        hasLegacyFileData:
          typeof result?.data?.FileData === "string",
        resultKeys: Object.keys(result || {}),
        dataKeys: Object.keys(result?.data || {}),
      });

      return res.status(500).json({
        success: false,
        message:
          "PDF buffer was not returned by the service.",
      });
    }

    res.setHeader(
      "Content-Type",
      result.contentType || result.data?.MimeType || "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      String(pdfBuffer.length),
    );

    return res.end(pdfBuffer);
  } catch (error) {
    console.error(
      "Generate guest detail PDF controller error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to generate guest detail PDF.",
      error: error.message,
    });
  }
};
