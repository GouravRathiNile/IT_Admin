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
      OrganizationID: req.query.OrganizationID || null,
      FromDate: req.query.FromDate || null,
      ToDate: req.query.ToDate || null,

      // PDF mein pagination nahi rakhi hai.
      // Saare guest records fetch honge.
      page: 1,
      PageSize: 10000,
    };

    // =====================================================
    // Required fields validation
    // =====================================================

    if (!data.OrganizationID || !data.FromDate || !data.ToDate) {
      return res.status(400).json({
        success: false,
        message: "OrganizationID, FromDate and ToDate are required.",
      });
    }

    // =====================================================
    // Report data fetch
    // =====================================================

    const response =
      await GuestMeetService.getDateRangeReport(data);

    if (!response.success) {
      return res
        .status(response.statusCode || 400)
        .json(response);
    }

    const report = response.data?.[0];

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "No Guest Meet report data found for the selected date range.",
      });
    }

    // =====================================================
    // PDF generate
    // =====================================================

    const pdfBuffer = await generatePdf({
      title: "Guest Meet Date Range Report",
      reportName: "Guest Meet Date Range Report",

      organizationId: report.OrganizationID,

      orientation: "landscape",

      pageMargins: [20, 24, 20, 34],

      metadata: [
        {
          label: "Organization ID",
          value: report.OrganizationID,
        },
        {
          label: "Date Range",
          value: `${report.EntryDateFrom} - ${report.EntryDateTo}`,
        },
        {
          label: "Rooms In House",
          value: report.Roomsinhouse,
        },
        {
          label: "Guests In House",
          value: report.Guestsinhouse,
        },
        {
          label: "Arrivals",
          value: report.Arrivals,
        },
        {
          label: "Departures",
          value: report.Departures,
        },
        {
          label: "Average Occupancy",
          value: `${report.Occupancy}%`,
        },
        {
          label: "Total Guest Records",
          value: response.TotalCount || report.GuestDetails?.length || 0,
        },
      ],

      columns: [
        {
          header: "S.No.",
          value: (_row, index) => index + 1,
          width: 28,
          align: "center",
        },
        {
          header: "Guest Name",
          key: "GuestName",
          width: 80,
        },
        {
          header: "Room No.",
          key: "RoomNo",
          width: 42,
          align: "center",
        },
        {
          header: "Booking Source",
          key: "BookingSource",
          width: 65,
        },
        {
          header: "Arrival",
          key: "Arrival",
          width: 55,
          align: "center",
        },
        {
          header: "Departure",
          key: "Departure",
          width: 55,
          align: "center",
        },
        {
          header: "Feedback",
          key: "Feedback",
          width: "*",
        },
        {
          header: "Action Taken",
          key: "ActionTaken",
          width: "*",
        },
        {
          header: "Met By",
          key: "MetBy",
          width: 38,
          align: "center",
        },
        {
          header: "Met On",
          key: "MetOn",
          width: 55,
          align: "center",
        },
        {
          header: "Feedback Type",
          key: "FeedbackType",
          width: 58,
          align: "center",
        },
        {
          header: "Guest Status",
          key: "GuestStatus",
          width: 52,
          align: "center",
        },
      ],

      rows: report.GuestDetails || [],

      styles: {
        pdfTitle: {
          fontSize: 17,
          bold: true,
          color: "#082B5C",
        },
        pdfTableHeader: {
          fontSize: 7,
          bold: true,
          color: "#FFFFFF",
        },
        pdfTableCell: {
          fontSize: 6.8,
          color: "#172033",
        },
      },

      tableOptions: {
        table: {
          headerRows: 1,
          dontBreakRows: false,
        },
        layout: {
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    });

    // =====================================================
    // File name
    // =====================================================

    const fromDate = String(data.FromDate).replaceAll("/", "-");
    const toDate = String(data.ToDate).replaceAll("/", "-");

    const fileName =
      `Guest-Meet-Report-${fromDate}-to-${toDate}.pdf`;

    // =====================================================
    // PDF response
    // =====================================================

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`,
    );

    res.setHeader("Content-Length", pdfBuffer.length);

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("Guest Meet PDF generation error:", error);

    return handleError(error, res);
  }
};