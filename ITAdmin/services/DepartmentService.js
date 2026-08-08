const { pool } = require("../db");
const {formatDate} = require("../utils/dateFormatter");

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
const getAllDepartments = async () => {
  try {

    const query = `
      SELECT

        dm.DepartmentID,
        dm.DepartmentName,
        dm.DepartmentShortName,

        dm.OrganizationID,

        dm.DivisionID,
        div.DivisionName,

        dm.CreatedBy,
        dm.CreatedDateTime,

        dm.ModifiedBy,
        dm.ModifiedDateTime,

        dm.DeletedBy,
        dm.DeletedDateTime

      FROM Department_Master dm

      INNER JOIN Division_Master div
      ON dm.DivisionID = div.DivisionID

      WHERE dm.IsDeleted = FALSE

      ORDER BY dm.DepartmentName ASC;
    `;

    const result = await pool.query(query);

    const departments = result.rows.map((row) => ({

      DepartmentID: row.departmentid,
      DepartmentName: row.departmentname,
      DepartmentShortName: row.departmentshortname,

      OrganizationID: row.organizationid,

      DivisionID: row.divisionid,
      DivisionName: row.divisionname,

      CreatedBy: row.createdby,
      CreatedDateTime: row.createddatetime
        ? formatDate(row.createddatetime)
        : null,

      ModifiedBy: row.modifiedby,
      ModifiedDateTime: row.modifieddatetime
        ? formatDate(row.modifieddatetime)
        : null,

      DeletedBy: row.deletedby,
      DeletedDateTime: row.deleteddatetime
        ? formatDate(row.deleteddatetime)
        : null,

    }));

    return {

      success: true,
      message: "Departments fetched successfully",
      Count: departments.length,
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
const getDepartmentsDropdown = async () => {
  try {

    const query = `
      SELECT
        DepartmentID,
        DepartmentName,
        DepartmentShortName,
        OrganizationID
      FROM Department_Master
      WHERE IsDeleted = FALSE
      ORDER BY DepartmentName ASC;
    `;

    const result = await pool.query(query);

    const departments = result.rows.map((row) => ({
      DepartmentID: row.departmentid,
      DepartmentName: row.departmentname,
      DepartmentShortName: row.departmentshortname,
      OrganizationID: row.organizationid,
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