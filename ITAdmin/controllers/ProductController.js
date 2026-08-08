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