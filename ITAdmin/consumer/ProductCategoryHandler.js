const ProductCategoryService = require("../services/ProductCategoryService");

const ProductCategoryHandler = async (message) => {
  try {

    switch (message.action) {

      case "CREATE_PRODUCT_CATEGORY":
        return await ProductCategoryService.createProductCategory(
          message.data
        );

      case "UPDATE_PRODUCT_CATEGORY":
        return await ProductCategoryService.updateProductCategory(
          message.data
        );

      case "DELETE_PRODUCT_CATEGORY":
        return await ProductCategoryService.deleteProductCategory(
          message.data
        );

      default:
        return {
          success: false,
          message: "Invalid Action",
        };
    }

  } catch (error) {

    console.log(error);

    return {
      success: false,
      message: error.message,
    };

  }
};

module.exports = ProductCategoryHandler;