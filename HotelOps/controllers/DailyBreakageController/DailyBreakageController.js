//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
// =========================================================Get Data From service
const DailyBreakageService = require("../../services/DailyBreakageService/DailyBreakageService");

// ======================Date Validation Helpers
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
// ======================user Validation Helpers
const authenticatedUser = (req) => {
  const UserID = Number(req.user?.UserID);

  if (!Number.isInteger(UserID) || UserID <= 0) {
    throw new AppError(
      "Invalid authenticated user.",
      STATUS_CODES.UNAUTHORIZED,
    );
  }

  return {
    UserID,
    UserType: req.user.UserType,
    DepartmentName: req.user.DepartmentName,
    LoginType: req.user.LoginType,
    AllOrganizationAccess: req.user.AllOrganizationAccess,
  };
};
// ======================= Queue Helper
const sendQueueResponse = async (
  req,
  res,
  action,
  data,
  successCode = STATUS_CODES.SUCCESS,
) => {
  try {

    const user = authenticatedUser(req);

    const response = await producer.sendMessage(
      QUEUE.DAILY_BREAKAGE.REQUEST,
      QUEUE.DAILY_BREAKAGE.RESPONSE,
      {
        action,

        data: {
          ...data,

          // Trusted JWT Fields
          ...user,
        },
      },
    );


    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to process Daily Breakage request.",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }


    return res
      .status(
        response.queued
          ? 202
          : successCode,
      )
      .json(response);

  } catch (error) {

    if (
      [
        "Response Timeout",
        "RabbitMQ Channel Not Initialized",
      ].includes(error.message)
    ) {
      return handleError(
        new AppError(
          "Daily Breakage service is temporarily unavailable.",
          STATUS_CODES.SERVICE_UNAVAILABLE,
        ),
        res,
      );
    }

    return handleError(error, res);
  }
};
// ============================================================Create Daily Breakage
exports.createDailyBreakage = async (req, res) => {
  try {
    const {
      OrganizationID,
      Outlet,
      EntryDate,
      Details,
    } = req.body || {};


    // ============================================================
    // Organization Validation
    // ============================================================

    if (
      !OrganizationID ||
      !Number.isInteger(Number(OrganizationID)) ||
      Number(OrganizationID) <= 0
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    // ============================================================
    // Outlet Validation
    // ============================================================

    if (
      !Outlet ||
      !String(Outlet).trim()
    ) {
      throw new AppError(
        "Outlet is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    // ============================================================
    // Entry Date Validation
    // ============================================================

    if (!EntryDate) {
      throw new AppError(
        "Entry Date is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    validateDateFormat(
      EntryDate,
      "Entry Date",
    );


    // ============================================================
    // Details Validation
    // ============================================================

    if (
      !Array.isArray(Details) ||
      Details.length === 0
    ) {
      throw new AppError(
        "At least one breakage detail is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const normalizedDetails =
      Details.map((item, index) => {

        if (
          !item.Item ||
          !String(item.Item).trim()
        ) {
          throw new AppError(
            `Item is required at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        const nos =
          Number(item.Nos);

        if (
          !Number.isFinite(nos) ||
          nos <= 0
        ) {
          throw new AppError(
            `Nos must be greater than 0 at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        if (
          !item.PersonResponsible ||
          !String(
            item.PersonResponsible,
          ).trim()
        ) {
          throw new AppError(
            `Person Responsible is required at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        const totalCost =
          Number(item.TotalCost);

        if (
          !Number.isFinite(totalCost) ||
          totalCost < 0
        ) {
          throw new AppError(
            `Valid Total Cost is required at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        return {
          Item:
            String(item.Item).trim(),

          Nos:
            nos,

          PersonResponsible:
            String(
              item.PersonResponsible,
            ).trim(),

          TotalCost:
            totalCost,
        };
      });


    // ============================================================
    // Payload
    // ============================================================

    const data = {
      OrganizationID:
        Number(OrganizationID),

      Outlet:
        String(Outlet).trim(),

      EntryDate,

      Details:
        normalizedDetails,
    };


    // ============================================================
    // RabbitMQ
    // ============================================================

    return sendQueueResponse(
      req,
      res,
      "CREATE_DAILY_BREAKAGE",
      data,
      STATUS_CODES.CREATED,
    );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Update Daily Breakage
exports.updateDailyBreakage = async (req, res) => {
  try {
    const {
      DailyBreakageID,
      OrganizationID,
      Outlet,
      EntryDate,
      Details,
      DeleteDetailIDs,
    } = req.body || {};


    // ============================================================
    // Daily Breakage ID Validation
    // ============================================================

    if (
      !DailyBreakageID ||
      !Number.isInteger(
        Number(DailyBreakageID),
      ) ||
      Number(DailyBreakageID) <= 0
    ) {
      throw new AppError(
        "Valid Daily Breakage ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    // ============================================================
    // Organization Validation
    // ============================================================

    if (
      !OrganizationID ||
      !Number.isInteger(Number(OrganizationID)) ||
      Number(OrganizationID) <= 0
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    // ============================================================
    // Outlet Validation
    // ============================================================

    if (
      !Outlet ||
      !String(Outlet).trim()
    ) {
      throw new AppError(
        "Outlet is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    // ============================================================
    // Entry Date Validation
    // ============================================================

    if (!EntryDate) {
      throw new AppError(
        "Entry Date is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    validateDateFormat(
      EntryDate,
      "Entry Date",
    );


    // ============================================================
    // Details Validation
    // ============================================================

    if (
      !Array.isArray(Details) ||
      Details.length === 0
    ) {
      throw new AppError(
        "At least one breakage detail is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const normalizedDetails =
      Details.map((item, index) => {

        // ========================================================
        // Detail ID Validation - Only if provided
        // ========================================================

        let dailyBreakageDetailID = null;

        if (
          item.DailyBreakageDetailID !== undefined &&
          item.DailyBreakageDetailID !== null &&
          String(
            item.DailyBreakageDetailID,
          ).trim() !== ""
        ) {
          if (
            !Number.isInteger(
              Number(
                item.DailyBreakageDetailID,
              ),
            ) ||
            Number(
              item.DailyBreakageDetailID,
            ) <= 0
          ) {
            throw new AppError(
              `Valid Daily Breakage Detail ID is required at row ${index + 1}`,
              STATUS_CODES.BAD_REQUEST,
            );
          }

          dailyBreakageDetailID =
            Number(
              item.DailyBreakageDetailID,
            );
        }


        // ========================================================
        // Item
        // ========================================================

        if (
          !item.Item ||
          !String(item.Item).trim()
        ) {
          throw new AppError(
            `Item is required at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        // ========================================================
        // Nos
        // ========================================================

        const nos =
          Number(item.Nos);

        if (
          !Number.isFinite(nos) ||
          nos <= 0
        ) {
          throw new AppError(
            `Nos must be greater than 0 at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        // ========================================================
        // Person Responsible
        // ========================================================

        if (
          !item.PersonResponsible ||
          !String(
            item.PersonResponsible,
          ).trim()
        ) {
          throw new AppError(
            `Person Responsible is required at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        // ========================================================
        // Total Cost
        // ========================================================

        const totalCost =
          Number(item.TotalCost);

        if (
          !Number.isFinite(totalCost) ||
          totalCost < 0
        ) {
          throw new AppError(
            `Valid Total Cost is required at row ${index + 1}`,
            STATUS_CODES.BAD_REQUEST,
          );
        }


        return {
          DailyBreakageDetailID:
            dailyBreakageDetailID,

          Item:
            String(item.Item).trim(),

          Nos:
            nos,

          PersonResponsible:
            String(
              item.PersonResponsible,
            ).trim(),

          TotalCost:
            totalCost,
        };
      });


    // ============================================================
    // Delete Detail IDs Validation
    // ============================================================

    const normalizedDeleteDetailIDs =
      Array.isArray(DeleteDetailIDs)
        ? DeleteDetailIDs.map(
            (id, index) => {

              const detailID =
                Number(id);

              if (
                !Number.isInteger(
                  detailID,
                ) ||
                detailID <= 0
              ) {
                throw new AppError(
                  `Invalid Delete Detail ID at index ${index}`,
                  STATUS_CODES.BAD_REQUEST,
                );
              }

              return detailID;
            },
          )
        : [];


    // ============================================================
    // Payload
    // ============================================================

    const data = {
      DailyBreakageID:
        Number(DailyBreakageID),

      OrganizationID:
        Number(OrganizationID),

      Outlet:
        String(Outlet).trim(),

      EntryDate,

      Details:
        normalizedDetails,

      DeleteDetailIDs:
        normalizedDeleteDetailIDs,
    };


    // ============================================================
    // RabbitMQ
    // ============================================================

    return sendQueueResponse(
      req,
      res,
      "UPDATE_DAILY_BREAKAGE",
      data,
    );

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ Get Daily Breakage By ID
exports.getDailyBreakageById = async (
  req,
  res,
) => {
  try {

    const {
      DailyBreakageID,
    } = req.params;

    if (
      !DailyBreakageID ||
      !Number.isInteger(
        Number(DailyBreakageID),
      ) ||
      Number(DailyBreakageID) <= 0
    ) {
      throw new AppError(
        "Valid Daily Breakage ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const user =
      authenticatedUser(req);


    const response =
      await DailyBreakageService
        .getDailyBreakageById({

          DailyBreakageID:
            Number(DailyBreakageID),

          ...user,
        });


    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch Daily Breakage",
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
// ============================================================ Daily Breakage List
exports.getDailyBreakageList = async (
  req,
  res,
) => {
  try {

    const {
      OrganizationID,
      Outlet,
      FromDate,
      ToDate,
      page,
      PageSize,
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


    if (
      OrganizationID &&
      (
        !Number.isInteger(
          Number(OrganizationID),
        ) ||
        Number(OrganizationID) <= 0
      )
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    const user =
      authenticatedUser(req);


    const response =
      await DailyBreakageService
        .getDailyBreakageList({

          OrganizationID:
            OrganizationID
              ? Number(OrganizationID)
              : null,

          Outlet:
            Outlet
              ? String(Outlet).trim()
              : null,

          FromDate:
            FromDate || null,

          ToDate:
            ToDate || null,

          page,
          PageSize,

          ...user,
        });


    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch Daily Breakage list",
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
// ============================================================ Delete Daily Breakage
exports.deleteDailyBreakage = async (
  req,
  res,
) => {
  try {

    const {
      DailyBreakageID,
    } = req.body || {};


    if (
      !DailyBreakageID ||
      !Number.isInteger(
        Number(DailyBreakageID),
      ) ||
      Number(DailyBreakageID) <= 0
    ) {
      throw new AppError(
        "Valid Daily Breakage ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


    return sendQueueResponse(
      req,
      res,
      "DELETE_DAILY_BREAKAGE",
      {
        DailyBreakageID:
          Number(DailyBreakageID),
      },
    );


  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================ Outlet Names
exports.getDailyBreakageOutlets = async (req, res) => {
  try {
    const { OrganizationID } = req.query;

    if (
      !OrganizationID ||
      !Number.isInteger(Number(OrganizationID)) ||
      Number(OrganizationID) <= 0
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await DailyBreakageService.getDailyBreakageOutlets({
        OrganizationID: Number(OrganizationID),
      });

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch Daily Breakage outlets",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// ============================================================Person Responsible Names
exports.getDailyBreakagePersonResponsible = async (req, res) => {
  try {
    const { OrganizationID } = req.query;

    if (
      !OrganizationID ||
      !Number.isInteger(Number(OrganizationID)) ||
      Number(OrganizationID) <= 0
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }

    const response =
      await DailyBreakageService
        .getDailyBreakagePersonResponsible({
          OrganizationID:
            Number(OrganizationID),
        });

    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch Daily Breakage person responsible",
        response.statusCode ||
          STATUS_CODES.BAD_REQUEST,
        response.errors,
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    return handleError(
      error,
      res,
    );
  }
};
// =======================================================================Reports
// ============================================================Summary Report
exports.getDailyBreakageSummaryReport = async (req, res) => {
  try {
    const {
      OrganizationID,
      FromDate,
      ToDate,
    } = req.query;


    // ============================================================
    // Organization Validation
    // ============================================================

    if (
      OrganizationID &&
      (
        !Number.isInteger(
          Number(OrganizationID),
        ) ||
        Number(OrganizationID) <= 0
      )
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


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


    // ============================================================
    // Service
    // ============================================================

    const response =
      await DailyBreakageService
        .getDailyBreakageSummaryReport({
          OrganizationID:
            OrganizationID
              ? Number(OrganizationID)
              : null,

          FromDate:
            FromDate || null,

          ToDate:
            ToDate || null,
        });


    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch Daily Breakage summary report",
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
// ============================================================Outlet Wise Report
exports.getDailyBreakageOutletWiseReport = async (req, res) => {
  try {
    const {
      OrganizationID,
      Outlet,
      FromDate,
      ToDate,
      page,
      PageSize,
    } = req.query;


    // ============================================================
    // Organization Validation
    // ============================================================

    if (
      OrganizationID &&
      (
        !Number.isInteger(
          Number(OrganizationID),
        ) ||
        Number(OrganizationID) <= 0
      )
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


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


    // ============================================================
    // Service
    // ============================================================

    const response =
      await DailyBreakageService
        .getDailyBreakageOutletWiseReport({
          OrganizationID:
            OrganizationID
              ? Number(OrganizationID)
              : null,

          Outlet:
            Outlet
              ? String(Outlet).trim()
              : null,

          FromDate:
            FromDate || null,

          ToDate:
            ToDate || null,

          page,
          PageSize,
        });


    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch outlet wise Daily Breakage report",
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
// ============================================================Person Responsible Wise Report
exports.getDailyBreakagePersonResponsibleReport = async (
  req,
  res,
) => {
  try {
    const {
      OrganizationID,
      PersonResponsible,
      FromDate,
      ToDate,
      page,
      PageSize,
    } = req.query;


    // ============================================================
    // Organization Validation
    // ============================================================

    if (
      OrganizationID &&
      (
        !Number.isInteger(
          Number(OrganizationID),
        ) ||
        Number(OrganizationID) <= 0
      )
    ) {
      throw new AppError(
        "Valid Organization ID is required",
        STATUS_CODES.BAD_REQUEST,
      );
    }


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


    // ============================================================
    // Service
    // ============================================================

    const response =
      await DailyBreakageService
        .getDailyBreakagePersonResponsibleReport({
          OrganizationID:
            OrganizationID
              ? Number(OrganizationID)
              : null,

          PersonResponsible:
            PersonResponsible
              ? String(
                  PersonResponsible,
                ).trim()
              : null,

          FromDate:
            FromDate || null,

          ToDate:
            ToDate || null,

          page,
          PageSize,
        });


    if (!response.success) {
      throw new AppError(
        response.message ||
          "Unable to fetch person responsible Daily Breakage report",
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