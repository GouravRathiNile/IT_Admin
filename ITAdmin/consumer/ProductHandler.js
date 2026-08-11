const ProductService = require("../services/ProductService");
const { retryableDatabaseResponse } = require("../utils/retryableDatabaseError");

const ProductHandler = async (message) => {
  try {

    switch (message.action) {

      // ===================================== Create Product
      case "CREATE_PRODUCT":
        return await ProductService.createProduct(
          message.data
        );

      // ===================================== Update Product
      case "UPDATE_PRODUCT":
        return await ProductService.updateProduct(
          message.data
        );

      // ===================================== Delete Product
      case "DELETE_PRODUCT":
        return await ProductService.deleteProduct(
          message.data
        );

      default:
        return {
          success: false,
          message: "Invalid Action",
        };
    }

  } catch (error) {

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      message: error.message,
    };

  }
};

module.exports = ProductHandler;
