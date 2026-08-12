const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Get Funcation from Serive
const ProductCategoryService = require("../../services/ITAdminService/ProductCategoryService");

// ========================================= Create Product Category
exports.createProductCategory = async (req, res) => {
  try {

    const {
      CategoryName,
      ShortName,
      DevelopmentLanguage,
    } = req.body || {};

    const CreatedBy = req.user?.UserID;

    if (!CreatedBy) {
      throw new AppError(
        "Invalid authentication token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    if (!CategoryName || !String(CategoryName).trim()) {
      throw new AppError(
        "Category Name is required. Please enter the category name.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT_CATEGORY.REQUEST,
      QUEUE.PRODUCT_CATEGORY.RESPONSE,
      {
        action: "CREATE_PRODUCT_CATEGORY",
        data: {
          CategoryName: String(CategoryName).trim(),
          ShortName: typeof ShortName === "string" ? ShortName.trim() : ShortName,
          DevelopmentLanguage: typeof DevelopmentLanguage === "string"
            ? DevelopmentLanguage.trim()
            : DevelopmentLanguage,
          IsActive: true,
          IsDeleted: false,
          CreatedBy,
        },
      }
    );

    if (!response.success) {
      const statusCode = response.errorCode === "DUPLICATE_PRODUCT_CATEGORY"
        ? STATUS_CODES.CONFLICT
        : STATUS_CODES.BAD_REQUEST;

      return res.status(statusCode).json(response);
    }

    return res
      .status(STATUS_CODES.CREATED)
      .json(response);

  } catch (error) {
    if (
      error.message === "Response Timeout" ||
      error.message === "RabbitMQ Channel Not Initialized"
    ) {
      return handleError(
        new AppError(
          "Product Category service is temporarily unavailable. Please try again shortly.",
          STATUS_CODES.SERVICE_UNAVAILABLE
        ),
        res
      );
    }

    handleError(error, res);
  }
};

exports.getAllProductCategories = async (req, res) => {
  try {

    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);
    const CategoryName = String(req.query.CategoryName || "").trim();

    if (!Number.isInteger(page) || page <= 0) {
      throw new AppError(
        "Page must be a valid positive number",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw new AppError(
        "Page size must be a valid positive number",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response =
      await ProductCategoryService.getAllProductCategories(
        page,
        pageSize,
        CategoryName
      );

    if (!response.success) {
      throw new AppError(
        response.message || "Unable to fetch Product Categories",
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    handleError(error, res);
  }
};

exports.getProductCategoryDropdown = async (req, res) => {
  try {

    const response =
      await ProductCategoryService.getProductCategoryDropdown();

    if (!response.success) {
      throw new AppError(
        response.message,
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    handleError(error, res);
  }
};

exports.updateProductCategory = async (req, res) => {
  try {

    const ModifiedBy = req.user?.UserID;
    const { ProductCategoryID, ...categoryData } = req.body || {};

    if (!ModifiedBy) {
      throw new AppError(
        "Invalid authentication token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    if (!ProductCategoryID) {
      throw new AppError(
        "Product Category ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT_CATEGORY.REQUEST,
      QUEUE.PRODUCT_CATEGORY.RESPONSE,
      {
        action: "UPDATE_PRODUCT_CATEGORY",
        data: {
          ProductCategoryID,
          ...categoryData,
          ModifiedBy,
        },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message,
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    handleError(error, res);
  }
};

exports.deleteProductCategory = async (req, res) => {
  try {

    const DeletedBy = req.user?.UserID;
    const { ProductCategoryID } = req.body || {};

    if (!DeletedBy) {
      throw new AppError(
        "Invalid authentication token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    if (!ProductCategoryID) {
      throw new AppError(
        "Product Category ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT_CATEGORY.REQUEST,
      QUEUE.PRODUCT_CATEGORY.RESPONSE,
      {
        action: "DELETE_PRODUCT_CATEGORY",
        data: {
          ProductCategoryID,
          DeletedBy,
        },
      }
    );

    if (!response.success) {
      throw new AppError(
        response.message,
        STATUS_CODES.BAD_REQUEST
      );
    }

    return res
      .status(STATUS_CODES.SUCCESS)
      .json(response);

  } catch (error) {
    handleError(error, res);
  }
};
