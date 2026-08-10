const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");
//==================================================Get Funcation from Serive
const ProductService = require("../services/ProductService");

// ========================================= Create Product
exports.createProduct = async (req, res) => {
  try {

    const {
      ProductName,
      ProductLabel,
      ProductCategoryID,
      DevelopmentLanguage,
      CreatedBy,
    } = req.body;

    if (!ProductName) {
      throw new AppError(
        "Product Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!ProductLabel) {
      throw new AppError(
        "Product Label is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    if (!ProductCategoryID) {
      throw new AppError(
        "Product Category is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT.REQUEST,
      QUEUE.PRODUCT.RESPONSE,
      {
        action: "CREATE_PRODUCT",
        data: {
          ProductName,
          ProductLabel,
          ProductCategoryID,
          DevelopmentLanguage,
          CreatedBy,
          IsActive: true,
          IsDeleted: false,
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
      .status(STATUS_CODES.CREATED)
      .json(response);

  } catch (error) {
    handleError(error, res);
  }
};
// ========================================= Get All Products
exports.getAllProducts = async (req, res) => {
  try {

    const response =
      await ProductService.getAllProducts();

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

    const response = await producer.sendMessage(
      QUEUE.PRODUCT.REQUEST,
      QUEUE.PRODUCT.RESPONSE,
      {
        action: "UPDATE_PRODUCT",
        data: {
          ProductID: req.params.id,
          ...req.body,
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

    const response = await producer.sendMessage(
      QUEUE.PRODUCT.REQUEST,
      QUEUE.PRODUCT.RESPONSE,
      {
        action: "DELETE_PRODUCT",
        data: {
          ProductID: req.params.id,
          DeletedBy: req.body.DeletedBy,
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
    // Get Category ID
    // ========================================================

    let { id } = req.params;

    console.log("Category Params:", req.params);

    // ========================================================
    // Missing Category ID
    // ========================================================

    if (
      id === undefined ||
      id === null ||
      id === "" ||
      (Array.isArray(id) && id.length === 0)
    ) {
      throw new AppError(
        "Product Category ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Express 5 wildcard gives array
    // Example:
    // /getbycategory/2
    // id = ["2"]
    // ========================================================

    if (Array.isArray(id)) {

      // More than one path value
      if (id.length !== 1) {
        throw new AppError(
          "Invalid Product Category ID",
          STATUS_CODES.BAD_REQUEST
        );
      }

      id = id[0];
    }

    // ========================================================
    // Trim
    // ========================================================

    id = String(id).trim();

    // ========================================================
    // Empty ID
    // ========================================================

    if (!id) {
      throw new AppError(
        "Product Category ID is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Numeric Validation
    // ========================================================

    if (!/^\d+$/.test(id)) {
      throw new AppError(
        "Product Category ID must be a valid number",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Convert To Number
    // ========================================================

    const ProductCategoryID = Number(id);

    // ========================================================
    // Positive Number Validation
    // ========================================================

    if (ProductCategoryID <= 0) {
      throw new AppError(
        "Product Category ID must be greater than 0",
        STATUS_CODES.BAD_REQUEST
      );
    }

    // ========================================================
    // Service Call
    // ========================================================

    const response =
      await ProductService.getProductsByCategory(
        ProductCategoryID
      );

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