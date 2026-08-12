const { pool } = require("../../db");
const moment = require("moment");
const {formatDate} = require("../../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

// ========================================= Create Product Category
const createProductCategory = async (data) => {
  try {

    const {
      CategoryName,
      ShortName,
      DevelopmentLanguage,
      IsActive,
      IsDeleted,
      CreatedBy,
    } = data;

    const query = `
      INSERT INTO product_category_master
      (
        CategoryName,
        ShortName,
        DevelopmentLanguage,
        IsActive,
        IsDeleted,
        CreatedBy
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6
      )
      RETURNING *;
    `;

    const values = [
      CategoryName,
      ShortName,
      DevelopmentLanguage,
      IsActive,
      IsDeleted,
      CreatedBy,
    ];

    const result = await pool.query(query, values);

    return {
      success: true,
      message: "Product Category Created Successfully",
    };

  } catch (error) {

    console.log("Create Product Category Error :", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      errorCode: "PRODUCT_CATEGORY_CREATION_FAILED",
      message: "Unable to create the Product Category right now. Please verify the details and try again.",
    };

  }
};
// ========================================= Get All Product Categories
const getAllProductCategories = async (
  page = 1,
  pageSize = 10,
  CategoryName = ""
) => {
  try {

    const offset = (page - 1) * pageSize;
    const categoryNameFilter = `%${CategoryName}%`;

    const countQuery = `
      SELECT COUNT(*)::INTEGER AS TotalCount
      FROM product_category_master
      WHERE IsDeleted = FALSE
        AND CategoryName ILIKE $1;
    `;

    const query = `
      SELECT
        ProductCategoryID,
        CategoryName,
        ShortName,
        DevelopmentLanguage,
        CreatedDate

      FROM product_category_master
      WHERE IsDeleted = FALSE
        AND CategoryName ILIKE $1
      ORDER BY CategoryName ASC
      LIMIT $2 OFFSET $3;
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, [categoryNameFilter, pageSize, offset]),
      pool.query(countQuery, [categoryNameFilter]),
    ]);

    const totalCount = countResult.rows[0].totalcount;

    const categories = result.rows.map((row) => ({
      ProductCategoryID: row.productcategoryid,
      CategoryName: row.categoryname,
      ShortName: row.shortname,
      DevelopmentLanguage: row.developmentlanguage,

      CreatedDate: row.createddate
        ? formatDate(row.createddate)
        : null,
    }));

    return {
      success: true,
      message: "Product Categories fetched successfully",
      TotalCount: totalCount,
      PageCount: categories.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: Math.ceil(totalCount / pageSize),
      data: categories,
    };

  } catch (error) {

    console.log("Get Product Categories Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Product Category Dropdown
const getProductCategoryDropdown = async () => {
  try {

    const query = `
      SELECT
        ProductCategoryID,
        CategoryName,
        ShortName,
        DevelopmentLanguage
      FROM product_category_master
      WHERE IsDeleted = FALSE
        AND IsActive = TRUE
      ORDER BY CategoryName ASC;
    `;

    const result = await pool.query(query);

    return {
      success: true,
      message: "Product Category dropdown fetched successfully",
      Count:result.rows.length,
      data: result.rows.map((row) => ({
        ProductCategoryID: row.productcategoryid,
        CategoryName: row.categoryname,
        ShortName: row.shortname,
        DevelopmentLanguage: row.developmentlanguage,
      })),
    };

  } catch (error) {

    console.log("Product Category Dropdown Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Update Product Category
const updateProductCategory = async (data) => {
  try {

    const {
      ProductCategoryID,
      CategoryName,
      ShortName,
      DevelopmentLanguage,
      ModifiedBy,
    } = data;

    const query = `
      UPDATE product_category_master
      SET
        CategoryName = $1,
        ShortName = $2,
        DevelopmentLanguage = $3,
        ModifiedBy = $4,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE ProductCategoryID = $5
        AND IsDeleted = FALSE
      RETURNING *;
    `;

    const values = [
      CategoryName,
      ShortName,
      DevelopmentLanguage,
      ModifiedBy,
      ProductCategoryID,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: "Product Category Not Found",
      };
    }

    return {
      success: true,
      message: "Product Category Updated Successfully",
    };

  } catch (error) {

    console.log("Update Product Category Error :", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Delete Product Category
const deleteProductCategory = async (data) => {
  try {

    const {
      ProductCategoryID,
      DeletedBy,
    } = data;

    const query = `
      UPDATE product_category_master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE ProductCategoryID = $2
        AND IsDeleted = FALSE
      RETURNING *;
    `;

    const values = [
      DeletedBy,
      ProductCategoryID,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: "Product Category Not Found",
      };
    }

    return {
      success: true,
      message: "Product Category Deleted Successfully",
    };

  } catch (error) {

    console.log(
      "Delete Product Category Error :",
      error.message
    );

    return {
      success: false,
      message: error.message,
    };

  }
};

module.exports = {
  createProductCategory,
  getAllProductCategories,
  getProductCategoryDropdown,
  updateProductCategory,
  deleteProductCategory,
};
