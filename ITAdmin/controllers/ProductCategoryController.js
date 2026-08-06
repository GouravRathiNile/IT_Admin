const producer = require("../producer/producer");
const QUEUE = require("../config/queue");
//==================================================Error Handling
const STATUS_CODES = require("../utils/statusCodes");
const AppError = require("../utils/AppError");
const handleError = require("../utils/errorHandler");
//==================================================Get Funcation from Serive
const ProductCategoryService = require("../services/ProductCategoryService");

// ========================================= Create Product Category
exports.createProductCategory = async (req, res) => {
  try {

    const {
      CategoryName,
      ShortName,
      DevelopmentLanguage,
      CreatedBy,
    } = req.body;

    if (!CategoryName) {
      throw new AppError(
        "Category Name is required",
        STATUS_CODES.BAD_REQUEST
      );
    }

    const response = await producer.sendMessage(
      QUEUE.PRODUCT_CATEGORY.REQUEST,
      QUEUE.PRODUCT_CATEGORY.RESPONSE,
      {
        action: "CREATE_PRODUCT_CATEGORY",
        data: {
          CategoryName,
          ShortName,
          DevelopmentLanguage,
          IsActive: true,
          IsDeleted: false,
          CreatedBy,
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

exports.getAllProductCategories = async (req, res) => {
  try {

    const response =
      await ProductCategoryService.getAllProductCategories();

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
    console.log("req.body", req.body);
    const response = await producer.sendMessage(
      QUEUE.PRODUCT_CATEGORY.REQUEST,
      QUEUE.PRODUCT_CATEGORY.RESPONSE,
      {
        action: "UPDATE_PRODUCT_CATEGORY",
        data: {
          ProductCategoryID: req.params.id,
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

exports.deleteProductCategory = async (req, res) => {
  try {

    const response = await producer.sendMessage(
      QUEUE.PRODUCT_CATEGORY.REQUEST,
      QUEUE.PRODUCT_CATEGORY.RESPONSE,
      {
        action: "DELETE_PRODUCT_CATEGORY",
        data: {
          ProductCategoryID: req.params.id,
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