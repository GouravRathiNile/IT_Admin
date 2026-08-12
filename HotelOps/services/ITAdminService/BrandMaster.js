const { pool } = require("../../db");
const generateUrl = require("../../AzurConfigration/ITAdmin/BrandMaster/AzureGetData");
const {formatDate} = require("../../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");
//=========================================== Create Brand
const createBrand = async (data) => {
  try {
    const {
      BrandCode,
      BrandName,
      ShortName,
      BrandLogo,
      Website,
      IsActive,
      CreatedBy,
      IsDeleted,
    } = data;

    const query = `
        INSERT INTO Brand_Master
        (
            BrandCode,
            BrandName,
            ShortName,
            BrandLogo,
            Website,
            IsActive,
            CreatedBy,
            IsDeleted
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
    `;

    const values = [
      BrandCode,
      BrandName,
      ShortName,
      BrandLogo,
      Website,
      IsActive,
      CreatedBy,
      IsDeleted,
    ];

    await pool.query(query, values);

    return {
      success: true,
      message: "Brand Created Successfully",
    };
  } catch (error) {
    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      return {
        success: false,
        message: "Brand Code already exists",
      };
    }

    if (error.code === "23502" && error.column === "brandcode") {
      return {
        success: false,
        message: "Brand Code is required",
      };
    }

    return {
      success: false,
      message: "Unable to create brand",
    };
  }
};
// =========================================Get All Brands
const getAllBrands = async (page = 1, date, limit = 10, BrandName) => {
  try {
    const offset = (page - 1) * limit;
    const filters = ["IsDeleted = FALSE", "IsActive = TRUE"];
    const filterValues = [];

    if (date) {
      filterValues.push(date);
      filters.push(`CreatedDateTime >= $${filterValues.length}::date`);
      filters.push(
        `CreatedDateTime < ($${filterValues.length}::date + INTERVAL '1 day')`
      );
    }

    if (BrandName) {
      filterValues.push(`%${BrandName}%`);
      filters.push(`BrandName ILIKE $${filterValues.length}`);
    }

    const whereClause = filters.join(" AND ");
    const limitParameter = filterValues.length + 1;
    const offsetParameter = filterValues.length + 2;

    const query = `
            SELECT
              BrandID,
              BrandCode,
              BrandName,
              ShortName,
              BrandLogo,
              Website,
              CreatedDateTime
            FROM Brand_Master
            WHERE ${whereClause}
            ORDER BY BrandID DESC
            LIMIT $${limitParameter} OFFSET $${offsetParameter};
        `;

    const countQuery = `
      SELECT COUNT(*) AS TotalCount
      FROM Brand_Master
      WHERE IsDeleted = FALSE
      AND IsActive = TRUE;
    `;

    const filteredCountQuery = `
      SELECT COUNT(*) AS FilteredCount
      FROM Brand_Master
      WHERE ${whereClause};
    `;

    const [result, countResult, filteredCountResult] = await Promise.all([
      pool.query(query, [...filterValues, limit, offset]),
      pool.query(countQuery),
      pool.query(filteredCountQuery, filterValues),
    ]);

    const totalCount = Number(countResult.rows[0].totalcount);
    const filteredCount = Number(filteredCountResult.rows[0].filteredcount);
    const brands = result.rows.map((brand) => ({
        ...brand,
        brandlogo: brand.brandlogo ? generateUrl(brand.brandlogo) : null,
        createddatetime: brand.createddatetime
          ? formatDate(brand.createddatetime)
          : null,
    }));

    return {
      success: true,
      message: "Brands fetched successfully",
      TotalCount: totalCount,
      PageCount: brands.length,
      CurrentPage: page,
      PageSize: limit,
      TotalPages: Math.ceil(filteredCount / limit),
      data: brands,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};
// =========================================Update Brand
const updateBrand = async (data) => {
  try {
    const {
      BrandID,
      BrandCode,
      BrandName,
      ShortName,
      BrandLogo,
      Website,
      ModifiedBy,
    } = data;

    let query = "";
    let values = [];

    if (BrandLogo) {
      query = `
                UPDATE Brand_Master
                SET
                    BrandCode = $1,
                    BrandName = $2,
                    ShortName = $3,
                    BrandLogo = $4,
                    Website = $5,
                    IsActive = TRUE,
                    ModifiedBy = $6,
                    ModifiedDateTime = NOW()
                WHERE BrandID = $7
                AND IsDeleted = FALSE
                RETURNING *;
            `;

      values = [
        BrandCode,
        BrandName,
        ShortName,
        BrandLogo,
        Website,
        ModifiedBy,
        BrandID,
      ];
    } else {
      query = `
                UPDATE Brand_Master
                SET
                    BrandCode = $1,
                    BrandName = $2,
                    ShortName = $3,
                    Website = $4,
                    IsActive = TRUE,
                    ModifiedBy = $5,
                    ModifiedDateTime = NOW()
                WHERE BrandID = $6
                AND IsDeleted = FALSE
                RETURNING *;
            `;

      values = [BrandCode, BrandName, ShortName, Website, ModifiedBy, BrandID];
    }

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: "Brand Not Found",
      };
    }

    return {
      success: true,
      message: "Brand Updated Successfully",
    };
  } catch (error) {
    console.log("Update Brand Error :", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23502" && error.column === "brandcode") {
      return {
        success: false,
        message: "Brand Code is required",
      };
    }

    if (error.code === "23505") {
      return {
        success: false,
        message: "Brand Code already exists",
      };
    }

    return {
      success: false,
      message: "Unable to update brand",
    };
  }
};
// =========================================Delete Brand
const deleteBrand = async (BrandID, DeletedBy) => {
  const query = `
        UPDATE Brand_Master
        SET
            IsDeleted=TRUE,
            DeletedBy=$1,
            DeletedDateTime=NOW()
        WHERE BrandID=$2
        RETURNING *;
    `;

  const result = await pool.query(query, [DeletedBy, BrandID]);

  if (result.rows.length === 0) {
    return {
      success: false,
      message: "Brand Not Found",
    };
  }

  return {
    success: true,
    message: "Brand Deleted Successfully",
  };
};
// =============================================Get For Brand Dropdown
const getBrandDropdown = async () => {
  try {
    const query = `
            SELECT
                BrandID,
                BrandCode,
                BrandName,
                ShortName
            FROM Brand_Master
            WHERE IsDeleted = FALSE
            AND IsActive = TRUE
            ORDER BY BrandName ASC;
        `;

    const result = await pool.query(query);

    return {
      success: true,
      message: "Brand List fetched successfully",
      Count : result.rows.length,
      data: result.rows,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};

module.exports = {
  createBrand,
  getAllBrands,
  updateBrand,
  deleteBrand,
  getBrandDropdown,
};
