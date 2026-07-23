//==================================================RabbitMq
const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
//==================================================Azur
const uploadToAzure = require("../AzurConfigration/BrandMaster/AzureUpload");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");
//==================================================Get Funcation from Serive
const BrandMaster = require("../services/BrandMaster")


// ====================================================Create Brand
exports.createBrand = async (req, res) => {
  try {
    const { BrandCode, BrandName, ShortName, Website, CreatedBy } = req.body;
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


    const response = await BrandMaster.getAllBrands();

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
    const { BrandCode, BrandName, ShortName, Website, ModifiedBy } = req.body;

    if (!BrandName) {
      throw new AppError("Brand Name is required", STATUS_CODES.BAD_REQUEST);
    }

    const data = {
      BrandID: req.params.id,
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
    const response = await producer.sendMessage(
      QUEUE.BRAND.REQUEST,
      QUEUE.BRAND.RESPONSE,
      {
        action: "DELETE_BRAND",
        data: {
          BrandID: req.params.id,
          DeletedBy: req.body.DeletedBy,
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