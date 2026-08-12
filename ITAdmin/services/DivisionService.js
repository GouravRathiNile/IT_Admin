const { pool } = require("../db");
const {formatDate} = require("../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../utils/retryableDatabaseError");

// ========================================= Create Division
const createDivision = async (data) => {
  try {
    console.log(data)
    // Last DivisionID
    const lastIdResult = await pool.query(`
      SELECT COALESCE(MAX(DivisionID), 0) AS LastID
      FROM Division_Master;
    `);

    const DivisionID = Number(lastIdResult.rows[0].lastid) + 101;

    const {
      DivisionName,
      ShortName,
      CreatedBy,
    } = data;

    const query = `
      INSERT INTO Division_Master
      (
        DivisionID,
        DivisionName,
        ShortName,
        CreatedBy
      )
      VALUES
      ($1,$2,$3,$4)
      RETURNING *;
    `;

    const values = [
      DivisionID,
      DivisionName,
      ShortName,
      CreatedBy,
    ];

    const result = await pool.query(query, values);

    return {
      success: true,
      message: "Division Created Successfully",
    //   data: result.rows[0],
    };

  } catch (error) {

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      return {
        success: false,
        message: "Division Name or Short Name already exists",
      };
    }

    console.log("Create Division Error :", error.message);

    return {
      success: false,
      message: error.message,
    };
  }
};
// ========================================= Get All Divisions
const getAllDivisions = async (page = 1, DivisionName, limit = 10) => {

    try {
        const offset = (page - 1) * limit;
        const filters = ["IsDeleted = FALSE"];
        const filterValues = [];

        if (DivisionName) {
            filterValues.push(`%${DivisionName}%`);
            filters.push(`DivisionName ILIKE $${filterValues.length}`);
        }

        const whereClause = filters.join(" AND ");
        const limitParameter = filterValues.length + 1;
        const offsetParameter = filterValues.length + 2;

        const query = `
            SELECT
                DivisionID,
                DivisionName,
                ShortName,
                CreatedDateTime
            FROM Division_Master
            WHERE ${whereClause}
            ORDER BY DivisionName ASC, DivisionID ASC
            LIMIT $${limitParameter} OFFSET $${offsetParameter};
        `;

        const countQuery = `
            SELECT COUNT(*) AS TotalCount
            FROM Division_Master
            WHERE ${whereClause};
        `;

        const [result, countResult] = await Promise.all([
            pool.query(query, [...filterValues, limit, offset]),
            pool.query(countQuery, filterValues),
        ]);

        const totalCount = Number(countResult.rows[0].totalcount);

        const divisions = result.rows.map((row) => ({

            DivisionID: row.divisionid,

            DivisionName: row.divisionname,

            ShortName: row.shortname,

            CreatedDateTime: row.createddatetime
                ? formatDate(row.createddatetime)
                : null,

        }));

        return {

            success: true,
            message: "Divisions fetched successfully",
            TotalCount: totalCount,
            PageCount: divisions.length,
            CurrentPage: page,
            PageSize: limit,
            TotalPages: Math.ceil(totalCount / limit),
            data: divisions

        };

    }

    catch (error) {

        console.log("Get Division Error :", error.message);

        return {

            success: false,
            message: error.message

        };

    }

};
// ========================================= Update Division
const updateDivision = async (data) => {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        const {
            DivisionID,
            DivisionName,
            ShortName,
            ModifiedBy
        } = data;

        // ================= Check Division Exists =================
        const exists = await client.query(
            `
            SELECT *
            FROM Division_Master
            WHERE DivisionID = $1
            AND IsDeleted = FALSE;
            `,
            [DivisionID]
        );

        if (exists.rows.length === 0) {

            await client.query("ROLLBACK");

            return {
                success: false,
                message: "Division Not Found"
            };

        }

        // ================= Duplicate Division Name =================
        const duplicateName = await client.query(
            `
            SELECT 1
            FROM Division_Master
            WHERE LOWER(DivisionName)=LOWER($1)
            AND DivisionID <> $2
            AND IsDeleted=FALSE;
            `,
            [DivisionName, DivisionID]
        );

        if (duplicateName.rows.length > 0) {

            await client.query("ROLLBACK");

            return {
                success: false,
                message: "Division Name already exists"
            };

        }

        // ================= Duplicate Short Name =================
        const duplicateShort = await client.query(
            `
            SELECT 1
            FROM Division_Master
            WHERE LOWER(ShortName)=LOWER($1)
            AND DivisionID <> $2
            AND IsDeleted=FALSE;
            `,
            [ShortName, DivisionID]
        );

        if (duplicateShort.rows.length > 0) {

            await client.query("ROLLBACK");

            return {
                success: false,
                message: "Short Name already exists"
            };

        }

        // ================= Update =================
        await client.query(
            `
            UPDATE Division_Master
            SET
                DivisionName = $1,
                ShortName = $2,
                ModifiedBy = $3,
                ModifiedDateTime = NOW()
            WHERE DivisionID = $4;
            `,
            [
                DivisionName,
                ShortName,
                ModifiedBy,
                DivisionID
            ]
        );

        await client.query("COMMIT");

        return {
            success: true,
            message: "Division Updated Successfully"
        };

    } catch (error) {

        await client.query("ROLLBACK");

        console.log("Update Division Error :", error.message);

        const retryResponse = retryableDatabaseResponse(error);
        if (retryResponse) return retryResponse;

        return {
            success: false,
            message: error.message
        };

    } finally {

        client.release();

    }

};
// ========================================= Delete Division
const deleteDivision = async (data) => {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        const { DivisionID, DeletedBy } = data;

        const result = await client.query(
            `
            UPDATE Division_Master
            SET
                IsDeleted = TRUE,
                DeletedBy = $1,
                DeletedDateTime = NOW()
            WHERE DivisionID = $2
            AND IsDeleted = FALSE
            RETURNING *;
            `,
            [DeletedBy, DivisionID]
        );

        if (result.rows.length === 0) {

            await client.query("ROLLBACK");

            return {
                success: false,
                message: "Division Not Found"
            };

        }

        await client.query("COMMIT");

        return {
            success: true,
            message: "Division Deleted Successfully"
        };

    } catch (error) {

        await client.query("ROLLBACK");

        console.log("Delete Division Error :", error.message);

        return {
            success: false,
            message: error.message
        };

    } finally {

        client.release();

    }

};
// ========================================= Get Division Dropdown
const getDivisionDropdown = async () => {

    try {

        const query = `
            SELECT
                DivisionID,
                DivisionName,
                ShortName
            FROM Division_Master
            WHERE IsDeleted = FALSE
            ORDER BY DivisionName ASC;
        `;

        const result = await pool.query(query);

        return {

            success: true,
            message: "Division dropdown fetched successfully",
            Count: result.rows.length,
            data: result.rows

        };

    }

    catch (error) {

        console.log("Division Dropdown Error :", error.message);

        return {

            success: false,
            message: error.message

        };

    }

};
module.exports = {
    createDivision,
    getAllDivisions,
    getDivisionDropdown,
    updateDivision,
    deleteDivision
};
