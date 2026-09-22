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
      Title,
      Status,
      CompletionStatus,
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

    if (
      CompletionStatus &&
      !["completed", "pending"].includes(
        String(CompletionStatus).trim().toLowerCase(),
      )
    ) {
      throw new AppError(
        "Completion Status must be Completed or Pending",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await MinutesOfMeetingService.getAllMOM({
        OrganizationID,
        Title,
        Status,
        CompletionStatus,
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
// ============================================================ Get MOM Titles 
exports.getMOMTitles = async (req, res) => {
  try {
    const { OrganizationID } = req.query;

    if (!OrganizationID) {
      throw new AppError(
        "Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await MinutesOfMeetingService.getMOMTitles({
        OrganizationID,
      });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch MOM titles",
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
// ============================================================ Get MOM Actions
exports.getMOMActions = async (req, res) => {
  try {
    const { OrganizationID } = req.query;

    if (!OrganizationID) {
      throw new AppError(
        "Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await MinutesOfMeetingService.getMOMActions({
        OrganizationID,
      });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch MOM actions",
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
// ===================================================================== Report
// ============================================================ MOM Summary Report
exports.getMOMSummaryReport = async (req, res) => {
  try {
    const {
      OrganizationID,
      FromDate,
      ToDate,
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
      await MinutesOfMeetingService.getMOMSummaryReport({
        OrganizationID,
        FromDate,
        ToDate,
      });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch MOM summary report",
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
// ============================================================ Responsible Person Count Wise Report
exports.getMOMResponsiblePersonReport = async (req, res) => {
  try {
    const {
      OrganizationID,
      ResponsiblePersonID,
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
      await MinutesOfMeetingService.getMOMResponsiblePersonReport({
        OrganizationID,
        ResponsiblePersonID,
        FromDate,
        ToDate,
        page,
        PageSize,
      });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch responsible person report",
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
// ============================================================ Responsible Person Details Wise Report
exports.getMOMResponsiblePersonDetailReport = async (
  req,
  res,
) => {
  try {
    const {
      OrganizationID,
      ResponsiblePersonID,
      Title,
      FromDate,
      ToDate,
      page,
      PageSize,
    } = req.query;


    // ============================================================
    // Date Validation
    // ============================================================

    validateDateFormat(
      FromDate,
      "From Date",
    );

    validateDateFormat(
      ToDate,
      "To Date",
    );


    if (
      FromDate &&
      ToDate &&
      FromDate > ToDate
    ) {
      throw new AppError(
        "From Date cannot be greater than To Date",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const response =
      await MinutesOfMeetingService
        .getMOMResponsiblePersonDetailReport({
          OrganizationID:
            OrganizationID || null,

          ResponsiblePersonID:
            ResponsiblePersonID || null,

          Title:
            Title || null,

          FromDate:
            FromDate || null,

          ToDate:
            ToDate || null,

          page:
            page || 1,

          PageSize:
            PageSize || 10,
        });


    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch responsible person detail report",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }


    return res
      .status(
        STATUS_CODES.SUCCESS,
      )
      .json(response);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ Action Detail Report
exports.getMOMActionDetailReport = async (req, res) => {
  try {
    const {
      OrganizationID,
      ResponsiblePersonId,
      ResponsiblePersonID,
      Title,
      Action,
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
      await MinutesOfMeetingService.getMOMActionDetailReport({
        OrganizationID,
        ResponsiblePersonId:
          ResponsiblePersonId || ResponsiblePersonID,
        Title,
        Action,
        Status,
        FromDate,
        ToDate,
        page,
        PageSize,
      });

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch MOM action detail report",
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
// ===================================================================== Pdfs
// ============================================================ MOM List PDF
exports.getMOMListPdf = async (req, res) => {
  try {
    const {
      OrganizationID,
      Title,
      Status,
      CompletionStatus,
      FromDate,
      ToDate,
    } = req.query;


    // ============================================================ Date Validation

    validateDateFormat(
      FromDate,
      "From Date",
    );

    validateDateFormat(
      ToDate,
      "To Date",
    );

    if (
      FromDate &&
      ToDate &&
      FromDate > ToDate
    ) {
      throw new AppError(
        "From Date cannot be greater than To Date",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    if (
      CompletionStatus &&
      !["completed", "pending"].includes(
        String(CompletionStatus).trim().toLowerCase(),
      )
    ) {
      throw new AppError(
        "Completion Status must be Completed or Pending",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const data = {
      OrganizationID:
        OrganizationID || null,

      Title:
        Title || null,

      Status:
        Status || null,

      CompletionStatus:
        CompletionStatus || null,

      FromDate:
        FromDate || null,

      ToDate:
        ToDate || null,
    };


    const response =
      await MinutesOfMeetingService
        .generateMOMListPdf(data);


    if (!response.success) {
      return res
        .status(
          response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        )
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
      .status(STATUS_CODES.SUCCESS)
      .send(response.data);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ Responsible Person Report PDF
exports.getMOMResponsiblePersonReportPdf = async (
  req,
  res,
) => {
  try {
    const {
      OrganizationID,
      ResponsiblePersonID,
      FromDate,
      ToDate,
    } = req.query;


    validateDateFormat(
      FromDate,
      "From Date",
    );

    validateDateFormat(
      ToDate,
      "To Date",
    );


    if (
      FromDate &&
      ToDate &&
      FromDate > ToDate
    ) {
      throw new AppError(
        "From Date cannot be greater than To Date",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const data = {
      OrganizationID:
        OrganizationID || null,

      ResponsiblePersonID:
        ResponsiblePersonID || null,

      FromDate:
        FromDate || null,

      ToDate:
        ToDate || null,
    };


    const response =
      await MinutesOfMeetingService
        .generateMOMResponsiblePersonReportPdf(
          data,
        );


    if (!response.success) {
      return res
        .status(
          response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        )
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
      .status(STATUS_CODES.SUCCESS)
      .send(response.data);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ MOM Action Detail Report PDF
exports.getMOMActionDetailReportPdf = async (
  req,
  res,
) => {
  try {
    const {
      OrganizationID,
      Title,
      Action,
      Status,
      ResponsiblePersonId,
      FromDate,
      ToDate,
    } = req.query;


    // ============================================================ Date Validation

    validateDateFormat(
      FromDate,
      "From Date",
    );

    validateDateFormat(
      ToDate,
      "To Date",
    );


    if (
      FromDate &&
      ToDate &&
      FromDate > ToDate
    ) {
      throw new AppError(
        "From Date cannot be greater than To Date",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const data = {
      OrganizationID:
        OrganizationID || null,

      Title:
        Title || null,

      Action:
        Action || null,

      Status:
        Status || null,

      ResponsiblePersonId:
        ResponsiblePersonId || null,

      FromDate:
        FromDate || null,

      ToDate:
        ToDate || null,
    };


    const response =
      await MinutesOfMeetingService
        .generateMOMActionDetailReportPdf(
          data,
        );


    if (!response.success) {
      return res
        .status(
          response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        )
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
      .status(STATUS_CODES.SUCCESS)
      .send(response.data);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ MOM Detail PDF
exports.generateMOMDetailPdf = async (
  req,
  res,
) => {
  try {
    const { MeetingID } = req.params;

    const { Status } = req.query;


    if (!MeetingID) {
      throw new AppError(
        "Meeting ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const result =
      await MinutesOfMeetingService
        .generateMOMDetailPdf({
          MeetingID,
          Status:
            Status || null,
        });


    if (!result.success) {
      return res
        .status(
          result.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        )
        .json(result);
    }


    res.setHeader(
      "Content-Type",
      result.contentType ||
        "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`,
    );

    res.setHeader(
      "Content-Length",
      result.data.length,
    );


    return res
      .status(STATUS_CODES.SUCCESS)
      .send(result.data);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ Responsible Person Detail Report PDF
exports.getMOMResponsiblePersonDetailReportPdf = async (
  req,
  res,
) => {
  try {
    const {
      OrganizationID,
      Title,
      FromDate,
      ToDate,
      ResponsiblePersonID,
    } = req.query;


    // ============================================================
    // Date Validation
    // ============================================================

    validateDateFormat(
      FromDate,
      "From Date",
    );

    validateDateFormat(
      ToDate,
      "To Date",
    );


    if (
      FromDate &&
      ToDate &&
      FromDate > ToDate
    ) {
      throw new AppError(
        "From Date cannot be greater than To Date",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const data = {
      OrganizationID:
        OrganizationID || null,

      Title:
        Title || null,

      FromDate:
        FromDate || null,

      ToDate:
        ToDate || null,

      ResponsiblePersonID:
        ResponsiblePersonID || null,
    };


    const response =
      await MinutesOfMeetingService
        .generateMOMResponsiblePersonDetailReportPdf(
          data,
        );


    if (!response.success) {
      return res
        .status(
          response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        )
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
      .status(
        STATUS_CODES.SUCCESS,
      )
      .send(
        response.data,
      );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
