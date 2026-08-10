const { pool } = require("../db");
const moment = require("moment");
const {formatDate} = require("../utils/dateFormatter");

// ========================================= Create Product
const createProduct = async (data) => {
  try {

    const {
      ProductName,
      ProductLabel,
      ProductCategoryID,
      DevelopmentLanguage,
      IsActive,
      IsDeleted,
      CreatedBy,
    } = data;

    const query = `
      INSERT INTO Product_Master
      (
        ProductName,
        ProductLabel,
        ProductCategoryID,
        DevelopmentLanguage,
        IsActive,
        IsDeleted,
        CreatedBy
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7
      )
      RETURNING *;
    `;

    const values = [
      ProductName,
      ProductLabel,
      ProductCategoryID,
      DevelopmentLanguage,
      IsActive,
      IsDeleted,
      CreatedBy,
    ];

    await pool.query(query, values);

    return {
      success: true,
      message: "Product Created Successfully",
    };

  } catch (error) {

    console.log("Create Product Error :", error.message);

    if (error.code === "23505") {
      return {
        success: false,
        message: "Product Name or Product Label already exists",
      };
    }

    if (error.code === "23503") {
      return {
        success: false,
        message: "Invalid Product Category",
      };
    }

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Get All Products
const getAllProducts = async () => {
  try {

    const query = `
      SELECT
        pm.ProductID,
        pm.ProductName,
        pm.ProductLabel,

        pm.ProductCategoryID,
        pcm.CategoryName,

        pm.DevelopmentLanguage,

        pm.IsActive,

        pm.CreatedBy,
        pm.CreatedDate,

        pm.ModifiedBy,
        pm.ModifiedDate,

        pm.DeletedBy,
        pm.DeletedDate

      FROM Product_Master pm

      INNER JOIN Product_Category_Master pcm
      ON pm.ProductCategoryID = pcm.ProductCategoryID

      WHERE pm.IsDeleted = FALSE

      ORDER BY pm.ProductName ASC;
    `;

    const result = await pool.query(query);

    const products = result.rows.map((row) => ({
      ProductID: row.productid,
      ProductName: row.productname,
      ProductLabel: row.productlabel,

      ProductCategoryID: row.productcategoryid,
      CategoryName: row.categoryname,

      DevelopmentLanguage: row.developmentlanguage,

      IsActive: row.isactive,

      CreatedBy: row.createdby,
      CreatedDate: row.createddate
        ? formatDate(row.createddate)
        : null,

      ModifiedBy: row.modifiedby,
      ModifiedDate: row.modifieddate
        ? formatDate(row.modifieddate)
        : null,

      DeletedBy: row.deletedby,
      DeletedDate: row.deleteddate
        ? formatDate(row.deleteddate)
        : null,
    }));

    return {
      success: true,
      message: "Products fetched successfully",
      Count: products.length,
      data: products,
    };

  } catch (error) {

    console.log("Get Products Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Product Dropdown
const getProductDropdown = async () => {
  try {

    const query = `
      SELECT
        ProductID,
        ProductName,
        ProductLabel,
        DevelopmentLanguage
      FROM Product_Master
      WHERE
        IsDeleted = FALSE
        AND IsActive = TRUE
      ORDER BY ProductName ASC;
    `;

    const result = await pool.query(query);

    return {
      success: true,
      message: "Product Dropdown fetched successfully",
      Count: result.rows.length,
      data: result.rows,
    };

  } catch (error) {

    console.log("Product Dropdown Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Update Product
const updateProduct = async (data) => {
  try {

    const {
      ProductID,
      ProductName,
      ProductLabel,
      ProductCategoryID,
      DevelopmentLanguage,
      ModifiedBy,
    } = data;

    const query = `
      UPDATE Product_Master
      SET
        ProductName = $1,
        ProductLabel = $2,
        ProductCategoryID = $3,
        DevelopmentLanguage = $4,
        ModifiedBy = $5,
        ModifiedDate = CURRENT_TIMESTAMP
      WHERE ProductID = $6
        AND IsDeleted = FALSE
      RETURNING *;
    `;

    const values = [
      ProductName,
      ProductLabel,
      ProductCategoryID,
      DevelopmentLanguage,
      ModifiedBy,
      ProductID,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: "Product Not Found",
      };
    }

    return {
      success: true,
      message: "Product Updated Successfully",
    };

  } catch (error) {

    console.log("Update Product Error :", error.message);

    if (error.code === "23505") {
      return {
        success: false,
        message: "Product Name or Product Label already exists",
      };
    }

    if (error.code === "23503") {
      return {
        success: false,
        message: "Invalid Product Category",
      };
    }

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Delete Product
const deleteProduct = async (data) => {
  try {

    const {
      ProductID,
      DeletedBy,
    } = data;

    const query = `
      UPDATE Product_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE ProductID = $2
        AND IsDeleted = FALSE
      RETURNING *;
    `;

    const values = [
      DeletedBy,
      ProductID,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: "Product Not Found",
      };
    }

    return {
      success: true,
      message: "Product Deleted Successfully",
    };

  } catch (error) {

    console.log("Delete Product Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};

// ========================================= Get Products By Category

const getProductsByCategory = async (ProductCategoryID) => {

  try {

    // ========================================================
    // Validate Category ID
    // ========================================================

    if (
      ProductCategoryID === undefined ||
      ProductCategoryID === null ||
      ProductCategoryID === ""
    ) {
      return {
        success: false,
        message: "Product Category ID is required",
      };
    }

    // ========================================================
    // Validate Number
    // ========================================================

    if (
      !Number.isInteger(ProductCategoryID) ||
      ProductCategoryID <= 0
    ) {
      return {
        success: false,
        message:
          "Product Category ID must be a valid positive number",
      };
    }

    // ========================================================
    // Get Products
    // ========================================================

    const query = `
      SELECT

        ProductID,
        ProductName,
        ProductLabel,
        ProductCategoryID,
        DevelopmentLanguage

      FROM Product_Master

      WHERE ProductCategoryID = $1
        AND IsDeleted = FALSE
        AND IsActive = TRUE

      ORDER BY ProductID ASC;
    `;

    const result = await pool.query(
      query,
      [ProductCategoryID]
    );

    // ========================================================
    // Products Not Found
    // ========================================================

    if (result.rows.length === 0) {

      return {
        success: false,
        message: "Products Not Found",
        Count: 0,
        data: [],
      };

    }

    // ========================================================
    // Success
    // ========================================================

    const products = result.rows.map((product) => ({

      ProductID:
        product.productid,

      ProductName:
        product.productname,

      ProductLabel:
        product.productlabel,

      ProductCategoryID:
        product.productcategoryid,

      DevelopmentLanguage:
        product.developmentlanguage,

    }));

    return {

      success: true,

      message:
        "Products fetched successfully",

      Count:
        products.length,

      data:
        products,

    };

  } catch (error) {

    console.log(
      "Get Products By Category Error:",
      error.message
    );

    return {

      success: false,

      message:
        "Unable to fetch products: " + error.message,

    };

  }
};

// ========================================= Module Exports
module.exports = {
  createProduct,
  getAllProducts,
  getProductDropdown,
  updateProduct,
  deleteProduct,
  getProductsByCategory,
};