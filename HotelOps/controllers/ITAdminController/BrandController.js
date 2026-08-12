//==================================================RabbitMq
const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Azur
const uploadToAzure = require("../../AzurConfigration/ITAdmin/BrandMaster/AzureUpload");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Get Funcation from Serive
const BrandMaster = require("../../services/ITAdminService/BrandMaster")


// ====================================================Create Brand
exports.createBrand = async (req, res) => {
  try {
    const { BrandCode, BrandName, ShortName, Website } = req.body;
    const CreatedBy = req.user.UserID;
    if (typeof BrandCode !== "string" || !BrandCode.trim()) {
      throw new AppError("Brand Code is required", STATUS_CODES.BAD_REQUEST);
    }
    if (!BrandName) {
      throw new AppError("Brand Name is required", STATUS_CODES.BAD_REQUEST);
    }
    let BrandLogo = null;

    if (req.file) {
      BrandLogo = await uploadToAzure(req.file);
    }

    const response = await producer.sendMessage(
      QUEUE.BRAND.REQUEST,
      QUEUE.BRAND.RESPONSE,

      {
        action: "CREATE_BRAND",
        data: {
          BrandCode,
          BrandName,
          ShortName,
          BrandLogo,
          Website,
          IsActive: 1,
          IsDeleted: 0,
          CreatedBy,
        },
      },
    );
    // Agar RabbitMQ service se failure aaya

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to create brand",

        response.statusCode || STATUS_CODES.BAD_REQUEST,
      );
    }

    return res.status(STATUS_CODES.CREATED).json(response);
  } catch (error) {
    handleError(error, res);
  }
};
// ====================================================Get All Brands
exports.getAllBrands = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.PageSize || 10);
    const { date, BrandName } = req.query;

    if (!Number.isInteger(page) || page < 1) {
      throw new AppError(
        "Page must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new AppError(
        "Page Size must be a positive integer",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const isValidDate = (date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

      const parsedDate = new Date(`${date}T00:00:00.000Z`);
      return !Number.isNaN(parsedDate.getTime())
        && parsedDate.toISOString().slice(0, 10) === date;
    };

    if (date && !isValidDate(date)) {
      throw new AppError(
        "Date must be in YYYY-MM-DD format",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // Empty search input means no BrandName filter.
    const normalizedBrandName =
      typeof BrandName === "string" ? BrandName.trim() : undefined;

    const currentPage = date || normalizedBrandName ? 1 : page;
    const response = await BrandMaster.getAllBrands(
      currentPage,
      date,
      limit,
      normalizedBrandName || undefined
    );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch brands",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    handleError(error, res);
  }
};
// ====================================================Update Brand
exports.updateBrand = async (req, res) => {
  try {
    const { BrandID, BrandCode, BrandName, ShortName, Website } = req.body;
    const ModifiedBy = req.user.UserID;

    if (!BrandID) {
      throw new AppError("Brand ID is required", STATUS_CODES.BAD_REQUEST);
    }

    if (typeof BrandCode !== "string" || !BrandCode.trim()) {
      throw new AppError("Brand Code is required", STATUS_CODES.BAD_REQUEST);
    }

    if (!BrandName) {
      throw new AppError("Brand Name is required", STATUS_CODES.BAD_REQUEST);
    }

    const data = {
      BrandID,
      BrandCode,
      BrandName,
      ShortName,
      Website,
      IsActive: 1,
      ModifiedBy,
    };

    // Sirf image upload hone par hi BrandLogo add karo
    if (req.file) {
      data.BrandLogo = await uploadToAzure(req.file);
    }

    const response = await producer.sendMessage(
      QUEUE.BRAND.REQUEST,
      QUEUE.BRAND.RESPONSE,
      {
        action: "UPDATE_BRAND",
        data,
      }
    );

    if (!response.success) {
      throw new AppError(response.message, STATUS_CODES.BAD_REQUEST);
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    handleError(error, res);
  }
};
// ====================================================Delete Brand (Soft Delete)
exports.deleteBrand = async (req, res) => {
  try {
    const { BrandID } = req.body;

    if (!BrandID) {
      throw new AppError("Brand ID is required", STATUS_CODES.BAD_REQUEST);
    }

    const response = await producer.sendMessage(
      QUEUE.BRAND.REQUEST,
      QUEUE.BRAND.RESPONSE,
      {
        action: "DELETE_BRAND",
        data: {
          BrandID,
          DeletedBy: req.user.UserID,
        },
      },
    );

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// ====================================================Get Brand Dropdown
exports.getBrandsDropdown = async (req, res) => {
  try {


    const response = await BrandMaster.getBrandDropdown();

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch brands",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res.status(STATUS_CODES.SUCCESS).json(response);

  } catch (error) {
    handleError(error, res);
  }
};
