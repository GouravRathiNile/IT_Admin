const { pool } = require("../db");
const generateUrl = require("../AzurConfigration/UserMaster/AzureGetData");
const { formatDate } = require("../utils/dateFormatter");
const bcrypt = require("bcrypt");
const { retryableDatabaseResponse } = require("../utils/retryableDatabaseError");

// ============================================================Create User
const createUser = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      EmployeeCode,
      Username,
      PasswordHash,
      FullName,
      Designation,
      Department,
      Division,
      LoginType,
      UserType,
      Email,
      PhoneNumber,
      Gender,
      ProfilePhoto,
      LastPasswordChangedDate,
      PasswordExpiryDate,
      DateOfJoining,
      IsLocked,
      IsActive,
      IsDeleted,
      CreatedBy,
      Organizations,
      Products,
    } = data;

    // ========================================================
    // Generate UserID
    // ========================================================

    const userIdResult = await client.query(`
      SELECT COALESCE(MAX(UserID), 0) + 1 AS UserID
      FROM user_master;
    `);

    const UserID = Number(userIdResult.rows[0].userid);
// ========================================================
    // Hash Password
    // ========================================================

    const hashedPassword = await bcrypt.hash(
      PasswordHash,
      10
    );
    // ========================================================
    // Insert User
    // ========================================================

    const userResult = await client.query(
      `
      INSERT INTO user_master
      (
        UserID,

        EmployeeCode,
        Username,
        PasswordHash,
        FullName,

        Designation,
        Department,
        Division,

        LoginType,
        UserType,

        Email,
        PhoneNumber,
        Gender,

        ProfilePhoto,

        LastPasswordChangedDate,
        PasswordExpiryDate,

        IsLocked,
        IsActive,
        IsDeleted,

        DateOfJoining,

        CreatedBy
      )
      VALUES
      (
        $1,

        $2,
        $3,
        $4,
        $5,

        $6,
        $7,
        $8,

        $9,
        $10,

        $11,
        $12,
        $13,

        $14,

        $15,
        $16,

        $17,
        $18,
        $19,

        $20,

        $21
      )
      RETURNING UserID;
      `,
      [
        UserID,

        EmployeeCode || null,
        Username,
        hashedPassword,
        FullName,

        Designation || null,
        Department || null,
        Division || null,

        LoginType,
        UserType || null,

        Email || null,
        PhoneNumber || null,
        Gender || null,

        ProfilePhoto || null,

        LastPasswordChangedDate || null,
        PasswordExpiryDate || null,

        IsLocked ?? false,
        IsActive ?? true,
        IsDeleted ?? false,

        DateOfJoining || null,

        CreatedBy || null,
      ],
    );

    // ========================================================
    // Organization Mapping
    // ========================================================

    if (Array.isArray(Organizations) && Organizations.length > 0) {
      for (const organization of Organizations) {
        const { BrandID, OrganizationID } = organization;

        if (!BrandID || !OrganizationID) {
          throw new Error("BrandID and OrganizationID are required");
        }

        // Generate UserOrgMapID

        const mappingIdResult = await client.query(`
          SELECT COALESCE(MAX(UserOrgMapID), 0) + 1 AS UserOrgMapID
          FROM user_org_mapping;
        `);

        const UserOrgMapID = Number(mappingIdResult.rows[0].userorgmapid);

        // Insert Organization Mapping

        await client.query(
          `
          INSERT INTO user_org_mapping
          (
            UserOrgMapID,
            UserID,
            BrandID,
            OrganizationID,
            IsActive,
            IsDeleted,
            CreatedBy
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            TRUE,
            FALSE,
            $5
          );
          `,
          [UserOrgMapID, UserID, BrandID, OrganizationID, CreatedBy || null],
        );
      }
    }

    // ========================================================
    // Product Mapping
    // ========================================================

    if (Array.isArray(Products) && Products.length > 0) {
      for (const product of Products) {
        const { ProductID } = product;

        if (!ProductID) {
          throw new Error("ProductID is required");
        }

        // Generate UserProductMapID

        const mappingIdResult = await client.query(`
          SELECT COALESCE(MAX(UserProductMapID), 0) + 1 AS UserProductMapID
          FROM user_product_mapping;
        `);

        const UserProductMapID = Number(
          mappingIdResult.rows[0].userproductmapid,
        );

        // Insert Product Mapping

        await client.query(
          `
          INSERT INTO user_product_mapping
          (
            UserProductMapID,
            UserID,
            ProductID,
            IsActive,
            IsDeleted,
            CreatedBy
          )
          VALUES
          (
            $1,
            $2,
            $3,
            TRUE,
            FALSE,
            $4
          );
          `,
          [UserProductMapID, UserID, ProductID, CreatedBy || null],
        );
      }
    }

    // ========================================================
    // Commit
    // ========================================================

    await client.query("COMMIT");

    return {
      success: true,
      message: "User Created Successfully",
      data: {
        UserID: userResult.rows[0].userid,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.log("Create User Error :", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    // PostgreSQL Duplicate
    if (error.code === "23505") {
      return {
        success: false,
        message: "Username, Employee Code, Email or Mapping already exists",
      };
    }

    // PostgreSQL Foreign Key
    if (error.code === "23503") {
      return {
        success: false,
        message: "Invalid Brand, Organization or Product",
      };
    }

    // NOT NULL violation
    if (error.code === "23502") {
      return {
        success: false,
        message: "Required field is missing",
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
// ============================================================DELETE USER
const deleteUser = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { UserID, DeletedBy } = data;

    // ========================================================
    // Soft Delete User
    // ========================================================

    const userResult = await client.query(
      `
      UPDATE user_master

      SET
        IsDeleted = TRUE,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE

      RETURNING UserID;
      `,
      [DeletedBy, UserID],
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return {
        success: false,

        message: "User Not Found",
      };
    }

    // ========================================================
    // Soft Delete Organization Mapping
    // ========================================================

    await client.query(
      `
      UPDATE user_org_mapping

      SET

        IsDeleted = TRUE,

        IsActive = FALSE,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE;
      `,
      [DeletedBy, UserID],
    );

    // ========================================================
    // Soft Delete Product Mapping
    // ========================================================

    await client.query(
      `
      UPDATE user_product_mapping

      SET

        IsDeleted = TRUE,

        IsActive = FALSE,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE;
      `,
      [DeletedBy, UserID],
    );

    // ========================================================
    // Commit
    // ========================================================

    await client.query("COMMIT");

    return {
      success: true,

      message: "User Deleted Successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.log("Delete User Error :", error.message);

    return {
      success: false,

      message: error.message,
    };
  } finally {
    client.release();
  }
};
// ============================================================ GET ALL USERS
const getAllUsers = async () => {
  try {
    const query = `
      SELECT

        um.UserID,
        um.EmployeeCode,
        um.Username,
        um.FullName,

        um.Designation,
        um.Department,
        um.Division,

        um.LoginType,
        um.UserType,

        um.Email,
        um.PhoneNumber,
        um.Gender,

        um.ProfilePhoto,

        um.LastPasswordChangedDate,
        um.PasswordExpiryDate,
        um.LastLogin,

        um.IsLocked,
        um.IsActive,

        um.DateOfJoining,

        um.CreatedBy,
        um.CreatedDate,

        um.ModifiedBy,
        um.ModifiedDate,

        um.DeletedBy,
        um.DeletedDate

      FROM user_master um

      WHERE um.IsDeleted = FALSE

      ORDER BY um.FullName ASC;
    `;

    const result = await pool.query(query);

    const users = [];

    for (const row of result.rows) {
      // ======================================================
      // Organization Mapping
      // ======================================================

      const organizationQuery = `
        SELECT

          uom.UserOrgMapID,

          uom.BrandID,
          bm.BrandName,

          uom.OrganizationID,
          om.OrganizationName

        FROM user_org_mapping uom

        LEFT JOIN Brand_Master bm
          ON uom.BrandID = bm.BrandID

        LEFT JOIN Organization_Master om
          ON uom.OrganizationID = om.OrganizationID

        WHERE uom.UserID = $1
          AND uom.IsDeleted = FALSE
          AND uom.IsActive = TRUE

        ORDER BY om.OrganizationName ASC;
      `;

      const organizationResult = await pool.query(organizationQuery, [
        row.userid,
      ]);

      // ======================================================
      // Product Mapping
      // ======================================================

      const productQuery = `
        SELECT

          upm.UserProductMapID,

          upm.ProductID,
          pm.ProductName,
          pm.ProductLabel,

          pm.ProductCategoryID,
          pcm.CategoryName

        FROM user_product_mapping upm

        LEFT JOIN Product_Master pm
          ON upm.ProductID = pm.ProductID

        LEFT JOIN product_category_master pcm
          ON pm.ProductCategoryID = pcm.ProductCategoryID

        WHERE upm.UserID = $1
          AND upm.IsDeleted = FALSE
          AND upm.IsActive = TRUE

        ORDER BY pm.ProductName ASC;
      `;

      const productResult = await pool.query(productQuery, [row.userid]);

      // ======================================================
      // User Object
      // ======================================================

      users.push({
        UserID: row.userid,

        EmployeeCode: row.employeecode,
        Username: row.username,
        FullName: row.fullname,

        Designation: row.designation,
        Department: row.department,
        Division: row.division,

        LoginType: row.logintype,
        UserType: row.usertype,

        Email: row.email,
        PhoneNumber: row.phonenumber,
        Gender: row.gender,

        ProfilePhoto: row.profilephoto ? generateUrl(row.profilephoto) : null,

        LastPasswordChangedDate: formatDate(row.lastpasswordchangeddate),

        PasswordExpiryDate: formatDate(row.passwordexpirydate),

        LastLogin: formatDate(row.lastlogin),

        IsLocked: row.islocked,
        IsActive: row.isactive,

        DateOfJoining: row.dateofjoining ? formatDate(row.dateofjoining) : null,

        CreatedBy: row.createdby,

        CreatedDate: formatDate(row.createddate),

        ModifiedBy: row.modifiedby,

        ModifiedDate: formatDate(row.modifieddate),

        DeletedBy: row.deletedby,

        DeletedDate: formatDate(row.deleteddate),

        // ==================================================
        // Organizations
        // ==================================================

        Organizations: organizationResult.rows.map((organization) => ({
          UserOrgMapID: organization.userorgmapid,

          BrandID: organization.brandid,

          BrandName: organization.brandname,

          OrganizationID: organization.organizationid,

          OrganizationName: organization.organizationname,
        })),

        // ==================================================
        // Products
        // ==================================================

        Products: productResult.rows.map((product) => ({
          UserProductMapID: product.userproductmapid,

          ProductID: product.productid,

          ProductName: product.productname,

          ProductLabel: product.productlabel,

          ProductCategoryID: product.productcategoryid,

          CategoryName: product.categoryname,
        })),
      });
    }

    return {
      success: true,

      message: "Users fetched successfully",

      Count: users.length,

      data: users,
    };
  } catch (error) {
    console.log("Get All Users Error :", error.message);

    return {
      success: false,

      message: error.message,
    };
  }
};
// ============================================================GET USER BY ID
const getUserById = async (data) => {
  try {
    const { UserID } = data;

    // ========================================================
    // User
    // ========================================================

    const userQuery = `
      SELECT

        UserID,
        EmployeeCode,
        Username,
        FullName,

        Designation,
        Department,
        Division,

        LoginType,
        UserType,

        Email,
        PhoneNumber,
        Gender,

        ProfilePhoto,

        LastPasswordChangedDate,
        PasswordExpiryDate,
        LastLogin,

        IsLocked,
        IsActive,

        DateOfJoining,

        CreatedBy,
        CreatedDate,

        ModifiedBy,
        ModifiedDate,

        DeletedBy,
        DeletedDate

      FROM user_master

      WHERE UserID = $1
        AND IsDeleted = FALSE;
    `;

    const userResult = await pool.query(userQuery, [UserID]);

    if (userResult.rows.length === 0) {
      return {
        success: false,
        message: "User Not Found",
      };
    }

    const user = userResult.rows[0];

    // ========================================================
    // Organizations
    // ========================================================

    const organizationResult = await pool.query(
      `
        SELECT

          uom.UserOrgMapID,

          uom.BrandID,
          bm.BrandName,

          uom.OrganizationID,
          om.OrganizationName

        FROM user_org_mapping uom

        LEFT JOIN Brand_Master bm
          ON uom.BrandID = bm.BrandID

        LEFT JOIN Organization_Master om
          ON uom.OrganizationID = om.OrganizationID

        WHERE uom.UserID = $1
          AND uom.IsDeleted = FALSE
          AND uom.IsActive = TRUE

        ORDER BY om.OrganizationName ASC;
        `,
      [UserID],
    );

    // ========================================================
    // Products
    // ========================================================

    const productResult = await pool.query(
      `
        SELECT

          upm.UserProductMapID,

          upm.ProductID,

          pm.ProductName,
          pm.ProductLabel,

          pm.ProductCategoryID,
          pcm.CategoryName

        FROM user_product_mapping upm

        LEFT JOIN Product_Master pm
          ON upm.ProductID = pm.ProductID

        LEFT JOIN product_category_master pcm
          ON pm.ProductCategoryID = pcm.ProductCategoryID

        WHERE upm.UserID = $1
          AND upm.IsDeleted = FALSE
          AND upm.IsActive = TRUE

        ORDER BY pm.ProductName ASC;
        `,
      [UserID],
    );

    // ========================================================
    // Response
    // ========================================================

    const response = {
      UserID: user.userid,

      EmployeeCode: user.employeecode,

      Username: user.username,

      FullName: user.fullname,

      Designation: user.designation,

      Department: user.department,

      Division: user.division,

      LoginType: user.logintype,

      UserType: user.usertype,

      Email: user.email,

      PhoneNumber: user.phonenumber,

      Gender: user.gender,

      ProfilePhoto: user.profilephoto ? generateUrl(user.profilephoto) : null,

      LastPasswordChangedDate: formatDate(user.lastpasswordchangeddate),

      PasswordExpiryDate: formatDate(user.passwordexpirydate),

      LastLogin: formatDate(user.lastlogin),

      IsLocked: user.islocked,

      IsActive: user.isactive,

      DateOfJoining: user.dateofjoining ? formatDate(user.dateofjoining) : null,

      CreatedBy: user.createdby,

      CreatedDate: formatDate(user.createddate),

      ModifiedBy: user.modifiedby,

      ModifiedDate: formatDate(user.modifieddate),

      DeletedBy: user.deletedby,

      DeletedDate: formatDate(user.deleteddate),

      // ======================================================
      // Organizations
      // ======================================================

      Organizations: organizationResult.rows.map((organization) => ({
        UserOrgMapID: organization.userorgmapid,

        BrandID: organization.brandid,

        BrandName: organization.brandname,

        OrganizationID: organization.organizationid,

        OrganizationName: organization.organizationname,
      })),

      // ======================================================
      // Products
      // ======================================================

      Products: productResult.rows.map((product) => ({
        UserProductMapID: product.userproductmapid,

        ProductID: product.productid,

        ProductName: product.productname,

        ProductLabel: product.productlabel,

        ProductCategoryID: product.productcategoryid,

        CategoryName: product.categoryname,
      })),
    };

    return {
      success: true,

      message: "User fetched successfully",

      data: response,
    };
  } catch (error) {
    console.log("Get User By ID Error :", error.message);

    return {
      success: false,

      message: error.message,
    };
  }
};
// ============================================================USER DROPDOWN
const getUserDropdown = async () => {
  try {
    const query = `
      SELECT

        UserID,
        Username,
        FullName

      FROM user_master

      WHERE IsDeleted = FALSE
        AND IsActive = TRUE

      ORDER BY FullName ASC;
    `;

    const result = await pool.query(query);

    const users = result.rows.map((row) => ({
      UserID: row.userid,


      Username: row.username,

      FullName: row.fullname,

 }));

    return {
      success: true,

      message: "Users fetched successfully",

      Count: users.length,

      data: users,
    };
  } catch (error) {
    console.log("Get User Dropdown Error :", error.message);

    return {
      success: false,

      message: error.message,
    };
  }
};
// ============================================================User wise Organization
const getUserOrganizations = async (UserID) => {
  try {
    const result = await pool.query(
      `
      SELECT

        uom.UserID,

        uom.OrganizationID,
        om.OrganizationName,
        om.ShortName

      FROM user_org_mapping uom

      LEFT JOIN Organization_Master om
        ON uom.OrganizationID = om.OrganizationID

      WHERE uom.UserID = $1
        AND uom.IsActive = TRUE
        AND uom.IsDeleted = FALSE

      ORDER BY
        om.OrganizationName ASC;
      `,
      [UserID],
    );

    return {
      success: true,

      message: "User organizations fetched successfully",

      Count: result.rows.length,

      data: result.rows.map((row) => ({
        UserID: row.userid,

        OrganizationID: row.organizationid,

        OrganizationName: row.organizationname,

        ShortName: row.shortname,
      })),
    };

  } catch (error) {

    console.log(
      "Get My Organizations Error:",
      error.message
    );

    return {
      success: false,
      message: error.message,
    };
  }
};
// ============================================================User wise product
const getUserProducts = async (UserID) => {
  try {

    const result = await pool.query(
      `
      SELECT

        upm.UserID,

        upm.ProductID,

        pm.ProductName,
        pm.ProductLabel

      FROM user_product_mapping upm

      LEFT JOIN Product_Master pm
        ON upm.ProductID = pm.ProductID

      WHERE upm.UserID = $1
        AND upm.IsActive = TRUE
        AND upm.IsDeleted = FALSE

      ORDER BY
        pm.ProductName ASC;
      `,
      [UserID]
    );


    return {

      success: true,

      message:
        "User products fetched successfully",

      Count:
        result.rows.length,

      data:
        result.rows.map((row) => ({

          UserID:
            row.userid,

          ProductID:
            row.productid,

          ProductName:
            row.productname,

          ProductLabel:
            row.productlabel,

        })),

    };

  } catch (error) {

    console.log(
      "Get User Products Error:",
      error.message
    );

    return {

      success: false,

      message:
        error.message,

    };

  }
};
// ============================================================User Personal details
const getUserPersonalDetails = async (UserID) => {
  try {

    const result = await pool.query(
      `
      SELECT

        UserID,

        EmployeeCode,
        Username,
        FullName,

        Designation,
        Department,
        Division,

        LoginType,
        UserType,

        Email,
        PhoneNumber,
        Gender,

        ProfilePhoto,

        LastPasswordChangedDate,
        PasswordExpiryDate,
        LastLogin,

        IsLocked,
        IsActive,

        DateOfJoining,

        CreatedBy,
        CreatedDate,

        ModifiedBy,
        ModifiedDate

      FROM user_master

      WHERE UserID = $1
        AND IsDeleted = FALSE

      LIMIT 1;
      `,
      [UserID]
    );


    // ========================================================
    // User Not Found
    // ========================================================

    if (result.rows.length === 0) {

      return {
        success: false,
        message: "User not found",
      };

    }


    const user = result.rows[0];


    // ========================================================
    // Response
    // ========================================================

    return {

      success: true,

      message:
        "User personal details fetched successfully",

      data: {

        UserID:
          user.userid,

        EmployeeCode:
          user.employeecode,

        Username:
          user.username,

        FullName:
          user.fullname,

        Designation:
          user.designation,

        Department:
          user.department,

        Division:
          user.division,

        LoginType:
          user.logintype,

        UserType:
          user.usertype,

        Email:
          user.email,

        PhoneNumber:
          user.phonenumber,

        Gender:
          user.gender,

        ProfilePhoto:
          user.profilephoto
            ? generateUrl(user.profilephoto)
            : null,

    

        PasswordExpiryDate:
          user.passwordexpirydate
            ? formatDate(user.passwordexpirydate)
            : null,


      

        DateOfJoining:
          user.dateofjoining
            ? formatDate(user.dateofjoining)
            : null,


      },

    };

  } catch (error) {

    console.log(
      "Get User Personal Details Error:",
      error.message
    );

    return {

      success: false,

      message:
        error.message,

    };

  }
};
// ============================================================User Tabel
const getAllUsersTabel = async () => {
  try {
    const query = `
      SELECT
        um.UserID,
        um.EmployeeCode,
        um.Username,
        um.FullName,

        um.Designation,
        um.Department,
        um.Division,

        um.LoginType,
        um.UserType,

        um.Email,
        um.PhoneNumber,
        um.Gender

      FROM user_master um

      WHERE um.IsDeleted = FALSE

      ORDER BY um.FullName ASC;
    `;

    const result = await pool.query(query);

    return {
      success: true,

      message: "Users fetched successfully",

      Count: result.rows.length,

      data: result.rows.map((row) => ({
        UserID: row.userid,

        EmployeeCode: row.employeecode,
        Username: row.username,
        FullName: row.fullname,

        Designation: row.designation,
        Department: row.department,
        Division: row.division,

        LoginType: row.logintype,
        UserType: row.usertype,

        Email: row.email,
        PhoneNumber: row.phonenumber,
        Gender: row.gender,
      })),
    };

  } catch (error) {

    console.log(
      "Get All Users Error:",
      error.message
    );

    return {
      success: false,
      message: error.message,
    };
  }
};
// ============================================================UPDATE USER
const updateUser = async (data) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      UserID,

      EmployeeCode,
      Username,
      PasswordHash,
      FullName,

      Designation,
      Department,
      Division,

      LoginType,
      UserType,

      Email,
      PhoneNumber,
      Gender,

      ProfilePhoto,

      LastPasswordChangedDate,
      PasswordExpiryDate,
      DateOfJoining,

      IsLocked,
      IsActive,

      ModifiedBy,

      Organizations,
      Products,
    } = data;

    // ========================================================
    // Check User
    // ========================================================

    const userCheck = await client.query(
      `
      SELECT UserID, ProfilePhoto
      FROM user_master
      WHERE UserID = $1
        AND IsDeleted = FALSE;
      `,
      [UserID],
    );

    if (userCheck.rows.length === 0) {
      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User Not Found",
      };
    }

    const oldProfilePhoto = userCheck.rows[0].profilephoto;

    // ========================================================
    // Profile Photo
    // ========================================================
    // New photo aayi hai to new photo save hogi.
    // New photo nahi aayi to old photo preserve hogi.

    const finalProfilePhoto =
      ProfilePhoto !== undefined ? ProfilePhoto : oldProfilePhoto;

    // ========================================================
    // Update User
    // ========================================================

    const result = await client.query(
      `
      UPDATE user_master
      SET

        EmployeeCode = $1,
        Username = $2,
        PasswordHash = $3,
        FullName = $4,

        Designation = $5,
        Department = $6,
        Division = $7,

        LoginType = $8,
        UserType = $9,

        Email = $10,
        PhoneNumber = $11,
        Gender = $12,

        ProfilePhoto = $13,

        LastPasswordChangedDate = $14,
        PasswordExpiryDate = $15,

        IsLocked = $16,
        IsActive = $17,

        DateOfJoining = $18,

        ModifiedBy = $19,
        ModifiedDate = CURRENT_TIMESTAMP

      WHERE UserID = $20
        AND IsDeleted = FALSE

      RETURNING UserID;
      `,
      [
        EmployeeCode,
        Username,
        PasswordHash,
        FullName,

        Designation,
        Department,
        Division,

        LoginType,
        UserType,

        Email,
        PhoneNumber,
        Gender,

        finalProfilePhoto,

        LastPasswordChangedDate || null,
        PasswordExpiryDate || null,

        IsLocked ?? false,
        IsActive ?? true,

        DateOfJoining || null,

        ModifiedBy,

        UserID,
      ],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User Not Found",
      };
    }

    // ========================================================
    // ORGANIZATION MAPPING
    // ========================================================
    if (Array.isArray(Organizations) && Organizations.length > 0) {
      for (const organization of Organizations) {
        const { BrandID, OrganizationID } = organization;

        if (!BrandID || !OrganizationID) {
          throw new Error("BrandID and OrganizationID are required");
        }

        const mappingIdResult = await client.query(`
      SELECT COALESCE(MAX(UserOrgMapID), 0) + 1 AS UserOrgMapID
      FROM user_org_mapping;
    `);

        const UserOrgMapID = Number(mappingIdResult.rows[0].userorgmapid);

        await client.query(
          `
      INSERT INTO user_org_mapping
      (
        UserOrgMapID,
        UserID,
        BrandID,
        OrganizationID,
        IsActive,
        IsDeleted,
        CreatedBy
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        TRUE,
        FALSE,
        $5
      )
      ON CONFLICT (UserID, BrandID, OrganizationID)
      DO NOTHING;
      `,
          [UserOrgMapID, UserID, BrandID, OrganizationID, ModifiedBy || null],
        );
      }
    }
    // ========================================================
    // PRODUCT MAPPING
    // ========================================================
    if (Array.isArray(Products) && Products.length > 0) {
      for (const product of Products) {
        const { ProductID } = product;

        if (!ProductID) {
          throw new Error("ProductID is required");
        }

        const mappingIdResult = await client.query(`
      SELECT COALESCE(MAX(UserProductMapID), 0) + 1 AS UserProductMapID
      FROM user_product_mapping;
    `);

        const UserProductMapID = Number(
          mappingIdResult.rows[0].userproductmapid,
        );

        await client.query(
          `
      INSERT INTO user_product_mapping
      (
        UserProductMapID,
        UserID,
        ProductID,
        IsActive,
        IsDeleted,
        CreatedBy
      )
      VALUES
      (
        $1,
        $2,
        $3,
        TRUE,
        FALSE,
        $4
      )
      ON CONFLICT (UserID, ProductID)
      DO NOTHING;
      `,
          [UserProductMapID, UserID, ProductID, ModifiedBy || null],
        );
      }
    }
    // ========================================================
    // COMMIT
    // ========================================================

    await client.query("COMMIT");

    return {
      success: true,

      message: "User Updated Successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.log("Update User Error :", error.message);

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    // Duplicate
    if (error.code === "23505") {
      return {
        success: false,

        message: "Username, Employee Code, Email or Mapping already exists",
      };
    }

    // Foreign Key
    if (error.code === "23503") {
      return {
        success: false,

        message: "Invalid Brand, Organization or Product",
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
// ============================================================UPDATE USER PERSONAL DETAILS
const updateUserPersonalDetails = async (data) => {
  try {
    // console.log("SERVICE DATA:", data);

    const {
      UserID,
      EmployeeCode,
      Username,
      FullName,
      Designation,
      Department,
      Division,
      LoginType,
      UserType,
      Email,
      PhoneNumber,
      Gender,
      ProfilePhoto,
      DateOfJoining,
      IsLocked,
      IsActive,
      ModifiedBy,
    } = data;

    // ========================================================
    // Validate UserID
    // ========================================================

    if (!UserID) {
      return {
        success: false,
        message: "UserID is required",
      };
    }

    // ========================================================
    // Check User
    // ========================================================

    const userCheck = await pool.query(
      `
      SELECT userid
      FROM user_master
      WHERE userid = $1
        AND isdeleted = FALSE
      LIMIT 1;
      `,
      [UserID]
    );

    if (userCheck.rows.length === 0) {
      return {
        success: false,
        message: "User not found",
      };
    }

    // ========================================================
    // Dynamic Update
    // Only fields which are provided will be updated
    // ========================================================

    const fields = [];
    const values = [];

    const addField = (column, value) => {
      if (value !== undefined) {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      }
    };

    addField("employeecode", EmployeeCode);
    addField("username", Username);
    addField("fullname", FullName);
    addField("designation", Designation);
    addField("department", Department);
    addField("division", Division);
    addField("logintype", LoginType);
    addField("usertype", UserType);
    addField("email", Email);
    addField("phonenumber", PhoneNumber);
    addField("gender", Gender);
    addField("profilephoto", ProfilePhoto);
    addField("dateofjoining", DateOfJoining);
    addField("islocked", IsLocked);
    addField("isactive", IsActive);

    // ========================================================
    // No fields
    // ========================================================

    if (fields.length === 0) {
      return {
        success: false,
        message: "No fields provided for update",
      };
    }

    // ========================================================
    // Modified By
    // ========================================================

    values.push(ModifiedBy || UserID);

    fields.push(
      `modifiedby = $${values.length}`
    );

    fields.push(
      `modifieddate = CURRENT_TIMESTAMP`
    );

    // ========================================================
    // UserID
    // ========================================================

    values.push(UserID);

    const userIdParameter = values.length;

    // ========================================================
    // Update
    // ========================================================

    const query = `
      UPDATE user_master

      SET
        ${fields.join(", ")}

      WHERE userid = $${userIdParameter}
        AND isdeleted = FALSE

      RETURNING
        userid AS "UserID",
        employeecode AS "EmployeeCode",
        username AS "Username",
        fullname AS "FullName",

        designation AS "Designation",
        department AS "Department",
        division AS "Division",

        logintype AS "LoginType",
        usertype AS "UserType",

        email AS "Email",
        phonenumber AS "PhoneNumber",
        gender AS "Gender",

        profilephoto AS "ProfilePhoto",

        dateofjoining AS "DateOfJoining",

        islocked AS "IsLocked",
        isactive AS "IsActive",

        modifiedby AS "ModifiedBy",
        modifieddate AS "ModifiedDate";
    `;

    console.log("UPDATE QUERY:", query);
    console.log("UPDATE VALUES:", values);

    const result = await pool.query(
      query,
      values
    );

    // ========================================================
    // Response
    // ========================================================

    return {
      success: true,

      message:
        "User personal details updated successfully",

    };

  } catch (error) {

    console.log(
      "Update User Personal Details Error:",
      error.message
    );

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    // ========================================================
    // Duplicate
    // ========================================================

    if (error.code === "23505") {

      return {
        success: false,

        message:
          "Username, Employee Code or Email already exists",
      };
    }

    return {
      success: false,
      message: error.message,
    };
  }
};
// ============================================================UPDATE USER ORGANIZATIONS
const updateUserOrganizations = async (
  UserID,
  Organizations,
  ModifiedBy
) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    // ========================================================
    // Check User
    // ========================================================

    const userCheck = await client.query(
      `
      SELECT UserID
      FROM user_master
      WHERE UserID = $1
        AND IsDeleted = FALSE
      LIMIT 1;
      `,
      [UserID]
    );

    if (userCheck.rows.length === 0) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User not found",
      };
    }

    // ========================================================
    // Validate Organizations
    // ========================================================

    if (!Array.isArray(Organizations)) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "Organizations must be an array",
      };
    }

    // ========================================================
    // Deactivate Existing Organizations
    // ========================================================

    await client.query(
      `
      UPDATE user_org_mapping
      SET
        IsActive = FALSE,
        IsDeleted = TRUE,

        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE;
      `,
      [
        ModifiedBy || UserID,
        UserID,
      ]
    );

    // ========================================================
    // Insert / Reactivate Organizations
    // ========================================================

    for (const organization of Organizations) {

      const {
        BrandID,
        OrganizationID,
      } = organization;

      if (!BrandID || !OrganizationID) {

        throw new Error(
          "BrandID and OrganizationID are required"
        );
      }

      // ======================================================
      // Check Existing Mapping
      // ======================================================

      const duplicateCheck = await client.query(
        `
        SELECT UserOrgMapID
        FROM user_org_mapping

        WHERE UserID = $1
          AND BrandID = $2
          AND OrganizationID = $3

        LIMIT 1;
        `,
        [
          UserID,
          BrandID,
          OrganizationID,
        ]
      );

      // ======================================================
      // Reactivate Existing Mapping
      // ======================================================

      if (duplicateCheck.rows.length > 0) {

        await client.query(
          `
          UPDATE user_org_mapping
          SET

            IsActive = TRUE,
            IsDeleted = FALSE,

            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP,

            DeletedBy = NULL,
            DeletedDate = NULL

          WHERE UserOrgMapID = $2;
          `,
          [
            ModifiedBy || UserID,
            duplicateCheck.rows[0].userorgmapid,
          ]
        );

        continue;
      }

      // ======================================================
      // Generate Mapping ID
      // ======================================================

      const idResult = await client.query(
        `
        SELECT
          COALESCE(MAX(UserOrgMapID), 0) + 1
          AS UserOrgMapID

        FROM user_org_mapping;
        `
      );

      const UserOrgMapID =
        Number(
          idResult.rows[0].userorgmapid
        );

      // ======================================================
      // Insert
      // ======================================================

      await client.query(
        `
        INSERT INTO user_org_mapping
        (
          UserOrgMapID,
          UserID,
          BrandID,
          OrganizationID,

          IsActive,
          IsDeleted,

          CreatedBy
        )

        VALUES
        (
          $1,
          $2,
          $3,
          $4,

          TRUE,
          FALSE,

          $5
        );
        `,
        [
          UserOrgMapID,
          UserID,
          BrandID,
          OrganizationID,
          ModifiedBy || UserID,
        ]
      );
    }

    // ========================================================
    // Commit
    // ========================================================

    await client.query("COMMIT");

    return {
      success: true,
      message: "User organizations updated successfully",
    };

  } catch (error) {

    await client.query("ROLLBACK");

    console.log(
      "Update User Organizations Error:",
      error.message
    );

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23505") {

      return {
        success: false,
        message:
          "Duplicate organization mapping already exists",
      };
    }

    if (error.code === "23503") {

      return {
        success: false,
        message:
          "Invalid User, Brand or Organization",
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
// ============================================================UPDATE USER PRODUCTS
const updateUserProducts = async (
  UserID,
  Products,
  ModifiedBy
) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    // ========================================================
    // Check User
    // ========================================================

    const userCheck = await client.query(
      `
      SELECT UserID
      FROM user_master
      WHERE UserID = $1
        AND IsDeleted = FALSE
      LIMIT 1;
      `,
      [UserID]
    );

    if (userCheck.rows.length === 0) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User not found",
      };
    }

    // ========================================================
    // Validate Products
    // ========================================================

    if (!Array.isArray(Products)) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "Products must be an array",
      };
    }

    // ========================================================
    // Remove Existing Active Mappings
    // ========================================================

    await client.query(
      `
      UPDATE user_product_mapping
      SET
        IsActive = FALSE,
        IsDeleted = TRUE,
        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP,
        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP
      WHERE UserID = $2
        AND IsDeleted = FALSE;
      `,
      [
        ModifiedBy || UserID,
        UserID,
      ]
    );

    // ========================================================
    // Insert / Reactivate Products
    // ========================================================

    for (const product of Products) {

      const ProductID = product.ProductID;

      if (!ProductID) {
        throw new Error("ProductID is required");
      }

      // ======================================================
      // Check Existing Mapping
      // ======================================================

      const existingMapping = await client.query(
        `
        SELECT UserProductMapID
        FROM user_product_mapping
        WHERE UserID = $1
          AND ProductID = $2
        LIMIT 1;
        `,
        [
          UserID,
          ProductID,
        ]
      );

      // ======================================================
      // Reactivate Existing
      // ======================================================

      if (existingMapping.rows.length > 0) {

        await client.query(
          `
          UPDATE user_product_mapping
          SET
            IsActive = TRUE,
            IsDeleted = FALSE,
            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP,
            DeletedBy = NULL,
            DeletedDate = NULL
          WHERE UserProductMapID = $2;
          `,
          [
            ModifiedBy || UserID,
            existingMapping.rows[0].userproductmapid,
          ]
        );

      } else {

        // ====================================================
        // Generate Mapping ID
        // ====================================================

        const idResult = await client.query(
          `
          SELECT
            COALESCE(MAX(UserProductMapID), 0) + 1
            AS UserProductMapID
          FROM user_product_mapping;
          `
        );

        const UserProductMapID = Number(
          idResult.rows[0].userproductmapid
        );

        // ====================================================
        // Insert
        // ====================================================

        await client.query(
          `
          INSERT INTO user_product_mapping
          (
            UserProductMapID,
            UserID,
            ProductID,
            IsActive,
            IsDeleted,
            CreatedBy
          )
          VALUES
          (
            $1,
            $2,
            $3,
            TRUE,
            FALSE,
            $4
          );
          `,
          [
            UserProductMapID,
            UserID,
            ProductID,
            ModifiedBy || UserID,
          ]
        );
      }
    }

    // ========================================================
    // Commit
    // ========================================================

    await client.query("COMMIT");

    return {
      success: true,
      message: "User products updated successfully",
    };

  } catch (error) {

    await client.query("ROLLBACK");

    console.log(
      "Update User Products Error:",
      error.message
    );

    const retryResponse = retryableDatabaseResponse(error);
    if (retryResponse) return retryResponse;

    if (error.code === "23505") {
      return {
        success: false,
        message: "Duplicate product mapping already exists",
      };
    }

    if (error.code === "23503") {
      return {
        success: false,
        message: "Invalid User or Product",
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

// ============================================================
// EXPORT
// ============================================================
module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserDropdown,
  getUserOrganizations,
  getUserProducts,
  getUserPersonalDetails,
  getAllUsersTabel,
  updateUserPersonalDetails,
  updateUserOrganizations,
  updateUserProducts,
};
