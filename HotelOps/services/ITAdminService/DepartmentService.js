const { pool } = require("../../db");
const {formatDate} = require("../../utils/dateFormatter");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

// ========================================= Create Department
const createDepartment = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      DepartmentName,
      DepartmentShortName,
      OrganizationID,
      DivisionID,
      CreatedBy,
    } = data;

    // ================= Insert Department =================
    const result = await client.query(
      `
      INSERT INTO Department_Master
      (
        DepartmentName,
        DepartmentShortName,
        OrganizationID,
        DivisionID,
        CreatedBy
      )
      VALUES
      (
        $1, $2, $3, $4, $5
      )
      RETURNING *;
      `,
      [
        DepartmentName,
        DepartmentShortName,
        OrganizationID,
        DivisionID,
        CreatedBy,
      ]
    );

    await client.query("COMMIT");

    return {
      success: true,
      message: "Department Created Successfully",
    };

  } catch (error) {

    await client.query("ROLLBACK");

    console.log("Create Department Error :", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    // Duplicate Department Name / Short Name
    if (error.code === "23505") {
      return {
        success: false,
        message: "Department Name or Short Name already exists",
      };
    }

    // Invalid Foreign Key
    if (error.code === "23503") {
      return {
        success: false,
        message: "Invalid Organization or Division",
      };
    }

    return {
      success: false,
      message: error.message,
    };

  } finally {
    client.release();
  }
};
// ========================================= Get All Departments
const getAllDepartments = async (
  page = 1,
  OrganizationID,
  DivisionID,
  DepartmentName,
  limit = 10
) => {
  try {
    const offset = (page - 1) * limit;
    const filters = ["dm.IsDeleted = FALSE"];
    const filterValues = [];

    if (OrganizationID) {
      filterValues.push(OrganizationID);
      filters.push(`dm.OrganizationID = $${filterValues.length}`);
    }

    if (DivisionID) {
      filterValues.push(DivisionID);
      filters.push(`dm.DivisionID = $${filterValues.length}`);
    }

    if (DepartmentName) {
      filterValues.push(`%${DepartmentName}%`);
      filters.push(`dm.DepartmentName ILIKE $${filterValues.length}`);
    }

    const whereClause = filters.join(" AND ");
    const limitParameter = filterValues.length + 1;
    const offsetParameter = filterValues.length + 2;

    const query = `
      SELECT

        dm.DepartmentID,
        dm.DepartmentName,
        dm.DepartmentShortName,

        dm.OrganizationID,

        dm.DivisionID,
        div.DivisionName,


        dm.CreatedDateTime


      FROM Department_Master dm

      INNER JOIN Division_Master div
      ON dm.DivisionID = div.DivisionID

      WHERE ${whereClause}

      ORDER BY dm.DepartmentName ASC, dm.DepartmentID ASC
      LIMIT $${limitParameter} OFFSET $${offsetParameter};
    `;

    const countQuery = `
      SELECT COUNT(*) AS TotalCount
      FROM Department_Master dm
      INNER JOIN Division_Master div
      ON dm.DivisionID = div.DivisionID
      WHERE ${whereClause};
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, [...filterValues, limit, offset]),
      pool.query(countQuery, filterValues),
    ]);

    const totalCount = Number(countResult.rows[0].totalcount);

    const departments = result.rows.map((row) => ({

      DepartmentID: row.departmentid,
      DepartmentName: row.departmentname,
      DepartmentShortName: row.departmentshortname,

      OrganizationID: row.organizationid,

      DivisionID: row.divisionid,
      DivisionName: row.divisionname,

      CreatedDateTime: row.createddatetime
        ? formatDate(row.createddatetime)
        : null,



    }));

    return {

      success: true,
      message: "Departments fetched successfully",
      TotalCount: totalCount,
      PageCount: departments.length,
      CurrentPage: page,
      PageSize: limit,
      TotalPages: Math.ceil(totalCount / limit),
      data: departments,

    };

  } catch (error) {

    console.log("Get Department Error :", error.message);

    return {

      success: false,
      message: error.message,

    };

  }
};
// ========================================= Department Dropdown
const getDepartmentsDropdown = async (OrganizationID, DivisionID) => {
  try {
    const filters = ["IsDeleted = FALSE"];
    const values = [];

    if (OrganizationID) {
      values.push(OrganizationID);
      filters.push(`OrganizationID = $${values.length}`);
    }

    if (DivisionID) {
      values.push(DivisionID);
      filters.push(`DivisionID = $${values.length}`);
    }

    const whereClause = filters.join(" AND ");

    const query = `
      SELECT
        DepartmentID,
        DepartmentName,
        DepartmentShortName,
        OrganizationID,
        DivisionID
      FROM Department_Master
      WHERE ${whereClause}
      ORDER BY DepartmentName ASC;
    `;

    const result = await pool.query(query, values);

    const departments = result.rows.map((row) => ({
      DepartmentID: row.departmentid,
      DepartmentName: row.departmentname,
      DepartmentShortName: row.departmentshortname,
      OrganizationID: row.organizationid,
      DivisionID: row.divisionid,
    }));

    return {
      success: true,
      message: "Department Dropdown fetched successfully",
      Count: departments.length,
      data: departments,
    };

  } catch (error) {

    console.log("Department Dropdown Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Update Department
const updateDepartment = async (data) => {
  try {

    const {
      DepartmentID,
      DepartmentName,
      DepartmentShortName,
      OrganizationID,
      DivisionID,
      ModifiedBy,
    } = data;

    const query = `
      UPDATE Department_Master
      SET
        DepartmentName = $1,
        DepartmentShortName = $2,
        OrganizationID = $3,
        DivisionID = $4,
        ModifiedBy = $5,
        ModifiedDateTime = NOW()

      WHERE DepartmentID = $6
      AND IsDeleted = FALSE

      RETURNING *;
    `;

    const values = [
      DepartmentName,
      DepartmentShortName,
      OrganizationID,
      DivisionID,
      ModifiedBy,
      DepartmentID,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: "Department Not Found",
      };
    }

    return {
      success: true,
      message: "Department Updated Successfully",
    };

  } catch (error) {

    console.log("Update Department Error :", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      return {
        success: false,
        message: "Department Name or Short Name already exists",
      };
    }

    if (error.code === "23503") {
      return {
        success: false,
        message: "Invalid Organization or Division",
      };
    }

    return {
      success: false,
      message: error.message,
    };

  }
};
// ========================================= Delete Department
const deleteDepartment = async (data) => {
  try {

    const { DepartmentID, DeletedBy } = data;

    const query = `
      UPDATE Department_Master
      SET
        IsDeleted = TRUE,
        DeletedBy = $1,
        DeletedDateTime = NOW()

      WHERE DepartmentID = $2
      AND IsDeleted = FALSE

      RETURNING *;
    `;

    const result = await pool.query(query, [
      DeletedBy,
      DepartmentID,
    ]);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: "Department Not Found",
      };
    }

    return {
      success: true,
      message: "Department Deleted Successfully",
    };

  } catch (error) {

    console.log("Delete Department Error :", error.message);

    return {
      success: false,
      message: error.message,
    };

  }
};


module.exports = {
  createDepartment,
  getAllDepartments,
  getDepartmentsDropdown,
  updateDepartment,
  deleteDepartment,
};
