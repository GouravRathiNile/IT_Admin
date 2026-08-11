const { pool } = require("../db");
const moment = require("moment");
const {formatDate} = require("../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../utils/retryableDatabaseError");

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

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      const duplicateField = `${error.constraint || ""} ${error.detail || ""}`.toLowerCase();

      if (duplicateField.includes("productname")) {
        return {
          success: false,
          errorCode: "DUPLICATE_PRODUCT",
          field: "ProductName",
          message: "This Product Name already exists. Please use a different Product Name.",
        };
      }

      if (duplicateField.includes("productlabel")) {
        return {
          success: false,
          errorCode: "DUPLICATE_PRODUCT",
          field: "ProductLabel",
          message: "This Product Label already exists. Please use a different Product Label.",
        };
      }

      return {
        success: false,
        errorCode: "DUPLICATE_PRODUCT",
        message: "A product with these details already exists. Please use unique product details.",
      };
    }

    if (error.code === "23503") {
      return {
        success: false,
        errorCode: "INVALID_PRODUCT_CATEGORY",
        field: "ProductCategoryID",
        message: "The selected Product Category does not exist. Please select a valid category.",
      };
    }

    if (error.code === "23502") {
      const missingField = error.column
        ? error.column.replace(/_/g, " ")
        : "required product information";

      return {
        success: false,
        errorCode: "MISSING_REQUIRED_FIELD",
        field: error.column || null,
        message: `Please provide ${missingField}.`,
      };
    }

    if (error.code === "22P02") {
      return {
        success: false,
        errorCode: "INVALID_FIELD_FORMAT",
        message: "One or more values have an invalid format. Please check the product details.",
      };
    }

    if (error.code === "22001") {
      return {
        success: false,
        errorCode: "VALUE_TOO_LONG",
        field: error.column || null,
        message: "One or more product details are too long. Please shorten the entered values and try again.",
      };
    }

    if (error.code === "23514") {
      return {
        success: false,
        errorCode: "INVALID_FIELD_VALUE",
        message: "One or more product details are not allowed. Please check the entered values.",
      };
    }

    return {
      success: false,
      errorCode: "PRODUCT_CREATION_FAILED",
      message: "Unable to create the product right now. Please verify the details and try again.",
    };

  }
};
// ========================================= Get All Products
const getAllProducts = async (
  page = 1,
  pageSize = 10,
  ProductName = "",
  ProductCategoryID = null
) => {
  try {

    const offset = (page - 1) * pageSize;
    const productNameFilter = `%${ProductName}%`;

    const countQuery = `
      SELECT COUNT(*)::INTEGER AS TotalCount
      FROM Product_Master pm
      INNER JOIN Product_Category_Master pcm
        ON pm.ProductCategoryID = pcm.ProductCategoryID
      WHERE pm.IsDeleted = FALSE
        AND pm.ProductName ILIKE $1
        AND ($2::INTEGER IS NULL OR pm.ProductCategoryID = $2);
    `;

    const query = `
      SELECT
        pm.ProductID,
        pm.ProductName,
        pm.ProductLabel,

        pm.ProductCategoryID,
        pcm.CategoryName,

        pm.DevelopmentLanguage,
        pm.CreatedDate

      FROM Product_Master pm

      INNER JOIN Product_Category_Master pcm
      ON pm.ProductCategoryID = pcm.ProductCategoryID

      WHERE pm.IsDeleted = FALSE
        AND pm.ProductName ILIKE $1
        AND ($2::INTEGER IS NULL OR pm.ProductCategoryID = $2)

      ORDER BY pm.ProductName ASC
      LIMIT $3 OFFSET $4;
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, [
        productNameFilter,
        ProductCategoryID,
        pageSize,
        offset,
      ]),
      pool.query(countQuery, [productNameFilter, ProductCategoryID]),
    ]);

    const totalCount = countResult.rows[0].totalcount;

    const products = result.rows.map((row) => ({
      ProductID: row.productid,
      ProductName: row.productname,
      ProductLabel: row.productlabel,

      ProductCategoryID: row.productcategoryid,
      CategoryName: row.categoryname,

      DevelopmentLanguage: row.developmentlanguage,

      CreatedDate: row.createddate
        ? formatDate(row.createddate)
        : null,

    }));

    return {
      success: true,
      message: "Products fetched successfully",
      TotalCount: totalCount,
      PageCount: products.length,
      CurrentPage: page,
      PageSize: pageSize,
      TotalPages: Math.ceil(totalCount / pageSize),
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

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

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
const getProductsByCategory = async () => {

  try {

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

      WHERE IsDeleted = FALSE
        AND IsActive = TRUE

      ORDER BY ProductCategoryID ASC, ProductID ASC;
    `;

    const result = await pool.query(query);

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
