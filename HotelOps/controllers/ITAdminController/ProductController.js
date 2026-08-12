const producer = require("../../producer/producer");
const QUEUE = require("../../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../../utils/statusCodes");
const AppError = require("../../utils/AppError");
const handleError = require("../../utils/errorHandler");
//==================================================Get Funcation from Serive
const ProductService = require("../../services/ITAdminService/ProductService");

// ========================================= Create Product
exports.createProduct = async (req, res) => {
  try {

    const {
      ProductName,
      ProductLabel,
      ProductCategoryID,
      DevelopmentLanguage,
    } = req.body || {};

    const CreatedBy = req.user?.UserID;

    if (!CreatedBy) {
      throw new AppError(
        "Invalid authentication token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    if (!ProductName || !String(ProductName).trim()) {
      throw new AppError(
        "Product Name is required. Please enter the product name.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!ProductLabel || !String(ProductLabel).trim()) {
      throw new AppError(
        "Product Label is required. Please enter the product label.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (
      !Number.isInteger(Number(ProductCategoryID)) ||
      Number(ProductCategoryID) <= 0
    ) {
      throw new AppError(
        "Please select a valid Product Category.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT.REQUEST,
      QUEUE.PRODUCT.RESPONSE,
      {
        action: "CREATE_PRODUCT",
        data: {
          ProductName: String(ProductName).trim(),
          ProductLabel: String(ProductLabel).trim(),
          ProductCategoryID: Number(ProductCategoryID),
          DevelopmentLanguage,
          CreatedBy,
          IsActive: true,
          IsDeleted: false,
        },
      }
    );

    if (!response.success) {
      const statusCode = response.errorCode === "DUPLICATE_PRODUCT"
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
          "Product service is temporarily unavailable. Please try again shortly.",
          STATUS_CODES.SERVICE_UNAVAILABLE
        ),
        res
      );
    }

    handleError(error, res);
  }
};
// ========================================= Get All Products
exports.getAllProducts = async (req, res) => {
  try {

    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);
    const ProductName = String(req.query.ProductName || "").trim();
    const categoryFilter = req.query.ProductCategoryID;
    const ProductCategoryID = categoryFilter === undefined || categoryFilter === ""
      ? null
      : Number(categoryFilter);

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

    if (
      ProductCategoryID !== null &&
      (!Number.isInteger(ProductCategoryID) || ProductCategoryID <= 0)
    ) {
      throw new AppError(
        "Product Category ID must be a valid positive number",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response =
      await ProductService.getAllProducts(
        page,
        pageSize,
        ProductName,
        ProductCategoryID
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
// ========================================= Product Dropdown
exports.getProductDropdown = async (req, res) => {
  try {

    const response =
      await ProductService.getProductDropdown();

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
// ========================================= Update Product
exports.updateProduct = async (req, res) => {
  try {

    const ModifiedBy = req.user?.UserID;
    const { ProductID, ProductCategoryID } = req.body || {};

    if (!ModifiedBy) {
      throw new AppError(
        "Invalid authentication token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    if (
      ProductID === undefined ||
      ProductID === null ||
      String(ProductID).trim() === "" ||
      !/^\d+$/.test(String(ProductID).trim()) ||
      Number(ProductID) <= 0
    ) {
      throw new AppError(
        "Please provide a valid Product ID.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (
      ProductCategoryID === undefined ||
      ProductCategoryID === null ||
      String(ProductCategoryID).trim() === "" ||
      !/^\d+$/.test(String(ProductCategoryID).trim()) ||
      Number(ProductCategoryID) <= 0
    ) {
      throw new AppError(
        "Please select a valid Product Category.",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT.REQUEST,
      QUEUE.PRODUCT.RESPONSE,
      {
        action: "UPDATE_PRODUCT",
        data: {
          ...(req.body || {}),
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
// ========================================= Delete Product
exports.deleteProduct = async (req, res) => {
  try {

    const DeletedBy = req.user?.UserID;

    if (!DeletedBy) {
      throw new AppError(
        "Invalid authentication token",
        STATUS_CODES.UNAUTHORIZED
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT.REQUEST,
      QUEUE.PRODUCT.RESPONSE,
      {
        action: "DELETE_PRODUCT",
        data: {
          ProductID: req.body.ProductID,
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
// ===================================== Get Products By Category

exports.getProductsByCategory = async (req, res) => {
  try {

    // ========================================================
    // Service Call
    // ========================================================

    const response =
      await ProductService.getProductsByCategory();

    // ========================================================
    // Service Error
    // ========================================================

    if (!response.success) {

      // ------------------------------------------------------
      // No Product Found
      // ------------------------------------------------------

      if (response.message === "Products Not Found") {

        return res
          .status(STATUS_CODES.SUCCESS)
          .json({
            success: false,
            message: "Products Not Found",
            Count: 0,
            data: [],
          });
      }

      // ------------------------------------------------------
      // Other Service Error
      // ------------------------------------------------------

      throw new AppError(
        response.message || "Unable to fetch products",
        response.statusCode || STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Success
    // ========================================================

    return res
      .status(STATUS_CODES.SUCCESS)
      .json({
        success: true,
        message: "Products fetched successfully",
        Count: response.Count,
        data: response.data,
      });

  } catch (error) {

    console.log(
      "Get Products By Category Controller Error:",
      error.message
    );

    handleError(error, res);
  }
};
