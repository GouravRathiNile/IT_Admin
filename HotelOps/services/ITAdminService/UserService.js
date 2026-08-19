const { pool } = require("../../db");
const generateUrl = require("../../AzurConfigration/ITAdmin/UserMaster/AzureGetData");
const { formatDate } = require("../../utils/dateFormatter");
const bcrypt = require("bcrypt");
const { retryableDatabaseResponse } = require("../../utils/retryableDatabaseError");

// ============================================================
// CREATE USER
// ============================================================
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
      DepartmentID,
      DivisionID,

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

      BrandID,

      AllOrganizationAccess,

      Organizations,
      Products,

    } = data;


    // ========================================================
    // 1. GENERATE USER ID
    // ========================================================

    const userIdResult = await client.query(`
      SELECT
        COALESCE(MAX(UserID), 0) + 1 AS UserID
      FROM user_master;
    `);

    const UserID =
      Number(userIdResult.rows[0].userid);


    // ========================================================
    // 2. HASH PASSWORD
    // ========================================================

    const hashedPassword =
      await bcrypt.hash(
        PasswordHash,
        10
      );


    // ========================================================
    // 3. VALIDATE DEPARTMENT + DIVISION
    // ========================================================

    const departmentCheck =
      await client.query(
        `
        SELECT

          DepartmentID,
          DepartmentName,
          OrganizationID,
          DivisionID

        FROM Department_Master

        WHERE DepartmentID = $1
          AND DivisionID = $2
          AND IsDeleted = FALSE

        LIMIT 1;
        `,
        [
          DepartmentID,
          DivisionID
        ]
      );


    if (departmentCheck.rows.length === 0) {

      throw new Error(
        "Invalid DepartmentID or Department does not belong to selected Division"
      );

    }


    // ========================================================
    // IMPORTANT
    //
    // Product is NOT restricted by Department.
    //
    // A user from any department can be assigned
    // any active product.
    //
    // ProductID validation against department is NOT done here.
    // ========================================================


    // ========================================================
    // 4. INSERT USER
    // ========================================================

    const userResult =
      await client.query(
        `
        INSERT INTO user_master
        (
          UserID,

          EmployeeCode,
          Username,
          PasswordHash,
          FullName,

          Designation,
          DepartmentID,
          DivisionID,

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

          CreatedBy,

          AllOrganizationAccess
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

          $21,

          $22
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

          DepartmentID || null,
          DivisionID || null,

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

          AllOrganizationAccess ?? false,

        ]
      );


    // ========================================================
    // BRAND MAPPING ID
    // ========================================================

    let userBrandMapID = null;


    // ========================================================
    // 5. SUPER ADMIN
    // ========================================================

    if (LoginType === "SuperAdmin") {


      // ------------------------------------------------------
      // ALL ORGANIZATIONS
      // ------------------------------------------------------

      if (AllOrganizationAccess === true) {

        // No organization mapping required.

      }


      // ------------------------------------------------------
      // SELECTED ORGANIZATIONS
      // ------------------------------------------------------

      else {

        if (
          !Array.isArray(Organizations) ||
          Organizations.length === 0
        ) {

          throw new Error(
            "Organization is required for limited SuperAdmin"
          );

        }


        for (const organization of Organizations) {

          const {
            OrganizationID
          } = organization;


          if (!OrganizationID) {

            throw new Error(
              "OrganizationID is required"
            );

          }


          // --------------------------------------------------
          // Validate Organization
          // --------------------------------------------------

          const organizationCheck =
            await client.query(
              `
              SELECT
                OrganizationID

              FROM Organization_Master

              WHERE OrganizationID = $1
                AND IsDeleted = FALSE
                AND IsActive = TRUE;
              `,
              [
                OrganizationID
              ]
            );


          if (
            organizationCheck.rows.length === 0
          ) {

            throw new Error(
              `Invalid OrganizationID: ${OrganizationID}`
            );

          }


          // --------------------------------------------------
          // Insert Organization Mapping
          // --------------------------------------------------

          await client.query(
            `
            INSERT INTO user_org_mapping
            (
              UserID,
              UserBrandMapID,
              OrganizationID,

              IsActive,
              IsDeleted,

              CreatedBy
            )

            VALUES
            (
              $1,
              NULL,
              $2,

              TRUE,
              FALSE,

              $3
            );
            `,
            [
              UserID,
              OrganizationID,
              CreatedBy || null
            ]
          );

        }

      }

    }


    // ========================================================
    // 6. BRAND USER
    // ========================================================

    if (LoginType === "Brand") {


      // ------------------------------------------------------
      // Validate Brand
      // ------------------------------------------------------

      const brandCheck =
        await client.query(
          `
          SELECT
            BrandID

          FROM Brand_Master

          WHERE BrandID = $1
            AND IsDeleted = FALSE
            AND IsActive = TRUE;
          `,
          [
            BrandID
          ]
        );


      if (brandCheck.rows.length === 0) {

        throw new Error(
          "Invalid or inactive Brand"
        );

      }


      // ------------------------------------------------------
      // Create Brand Mapping
      // ------------------------------------------------------

      const brandMappingResult =
        await client.query(
          `
          INSERT INTO user_brand_mapping
          (
            UserID,
            BrandID,
            Username,

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

          RETURNING UserBrandMapID;
          `,
          [
            UserID,
            BrandID,
            Username,
            CreatedBy || null
          ]
        );


      userBrandMapID =
        brandMappingResult
          .rows[0]
          .userbrandmapid;

    }


    // ========================================================
    // 7. ORGANIZATION MAPPING
    // ========================================================

    if (
      LoginType === "Organization" ||
      LoginType === "Brand"
    ) {


      if (
        !Array.isArray(Organizations) ||
        Organizations.length === 0
      ) {

        throw new Error(
          "Organization is required"
        );

      }


      for (
        const organization
        of Organizations
      ) {


        const {
          OrganizationID
        } = organization;


        if (!OrganizationID) {

          throw new Error(
            "OrganizationID is required"
          );

        }


        // ----------------------------------------------------
        // Validate Organization
        // ----------------------------------------------------

        const organizationCheck =
          await client.query(
            `
            SELECT

              OrganizationID,
              BrandID,
              OrganizationName

            FROM Organization_Master

            WHERE OrganizationID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE;
            `,
            [
              OrganizationID
            ]
          );


        if (
          organizationCheck.rows.length === 0
        ) {

          throw new Error(
            `Invalid or inactive OrganizationID: ${OrganizationID}`
          );

        }


        const organizationData =
          organizationCheck.rows[0];


        // ----------------------------------------------------
        // BRAND USER
        // ----------------------------------------------------

        if (
          LoginType === "Brand"
        ) {

          if (
            Number(organizationData.brandid) !==
            Number(BrandID)
          ) {

            throw new Error(
              `Organization ${OrganizationID} does not belong to selected Brand`
            );

          }

        }


        // ----------------------------------------------------
        // ORGANIZATION USER
        // ----------------------------------------------------

        if (
          LoginType === "Organization"
        ) {

          // Organization itself determines Brand.

          userBrandMapID = null;

        }


        // ----------------------------------------------------
        // Insert Organization Mapping
        // ----------------------------------------------------

        await client.query(
          `
          INSERT INTO user_org_mapping
          (
            UserID,
            UserBrandMapID,
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

            TRUE,
            FALSE,

            $4
          );
          `,
          [
            UserID,
            userBrandMapID,
            OrganizationID,
            CreatedBy || null
          ]
        );

      }

    }


    // ========================================================
    // 8. PRODUCT MAPPING
    // ========================================================
    //
    // IMPORTANT:
    // Product is NOT department restricted.
    //
    // Example:
    // Front Office user
    // can have Housekeeping product.
    //
    // Only the selected ProductID is stored.
    // ========================================================

    if (
      Array.isArray(Products) &&
      Products.length > 0
    ) {


      for (
        const product
        of Products
      ) {


        const {
          ProductID
        } = product;


        if (!ProductID) {

          throw new Error(
            "ProductID is required"
          );

        }


        // ----------------------------------------------------
        // Generate UserProductMapID
        // ----------------------------------------------------

        const mappingIdResult =
          await client.query(
            `
            SELECT
              COALESCE(
                MAX(UserProductMapID),
                0
              ) + 1
              AS UserProductMapID

            FROM user_product_mapping;
            `
          );


        const UserProductMapID =
          Number(
            mappingIdResult
              .rows[0]
              .userproductmapid
          );


        // ----------------------------------------------------
        // Insert Product Mapping
        // ----------------------------------------------------

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

            CreatedBy || null
          ]
        );

      }

    }


    // ========================================================
    // 9. COMMIT
    // ========================================================

    await client.query("COMMIT");


    // ========================================================
    // RESPONSE
    // ========================================================

    return {

      success: true,

      message:
        "User Created Successfully",

      data: {

        UserID:
          userResult.rows[0].userid,

      },

    };


  } catch (error) {


    // ========================================================
    // ROLLBACK
    // ========================================================

    await client.query(
      "ROLLBACK"
    );


    console.log(
      "Create User Error :",
      error.message
    );


    // ========================================================
    // RETRYABLE DATABASE ERROR
    // ========================================================

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {

      return retryResponse;

    }


    // ========================================================
    // DUPLICATE
    // ========================================================

    if (
      error.code === "23505"
    ) {

      return {

        success: false,

        message:
          "Username, or Employee Code already exists",

      };

    }


    // ========================================================
    // FOREIGN KEY
    // ========================================================

    if (
      error.code === "23503"
    ) {

      return {

        success: false,

        message:
          "Invalid Brand, Organization or Product",

      };

    }


    // ========================================================
    // NOT NULL
    // ========================================================

    if (
      error.code === "23502"
    ) {

      console.log(
        "NOT NULL ERROR DETAIL:",
        {
          message: error.message,
          column: error.column,
          table: error.table,
          detail: error.detail,
          code: error.code
        }
      );


      return {

        success: false,

        message:
          error.message,

        column:
          error.column,

        table:
          error.table,

        detail:
          error.detail

      };

    }


    // ========================================================
    // DEFAULT ERROR
    // ========================================================

    return {

      success: false,

      message:
        error.message,

    };

  } finally {

    client.release();

  }

};
// ============================================================
// DELETE USER
// ============================================================
const deleteUser = async (data) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const {
      UserID,
      DeletedBy
    } = data;


    // ========================================================
    // 1. SOFT DELETE USER
    // ========================================================

    const userResult = await client.query(
      `
      UPDATE user_master

      SET

        IsDeleted = TRUE,
        IsActive = FALSE,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,

        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE

      RETURNING UserID;
      `,
      [
        DeletedBy,
        UserID
      ]
    );


    if (userResult.rows.length === 0) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User Not Found",
      };

    }


    // ========================================================
    // 2. SOFT DELETE USER BRAND MAPPING
    // ========================================================

    await client.query(
      `
      UPDATE user_brand_mapping

      SET

        IsDeleted = TRUE,
        IsActive = FALSE,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,

        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE;
      `,
      [
        DeletedBy,
        UserID
      ]
    );


    // ========================================================
    // 3. SOFT DELETE USER ORGANIZATION MAPPING
    // ========================================================

    await client.query(
      `
      UPDATE user_org_mapping

      SET

        IsDeleted = TRUE,
        IsActive = FALSE,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,

        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE;
      `,
      [
        DeletedBy,
        UserID
      ]
    );


    // ========================================================
    // 4. SOFT DELETE USER PRODUCT MAPPING
    // ========================================================

    await client.query(
      `
      UPDATE user_product_mapping

      SET

        IsDeleted = TRUE,
        IsActive = FALSE,

        DeletedBy = $1,
        DeletedDate = CURRENT_TIMESTAMP,

        ModifiedBy = $1,
        ModifiedDate = CURRENT_TIMESTAMP

      WHERE UserID = $2
        AND IsDeleted = FALSE;
      `,
      [
        DeletedBy,
        UserID
      ]
    );


    // ========================================================
    // 5. COMMIT
    // ========================================================

    await client.query("COMMIT");


    return {

      success: true,

      message:
        "User Deleted Successfully",

    };


  } catch (error) {

    await client.query("ROLLBACK");

    console.log(
      "Delete User Error:",
      error.message
    );


    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }


    // ========================================================
    // FOREIGN KEY
    // ========================================================

    if (error.code === "23503") {

      return {

        success: false,

        message:
          "Unable to delete user because related records exist",

      };

    }


    return {

      success: false,

      message:
        error.message,

    };


  } finally {

    client.release();

  }

};
// ============================================================
// GET ALL USERS
// ============================================================

const getAllUsers = async (page = 1, limit = 10) => {

  try {

    // ========================================================
    // PAGINATION
    // ========================================================

    page = Number(page) || 1;
    limit = Number(limit) || 10;

    if (page < 1) {
      page = 1;
    }

    if (limit < 1) {
      limit = 10;
    }

    const offset = (page - 1) * limit;


    // ========================================================
    // GET USERS
    // ========================================================

    const query = `
      SELECT

        um.UserID,
        um.EmployeeCode,
        um.Username,
        um.FullName,

        um.Designation,

        um.DepartmentID,
        dm.DepartmentName,

        um.DivisionID,
        dv.DivisionName,

        um.LoginType,
        um.UserType,

        um.AllOrganizationAccess,

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

      LEFT JOIN Department_Master dm
        ON um.DepartmentID = dm.DepartmentID

      LEFT JOIN Division_Master dv
        ON um.DivisionID = dv.DivisionID

      WHERE um.IsDeleted = FALSE

      ORDER BY um.FullName ASC

      LIMIT $1
      OFFSET $2;
    `;


    // ========================================================
    // TOTAL USER COUNT
    // ========================================================

    const countQuery = `
      SELECT
        COUNT(*) AS TotalCount

      FROM user_master

      WHERE IsDeleted = FALSE;
    `;


    // ========================================================
    // EXECUTE USER + COUNT QUERY
    // ========================================================

    const [result, countResult] = await Promise.all([

      pool.query(
        query,
        [
          limit,
          offset
        ]
      ),

      pool.query(countQuery),

    ]);


    const totalCount =
      Number(
        countResult.rows[0].totalcount
      );


    const users = [];


    // ========================================================
    // LOOP USERS
    // ========================================================

    for (const row of result.rows) {


      // ======================================================
      // ORGANIZATION MAPPING
      // ======================================================

      let organizationResult;


      // ======================================================
      // SUPER ADMIN - ALL ORGANIZATION ACCESS
      // ======================================================

      if (
        row.logintype === "SuperAdmin" &&
        row.allorganizationaccess === true
      ) {

        organizationResult = await pool.query(
          `
          SELECT

            $1::BIGINT AS UserID,

            NULL::BIGINT AS UserOrgMapID,

            NULL::BIGINT AS UserBrandMapID,

            om.BrandID,
            bm.BrandName,

            om.OrganizationID,
            om.OrganizationName,
            om.ShortName

          FROM Organization_Master om

          LEFT JOIN Brand_Master bm
            ON om.BrandID = bm.BrandID

          WHERE om.IsDeleted = FALSE
            AND om.IsActive = TRUE

          ORDER BY om.OrganizationName ASC;
          `,
          [
            row.userid
          ]
        );


      } else {


        // ====================================================
        // LIMITED ACCESS
        // SUPER ADMIN / ORGANIZATION / BRAND
        // ====================================================

        organizationResult = await pool.query(
          `
          SELECT

            uom.UserID,

            uom.UserOrgMapID,
            uom.UserBrandMapID,

            om.BrandID,
            bm.BrandName,

            uom.OrganizationID,
            om.OrganizationName,
            om.ShortName

          FROM user_org_mapping uom

          LEFT JOIN Organization_Master om
            ON uom.OrganizationID = om.OrganizationID

          LEFT JOIN Brand_Master bm
            ON om.BrandID = bm.BrandID

          WHERE uom.UserID = $1

            AND uom.IsDeleted = FALSE
            AND uom.IsActive = TRUE

          ORDER BY om.OrganizationName ASC;
          `,
          [
            row.userid
          ]
        );

      }


      // ======================================================
      // PRODUCT MAPPING
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


      const productResult =
        await pool.query(
          productQuery,
          [
            row.userid
          ]
        );


      // ======================================================
      // USER OBJECT
      // ======================================================

      users.push({

        UserID:
          row.userid,

        EmployeeCode:
          row.employeecode,

        Username:
          row.username,

        FullName:
          row.fullname,


        Designation:
          row.designation,


        DepartmentID:
          row.departmentid,

        DepartmentName:
          row.departmentname,


        DivisionID:
          row.divisionid,

        DivisionName:
          row.divisionname,


        LoginType:
          row.logintype,

        UserType:
          row.usertype,


        AllOrganizationAccess:
          row.allorganizationaccess,


        Email:
          row.email,

        PhoneNumber:
          row.phonenumber,

        Gender:
          row.gender,


        ProfilePhoto:
          row.profilephoto
            ? generateUrl(row.profilephoto)
            : null,


        LastPasswordChangedDate:
          row.lastpasswordchangeddate
            ? formatDate(
              row.lastpasswordchangeddate
            )
            : null,


        PasswordExpiryDate:
          row.passwordexpirydate
            ? formatDate(
              row.passwordexpirydate
            )
            : null,


        LastLogin:
          row.lastlogin
            ? formatDate(
              row.lastlogin
            )
            : null,


        IsLocked:
          row.islocked,

        IsActive:
          row.isactive,


        DateOfJoining:
          row.dateofjoining
            ? formatDate(
              row.dateofjoining
            )
            : null,

        CreatedDate:
          row.createddate
            ? formatDate(
              row.createddate
            )
            : null,




        // ==================================================
        // ORGANIZATIONS
        // ==================================================

        Organizations:
          organizationResult.rows.map(
            (organization) => ({

              BrandID:
                organization.brandid,

              BrandName:
                organization.brandname,

              OrganizationID:
                organization.organizationid,

              OrganizationName:
                organization.organizationname,

            })
          ),


        // ==================================================
        // PRODUCTS
        // ==================================================

        Products:
          productResult.rows.map(
            (product) => ({

              ProductID:
                product.productid,

              ProductName:
                product.productname,

              ProductLabel:
                product.productlabel,

              ProductCategoryID:
                product.productcategoryid,

              CategoryName:
                product.categoryname,

            })
          ),

      });

    }


    // ========================================================
    // RESPONSE
    // ========================================================

    return {

      success: true,

      message:
        "Users fetched successfully",


      // Total records in DB
      TotalCount:
        totalCount,


      // Records returned in current page
      PageCount:
        users.length,


      // Current page
      CurrentPage:
        page,


      // Records per page
      PageSize:
        limit,


      // Total number of pages
      TotalPages:
        Math.ceil(
          totalCount / limit
        ),


      data:
        users,

    };


  } catch (error) {

    console.log(
      "Get All Users Error :",
      error.message
    );

    return {

      success: false,

      message:
        error.message,

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
    um.UserID,
    um.EmployeeCode,
    um.Username,
    um.FullName,

    um.Designation,

    um.DepartmentID,
    dm.DepartmentName,

    um.DivisionID,
    dv.DivisionName,

    um.LoginType,
    um.UserType,

    um.AllOrganizationAccess,

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

LEFT JOIN Department_Master dm
    ON um.DepartmentID = dm.DepartmentID

LEFT JOIN Division_Master dv
    ON um.DivisionID = dv.DivisionID

WHERE um.UserID = $1
  AND um.IsDeleted = FALSE;
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

    let organizationResult;

    if (
      user.logintype === "SuperAdmin" &&
      user.allorganizationaccess === true
    ) {

      // ====================================================
      // SUPER ADMIN - ALL ORGANIZATIONS
      // ====================================================

      organizationResult = await pool.query(
        `
    SELECT

      $1::BIGINT AS UserID,

      NULL::BIGINT AS UserOrgMapID,

      NULL::BIGINT AS UserBrandMapID,

      om.BrandID,
      bm.BrandName,

      om.OrganizationID,
      om.OrganizationName,
      om.ShortName

    FROM Organization_Master om

    LEFT JOIN Brand_Master bm
      ON om.BrandID = bm.BrandID

    WHERE om.IsDeleted = FALSE
      AND om.IsActive = TRUE

    ORDER BY om.OrganizationName ASC;
    `,
        [UserID]
      );

    } else {

      // ====================================================
      // LIMITED / ORGANIZATION / BRAND
      // ====================================================

      organizationResult = await pool.query(
        `
    SELECT

      uom.UserID,

      uom.UserOrgMapID,
      uom.UserBrandMapID,

      om.BrandID,
      bm.BrandName,

      uom.OrganizationID,
      om.OrganizationName,
      om.ShortName

    FROM user_org_mapping uom

    LEFT JOIN Organization_Master om
      ON uom.OrganizationID = om.OrganizationID

    LEFT JOIN Brand_Master bm
      ON om.BrandID = bm.BrandID

    WHERE uom.UserID = $1
      AND uom.IsDeleted = FALSE
      AND uom.IsActive = TRUE

    ORDER BY om.OrganizationName ASC;
    `,
        [UserID]
      );
    }

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

      DepartmentID: user.departmentid,
      DepartmentName: user.departmentname,

      DivisionID: user.divisionid,
      DivisionName: user.divisionname,

      LoginType: user.logintype,
      UserType: user.usertype,

      AllOrganizationAccess: user.allorganizationaccess,

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

      CreatedDate: formatDate(user.createddate),

      // ======================================================
      // Organizations
      // ======================================================

      Organizations: organizationResult.rows.map((organization) => ({

        BrandID: organization.brandid,
        BrandName: organization.brandname,

        OrganizationID: organization.organizationid,
        OrganizationName: organization.organizationname,
      })),

      // ======================================================
      // Products
      // ======================================================

      Products: productResult.rows.map((product) => ({

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
// ============================================================ GET USER DROPDOWN
// Filters:
// OrganizationID
// Username
// FullName
// ============================================================

const getUserDropdown = async (
  OrganizationID,
  Username,
  FullName
) => {

  try {

    // ========================================================
    // FILTERS
    // ========================================================

    const filters = [
      `um.IsDeleted = FALSE`,
      `um.IsActive = TRUE`
    ];

    const filterValues = [];


    // ========================================================
    // ORGANIZATION FILTER
    // ========================================================

    if (
      OrganizationID !== undefined &&
      OrganizationID !== null &&
      String(OrganizationID).trim() !== ""
    ) {

      filterValues.push(
        Number(OrganizationID)
      );

      filters.push(
        `EXISTS (
          SELECT 1
          FROM user_org_mapping uom
          WHERE uom.UserID = um.UserID
            AND uom.OrganizationID = $${filterValues.length}
            AND uom.IsDeleted = FALSE
            AND uom.IsActive = TRUE
        )`
      );

    }


    // ========================================================
    // USERNAME FILTER
    // Partial Search
    // ========================================================

    if (
      Username !== undefined &&
      Username !== null &&
      String(Username).trim() !== ""
    ) {

      filterValues.push(
        `%${String(Username).trim()}%`
      );

      filters.push(
        `um.Username ILIKE $${filterValues.length}`
      );

    }


    // ========================================================
    // FULL NAME FILTER
    // Partial Search
    // ========================================================

    if (
      FullName !== undefined &&
      FullName !== null &&
      String(FullName).trim() !== ""
    ) {

      filterValues.push(
        `%${String(FullName).trim()}%`
      );

      filters.push(
        `um.FullName ILIKE $${filterValues.length}`
      );

    }


    // ========================================================
    // WHERE CLAUSE
    // ========================================================

    const whereClause =
      filters.join(" AND ");


    // ========================================================
    // QUERY
    // ========================================================

    const query = `
      SELECT

        um.UserID,
        um.Username,
        um.FullName

      FROM user_master um

      WHERE ${whereClause}

      ORDER BY um.FullName ASC;
    `;


    // ========================================================
    // EXECUTE
    // ========================================================

    const result =
      await pool.query(
        query,
        filterValues
      );


    // ========================================================
    // RESPONSE DATA
    // ========================================================

    const users =
      result.rows.map((row) => ({

        UserID:
          row.userid,

        Username:
          row.username,

        FullName:
          row.fullname,

      }));


    // ========================================================
    // RESPONSE
    // ========================================================

    return {

      success: true,

      message:
        "Users fetched successfully",

      Count:
        users.length,

      data:
        users,

    };


  } catch (error) {

    console.log(
      "Get User Dropdown Error:",
      error.message
    );


    return {

      success: false,

      message:
        error.message,

    };

  }

};
// ============================================================User wise Organization
const getUserOrganizations = async (UserID) => {
  try {

    // ========================================================
    // 1. Get User Access Information
    // ========================================================

    const userResult = await pool.query(
      `
      SELECT
        UserID,
        LoginType,
        AllOrganizationAccess
      FROM user_master
      WHERE UserID = $1
        AND IsDeleted = FALSE
        AND IsActive = TRUE
      LIMIT 1;
      `,
      [UserID]
    );

    // ========================================================
    // User Not Found
    // ========================================================

    if (userResult.rows.length === 0) {
      return {
        success: false,
        message: "User not found",
      };
    }

    const user = userResult.rows[0];

    // ========================================================
    // 2. SUPER ADMIN - ALL ORGANIZATION ACCESS
    // ========================================================

    if (
      user.logintype === "SuperAdmin" &&
      user.allorganizationaccess === true
    ) {

      const result = await pool.query(
        `
        SELECT
          om.OrganizationID,
          om.OrganizationName,
          om.ShortName,

          om.BrandID,
          bm.BrandName

        FROM Organization_Master om

        LEFT JOIN Brand_Master bm
          ON om.BrandID = bm.BrandID

        WHERE om.IsDeleted = FALSE
          AND om.IsActive = TRUE

        ORDER BY
          om.OrganizationName ASC;
        `
      );

      return {
        success: true,

        message:
          "All organizations fetched successfully",

        Count: result.rows.length,

        data: result.rows.map((row) => ({
          UserID: user.userid,

          OrganizationID:
            row.organizationid,

          OrganizationName:
            row.organizationname,

          ShortName:
            row.shortname,

          BrandID:
            row.brandid,

          BrandName:
            row.brandname,
        })),
      };
    }

    // ========================================================
    // 3. LIMITED ACCESS
    // SuperAdmin + Organization + Brand
    // ========================================================

    const result = await pool.query(
      `
  SELECT

    uom.UserID,
    uom.UserOrgMapID,
    uom.UserBrandMapID,

    uom.OrganizationID,
    om.OrganizationName,
    om.ShortName,

    om.BrandID,
    bm.BrandName

  FROM user_org_mapping uom

  LEFT JOIN Organization_Master om
    ON uom.OrganizationID = om.OrganizationID

  LEFT JOIN Brand_Master bm
    ON om.BrandID = bm.BrandID

  WHERE uom.UserID = $1
    AND uom.IsActive = TRUE
    AND uom.IsDeleted = FALSE

  ORDER BY om.OrganizationName ASC;
  `,
      [UserID]
    );

    // ========================================================
    // 4. Response
    // ========================================================

    return {
      success: true,

      message:
        "User organizations fetched successfully",

      Count: result.rows.length,

      data: result.rows.map((row) => ({
        UserID:
          row.userid,

        UserOrgMapID:
          row.userorgmapid,

        UserBrandMapID:
          row.userbrandmapid,

        OrganizationID:
          row.organizationid,

        OrganizationName:
          row.organizationname,

        ShortName:
          row.shortname,

        BrandID:
          row.brandid,

        BrandName:
          row.brandname,
      })),
    };

  } catch (error) {

    console.log(
      "Get User Organizations Error:",
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
// ============================================================
// USER PERSONAL DETAILS
// ============================================================
const getUserPersonalDetails = async (UserID) => {

  try {

    const result = await pool.query(
      `
      SELECT

        um.UserID,

        um.EmployeeCode,
        um.Username,
        um.FullName,

        um.Designation,

        um.DepartmentID,
        dm.DepartmentName,

        um.DivisionID,
        dv.DivisionName,

        um.LoginType,
        um.UserType,
        um.AllOrganizationAccess,

        um.Email,
        um.PhoneNumber,
        um.Gender,

        um.ProfilePhoto,

        um.PasswordExpiryDate,
        um.DateOfJoining,

        um.IsLocked,
        um.IsActive

      FROM user_master um

      LEFT JOIN Department_Master dm
        ON um.DepartmentID = dm.DepartmentID

      LEFT JOIN Division_Master dv
        ON um.DivisionID = dv.DivisionID

      WHERE um.UserID = $1
        AND um.IsDeleted = FALSE

      LIMIT 1;
      `,
      [UserID]
    );


    // ========================================================
    // USER NOT FOUND
    // ========================================================

    if (result.rows.length === 0) {

      return {
        success: false,
        message: "User not found",
      };

    }


    const user = result.rows[0];


    // ========================================================
    // RESPONSE
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


        // ==================================================
        // DEPARTMENT
        // ==================================================

        DepartmentID:
          user.departmentid,

        DepartmentName:
          user.departmentname,


        // ==================================================
        // DIVISION
        // ==================================================

        DivisionID:
          user.divisionid,

        DivisionName:
          user.divisionname,


        // ==================================================
        // LOGIN / ACCESS
        // ==================================================

        LoginType:
          user.logintype,

        UserType:
          user.usertype,

        AllOrganizationAccess:
          user.allorganizationaccess,


        // ==================================================
        // CONTACT
        // ==================================================

        Email:
          user.email,

        PhoneNumber:
          user.phonenumber,

        Gender:
          user.gender,


        // ==================================================
        // PROFILE PHOTO
        // ==================================================

        ProfilePhoto:
          user.profilephoto
            ? generateUrl(user.profilephoto)
            : null,


        // ==================================================
        // OTHER
        // ==================================================

        PasswordExpiryDate:
          user.passwordexpirydate
            ? formatDate(user.passwordexpirydate)
            : null,

        DateOfJoining:
          user.dateofjoining
            ? formatDate(user.dateofjoining)
            : null,


        // ==================================================
        // STATUS
        // ==================================================

        IsLocked:
          user.islocked,

        IsActive:
          user.isactive,

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
// ============================================================
// GET ALL USERS TABLE
// Pagination + Filters
// ============================================================

const getAllUsersTabel = async (
  page = 1,
  limit = 10,
  FullName,
  DepartmentID,
  UserType
) => {

  try {

    // ========================================================
    // PAGINATION
    // ========================================================

    page = Number(page) || 1;
    limit = Number(limit) || 10;

    if (page < 1) {
      page = 1;
    }

    if (limit < 1) {
      limit = 10;
    }

    const offset = (page - 1) * limit;


    // ========================================================
    // FILTERS
    // ========================================================

    const filters = [
      `um.IsDeleted = FALSE`
    ];

    const filterValues = [];


    // ========================================================
    // FULL NAME FILTER
    // Partial Search
    // Example: Mohit -> Mohit Solanki
    // ========================================================

    if (
      FullName !== undefined &&
      FullName !== null &&
      String(FullName).trim() !== ""
    ) {

      filterValues.push(
        `%${String(FullName).trim()}%`
      );

      filters.push(
        `um.FullName ILIKE $${filterValues.length}`
      );

    }


    // ========================================================
    // DEPARTMENT ID FILTER
    // Exact Match
    // ========================================================

    if (
      DepartmentID !== undefined &&
      DepartmentID !== null &&
      String(DepartmentID).trim() !== ""
    ) {

      filterValues.push(
        Number(DepartmentID)
      );

      filters.push(
        `um.DepartmentID = $${filterValues.length}`
      );

    }


    // ========================================================
    // USER TYPE FILTER
    // Exact Match
    // ========================================================

    if (
      UserType !== undefined &&
      UserType !== null &&
      String(UserType).trim() !== ""
    ) {

      filterValues.push(
        String(UserType).trim()
      );

      filters.push(
        `um.UserType = $${filterValues.length}`
      );

    }


    // ========================================================
    // WHERE CLAUSE
    // ========================================================

    const whereClause =
      filters.join(" AND ");


    // ========================================================
    // PAGINATION PARAMETERS
    // ========================================================

    const limitParameter =
      filterValues.length + 1;

    const offsetParameter =
      filterValues.length + 2;


    // ========================================================
    // USER QUERY
    // ========================================================

    const query = `
      SELECT

        um.UserID,
        um.EmployeeCode,
        um.Username,
        um.FullName,

        um.Designation,

        um.DepartmentID,
        dm.DepartmentName,

        um.DivisionID,
        dv.DivisionName,

        um.LoginType,
        um.UserType,

        um.Email,
        um.PhoneNumber,
        um.Gender

      FROM user_master um

      LEFT JOIN Department_Master dm
        ON um.DepartmentID = dm.DepartmentID

      LEFT JOIN Division_Master dv
        ON um.DivisionID = dv.DivisionID

      WHERE ${whereClause}

      ORDER BY um.FullName ASC

      LIMIT $${limitParameter}
      OFFSET $${offsetParameter};
    `;


    // ========================================================
    // COUNT QUERY
    // IMPORTANT:
    // Same filters should be applied here
    // ========================================================

    const countQuery = `
      SELECT
        COUNT(*) AS TotalCount

      FROM user_master um

      WHERE ${whereClause};
    `;


    // ========================================================
    // EXECUTE BOTH QUERIES
    // ========================================================

    const [result, countResult] =
      await Promise.all([

        pool.query(
          query,
          [
            ...filterValues,
            limit,
            offset
          ]
        ),

        pool.query(
          countQuery,
          filterValues
        )

      ]);


    // ========================================================
    // TOTAL COUNT
    // ========================================================

    const totalCount =
      Number(
        countResult.rows[0].totalcount
      );


    // ========================================================
    // RESPONSE DATA
    // ========================================================

    const users =
      result.rows.map((row) => ({

        UserID:
          row.userid,

        EmployeeCode:
          row.employeecode,

        Username:
          row.username,

        FullName:
          row.fullname,

        Designation:
          row.designation,


        DepartmentID:
          row.departmentid,

        DepartmentName:
          row.departmentname,


        DivisionID:
          row.divisionid,

        DivisionName:
          row.divisionname,


        LoginType:
          row.logintype,

        UserType:
          row.usertype,


        Email:
          row.email,

        PhoneNumber:
          row.phonenumber,

        Gender:
          row.gender,

      }));


    // ========================================================
    // RESPONSE
    // ========================================================

    return {

      success: true,

      message:
        "Users fetched successfully",


      // Total records after applying filters
      TotalCount:
        totalCount,


      // Records returned on current page
      PageCount:
        users.length,


      // Current page
      CurrentPage:
        page,


      // Records per page
      PageSize:
        limit,


      // Total pages after applying filters
      TotalPages:
        Math.ceil(
          totalCount / limit
        ),


      data:
        users,

    };


  } catch (error) {

    console.log(
      "Get All Users Table Error:",
      error.message
    );


    return {

      success: false,

      message:
        error.message,

    };

  }

};
// // ============================================================UPDATE USER
// const updateUser = async (data) => {
//   const client = await pool.connect();

//   try {
//     await client.query("BEGIN");

//     const {
//       UserID,

//       EmployeeCode,
//       Username,
//       PasswordHash,
//       FullName,

//       Designation,
//       DepartmentID,
//       DivisionID,

//       LoginType,
//       UserType,

//       Email,
//       PhoneNumber,
//       Gender,

//       ProfilePhoto,

//       BrandID,
//       AllOrganizationAccess,

//       LastPasswordChangedDate,
//       PasswordExpiryDate,
//       DateOfJoining,

//       IsLocked,
//       IsActive,

//       ModifiedBy,

//       Organizations,
//       Products,
//     } = data;

//     // ========================================================
//     // 1. CHECK USER
//     // ========================================================

//     const userCheck = await client.query(
//       `
//       SELECT
//         UserID,
//         ProfilePhoto,
//         PasswordHash,
//         LoginType,
//         AllOrganizationAccess
//       FROM user_master
//       WHERE UserID = $1
//         AND IsDeleted = FALSE;
//       `,
//       [UserID]
//     );

//     if (userCheck.rows.length === 0) {
//       await client.query("ROLLBACK");

//       return {
//         success: false,
//         message: "User Not Found",
//       };
//     }

//     const existingUser = userCheck.rows[0];

//     const oldProfilePhoto = existingUser.profilephoto;

//     // ========================================================
//     // 2. PROFILE PHOTO
//     // ========================================================

//     const finalProfilePhoto =
//       ProfilePhoto !== undefined
//         ? ProfilePhoto
//         : oldProfilePhoto;

//     // ========================================================
//     // 3. PASSWORD
//     // ========================================================

//     let finalPasswordHash = existingUser.passwordhash;

//     if (
//       PasswordHash !== undefined &&
//       PasswordHash !== null &&
//       PasswordHash !== ""
//     ) {
//       finalPasswordHash = await bcrypt.hash(
//         PasswordHash,
//         10
//       );
//     }

//     // ========================================================
//     // 4. VALIDATE LOGIN TYPE
//     // ========================================================

//     if (
//       !["SuperAdmin", "Organization", "Brand"].includes(
//         LoginType
//       )
//     ) {
//       throw new Error(
//         "LoginType must be SuperAdmin, Organization or Brand"
//       );
//     }

//     // ========================================================
//     // 5. VALIDATE DEPARTMENT + DIVISION
//     // ========================================================

//     if (
//       DepartmentID !== undefined ||
//       DivisionID !== undefined
//     ) {

//       // Both are required if either one is being changed

//       if (
//         DepartmentID === undefined ||
//         DepartmentID === null ||
//         DivisionID === undefined ||
//         DivisionID === null
//       ) {

//         throw new Error(
//           "DepartmentID and DivisionID are required together"
//         );

//       }


//       // ======================================================
//       // Validate Department + Division
//       // ======================================================

//       const departmentCheck =
//         await client.query(
//           `
//       SELECT
//         DepartmentID,
//         DepartmentName,
//         DivisionID
//       FROM Department_Master
//       WHERE DepartmentID = $1
//         AND DivisionID = $2
//         AND IsDeleted = FALSE
//       LIMIT 1;
//       `,
//           [
//             DepartmentID,
//             DivisionID
//           ]
//         );


//       if (departmentCheck.rows.length === 0) {

//         throw new Error(
//           "Invalid DepartmentID or Department does not belong to selected Division"
//         );

//       }

//     }


//     // ========================================================
//     // 6. VALIDATE PRODUCTS
//     // Products can belong to ANY department
//     // ========================================================

//     if (
//       Array.isArray(Products) &&
//       Products.length > 0
//     ) {

//       for (const product of Products) {

//         const ProductID =
//           Number(product.ProductID);


//         if (!ProductID) {

//           throw new Error(
//             "ProductID is required"
//           );

//         }


//         // ====================================================
//         // Check Product Master
//         // ====================================================

//         const productCheck =
//           await client.query(
//             `
//         SELECT
//           ProductID
//         FROM Product_Master
//         WHERE ProductID = $1
//           AND IsDeleted = FALSE
//           AND IsActive = TRUE
//         LIMIT 1;
//         `,
//             [ProductID]
//           );


//         if (productCheck.rows.length === 0) {

//           throw new Error(
//             `Invalid or inactive ProductID: ${ProductID}`
//           );

//         }

//       }

//     }

//     // ========================================================
//     // 6. LOGIN TYPE SPECIFIC VALIDATION
//     // ========================================================

//     if (LoginType === "SuperAdmin") {

//       if (AllOrganizationAccess === true) {

//         // No organization mapping required.

//       } else {

//         if (
//           !Array.isArray(Organizations) ||
//           Organizations.length === 0
//         ) {
//           throw new Error(
//             "At least one organization is required for limited SuperAdmin"
//           );
//         }
//       }
//     }

//     // ========================================================
//     // ORGANIZATION LOGIN
//     // ========================================================

//     if (LoginType === "Organization") {

//       if (
//         !Array.isArray(Organizations) ||
//         Organizations.length !== 1
//       ) {
//         throw new Error(
//           "Organization user must have exactly one organization"
//         );
//       }

//       if (AllOrganizationAccess === true) {
//         throw new Error(
//           "AllOrganizationAccess is not allowed for Organization login"
//         );
//       }
//     }

//     // ========================================================
//     // BRAND LOGIN
//     // ========================================================

//     if (LoginType === "Brand") {

//       if (!BrandID) {
//         throw new Error(
//           "BrandID is required for Brand login"
//         );
//       }

//       if (
//         !Array.isArray(Organizations) ||
//         Organizations.length === 0
//       ) {
//         throw new Error(
//           "At least one organization is required for Brand login"
//         );
//       }

//       if (AllOrganizationAccess === true) {
//         throw new Error(
//           "AllOrganizationAccess is not allowed for Brand login"
//         );
//       }

//       // Validate Brand

//       const brandCheck = await client.query(
//         `
//         SELECT BrandID
//         FROM Brand_Master
//         WHERE BrandID = $1
//           AND IsDeleted = FALSE
//           AND IsActive = TRUE
//         LIMIT 1;
//         `,
//         [BrandID]
//       );

//       if (brandCheck.rows.length === 0) {
//         throw new Error(
//           "Invalid or inactive Brand"
//         );
//       }
//     }

//     // ========================================================
//     // 7. UPDATE USER MASTER
//     // ========================================================

//     const result = await client.query(
//       `
//       UPDATE user_master
//       SET

//         EmployeeCode = $1,
//         Username = $2,
//         PasswordHash = $3,
//         FullName = $4,

//         Designation = $5,
//         DepartmentID = $6,
//         DivisionID = $7,

//         LoginType = $8,
//         UserType = $9,

//         Email = $10,
//         PhoneNumber = $11,
//         Gender = $12,

//         ProfilePhoto = $13,
//         AllOrganizationAccess = $14,

//         LastPasswordChangedDate = $15,
//         PasswordExpiryDate = $16,

//         IsLocked = $17,
//         IsActive = $18,

//         DateOfJoining = $19,

//         ModifiedBy = $20,
//         ModifiedDate = CURRENT_TIMESTAMP

//       WHERE UserID = $21
//         AND IsDeleted = FALSE

//       RETURNING UserID;
//       `,
//       [
//         EmployeeCode,
//         Username,
//         finalPasswordHash,
//         FullName,

//         Designation || null,
//         DepartmentID || null,
//         DivisionID || null,

//         LoginType,
//         UserType || null,

//         Email || null,
//         PhoneNumber || null,
//         Gender || null,

//         finalProfilePhoto,

//         LoginType === "SuperAdmin"
//           ? (AllOrganizationAccess ?? false)
//           : false,

//         LastPasswordChangedDate || null,
//         PasswordExpiryDate || null,

//         IsLocked ?? false,
//         IsActive ?? true,

//         DateOfJoining || null,

//         ModifiedBy || null,

//         UserID,
//       ]
//     );

//     if (result.rows.length === 0) {
//       await client.query("ROLLBACK");

//       return {
//         success: false,
//         message: "User Not Found",
//       };
//     }

//     // ========================================================
//     // 8. REMOVE OLD ORGANIZATION MAPPINGS
//     // ========================================================

//     await client.query(
//       `
//       UPDATE user_org_mapping
//       SET
//         IsActive = FALSE,
//         IsDeleted = TRUE,

//         ModifiedBy = $1,
//         ModifiedDate = CURRENT_TIMESTAMP,

//         DeletedBy = $1,
//         DeletedDate = CURRENT_TIMESTAMP

//       WHERE UserID = $2
//         AND IsDeleted = FALSE;
//       `,
//       [
//         ModifiedBy || UserID,
//         UserID
//       ]
//     );

//     // ========================================================
//     // 9. REMOVE OLD BRAND MAPPING
//     // ========================================================

//     await client.query(
//       `
//       UPDATE user_brand_mapping
//       SET
//         IsActive = FALSE,
//         IsDeleted = TRUE,

//         ModifiedBy = $1,
//         ModifiedDate = CURRENT_TIMESTAMP,

//         DeletedBy = $1,
//         DeletedDate = CURRENT_TIMESTAMP

//       WHERE UserID = $2
//         AND IsDeleted = FALSE;
//       `,
//       [
//         ModifiedBy || UserID,
//         UserID
//       ]
//     );

//     // ========================================================
//     // 10. CREATE / REACTIVATE BRAND MAPPING
//     // ========================================================

//     let userBrandMapID = null;

//     if (LoginType === "Brand") {

//       // ======================================================
//       // Check existing mapping
//       // ======================================================

//       const existingBrandMapping =
//         await client.query(
//           `
//       SELECT
//         UserBrandMapID
//       FROM user_brand_mapping
//       WHERE UserID = $1
//         AND BrandID = $2
//       LIMIT 1;
//       `,
//           [
//             UserID,
//             BrandID
//           ]
//         );


//       // ======================================================
//       // Existing mapping -> Reactivate
//       // ======================================================

//       if (existingBrandMapping.rows.length > 0) {

//         userBrandMapID =
//           existingBrandMapping.rows[0].userbrandmapid;


//         await client.query(
//           `
//       UPDATE user_brand_mapping
//       SET

//         Username = $1,

//         IsActive = TRUE,
//         IsDeleted = FALSE,

//         ModifiedBy = $2,
//         ModifiedDate = CURRENT_TIMESTAMP,

//         DeletedBy = NULL,
//         DeletedDate = NULL

//       WHERE UserBrandMapID = $3;
//       `,
//           [
//             Username,
//             ModifiedBy || UserID,
//             userBrandMapID
//           ]
//         );


//       } else {

//         // ====================================================
//         // New mapping -> Insert
//         // ====================================================

//         const brandMappingResult =
//           await client.query(
//             `
//         INSERT INTO user_brand_mapping
//         (
//           UserID,
//           BrandID,
//           Username,
//           IsActive,
//           IsDeleted,
//           CreatedBy
//         )
//         VALUES
//         (
//           $1,
//           $2,
//           $3,
//           TRUE,
//           FALSE,
//           $4
//         )
//         RETURNING UserBrandMapID;
//         `,
//             [
//               UserID,
//               BrandID,
//               Username,
//               ModifiedBy || UserID
//             ]
//           );


//         userBrandMapID =
//           brandMappingResult.rows[0].userbrandmapid;

//       }

//     }

//     // ========================================================
//     // 11. ORGANIZATION MAPPING
//     // ========================================================

//     // --------------------------------------------------------
//     // SUPER ADMIN - ALL ORGANIZATIONS
//     // --------------------------------------------------------

//     if (
//       LoginType === "SuperAdmin" &&
//       AllOrganizationAccess === true
//     ) {

//       // No rows required in user_org_mapping.

//     }

//     // --------------------------------------------------------
//     // SUPER ADMIN - LIMITED ORGANIZATIONS
//     // --------------------------------------------------------

//     else if (
//       LoginType === "SuperAdmin" &&
//       AllOrganizationAccess === false
//     ) {

//       for (const organization of Organizations) {

//         const {
//           OrganizationID
//         } = organization;

//         if (!OrganizationID) {
//           throw new Error(
//             "OrganizationID is required"
//           );
//         }

//         // Validate Organization

//         const organizationCheck =
//           await client.query(
//             `
//             SELECT
//               OrganizationID
//             FROM Organization_Master
//             WHERE OrganizationID = $1
//               AND IsDeleted = FALSE
//               AND IsActive = TRUE
//             LIMIT 1;
//             `,
//             [OrganizationID]
//           );

//         if (organizationCheck.rows.length === 0) {
//           throw new Error(
//             `Invalid or inactive OrganizationID: ${OrganizationID}`
//           );
//         }

//         // Generate mapping ID

//         const mappingIdResult =
//           await client.query(
//             `
//             SELECT
//               COALESCE(MAX(UserOrgMapID), 0) + 1
//               AS UserOrgMapID
//             FROM user_org_mapping;
//             `
//           );

//         const UserOrgMapID =
//           Number(
//             mappingIdResult.rows[0].userorgmapid
//           );

//         // Insert

//         await client.query(
//           `
//           INSERT INTO user_org_mapping
//           (
//             UserOrgMapID,
//             UserID,
//             UserBrandMapID,
//             OrganizationID,
//             IsActive,
//             IsDeleted,
//             CreatedBy
//           )
//           VALUES
//           (
//             $1,
//             $2,
//             NULL,
//             $3,
//             TRUE,
//             FALSE,
//             $4
//           );
//           `,
//           [
//             UserOrgMapID,
//             UserID,
//             OrganizationID,
//             ModifiedBy || UserID
//           ]
//         );
//       }
//     }

//     // --------------------------------------------------------
//     // ORGANIZATION USER
//     // --------------------------------------------------------

//     else if (LoginType === "Organization") {

//       const organization =
//         Organizations[0];

//       const OrganizationID =
//         organization.OrganizationID;

//       if (!OrganizationID) {
//         throw new Error(
//           "OrganizationID is required"
//         );
//       }

//       // Validate Organization

//       const organizationCheck =
//         await client.query(
//           `
//           SELECT
//             OrganizationID
//           FROM Organization_Master
//           WHERE OrganizationID = $1
//             AND IsDeleted = FALSE
//             AND IsActive = TRUE
//           LIMIT 1;
//           `,
//           [OrganizationID]
//         );

//       if (organizationCheck.rows.length === 0) {
//         throw new Error(
//           `Invalid or inactive OrganizationID: ${OrganizationID}`
//         );
//       }

//       // Generate mapping ID

//       const mappingIdResult =
//         await client.query(
//           `
//           SELECT
//             COALESCE(MAX(UserOrgMapID), 0) + 1
//             AS UserOrgMapID
//           FROM user_org_mapping;
//           `
//         );

//       const UserOrgMapID =
//         Number(
//           mappingIdResult.rows[0].userorgmapid
//         );

//       // Insert

//       await client.query(
//         `
//         INSERT INTO user_org_mapping
//         (
//           UserOrgMapID,
//           UserID,
//           UserBrandMapID,
//           OrganizationID,
//           IsActive,
//           IsDeleted,
//           CreatedBy
//         )
//         VALUES
//         (
//           $1,
//           $2,
//           NULL,
//           $3,
//           TRUE,
//           FALSE,
//           $4
//         );
//         `,
//         [
//           UserOrgMapID,
//           UserID,
//           OrganizationID,
//           ModifiedBy || UserID
//         ]
//       );
//     }

//     // --------------------------------------------------------
//     // BRAND USER
//     // --------------------------------------------------------

//     else if (LoginType === "Brand") {

//       for (const organization of Organizations) {

//         const {
//           OrganizationID
//         } = organization;

//         if (!OrganizationID) {
//           throw new Error(
//             "OrganizationID is required"
//           );
//         }

//         // Validate Organization belongs to Brand

//         const organizationCheck =
//           await client.query(
//             `
//             SELECT
//               OrganizationID,
//               BrandID
//             FROM Organization_Master
//             WHERE OrganizationID = $1
//               AND IsDeleted = FALSE
//               AND IsActive = TRUE
//             LIMIT 1;
//             `,
//             [OrganizationID]
//           );

//         if (organizationCheck.rows.length === 0) {
//           throw new Error(
//             `Invalid or inactive OrganizationID: ${OrganizationID}`
//           );
//         }

//         const organizationData =
//           organizationCheck.rows[0];

//         if (
//           Number(organizationData.brandid) !==
//           Number(BrandID)
//         ) {
//           throw new Error(
//             `Organization ${OrganizationID} does not belong to selected Brand`
//           );
//         }

//         // Generate mapping ID

//         const mappingIdResult =
//           await client.query(
//             `
//             SELECT
//               COALESCE(MAX(UserOrgMapID), 0) + 1
//               AS UserOrgMapID
//             FROM user_org_mapping;
//             `
//           );

//         const UserOrgMapID =
//           Number(
//             mappingIdResult.rows[0].userorgmapid
//           );

//         // Insert

//         await client.query(
//           `
//           INSERT INTO user_org_mapping
//           (
//             UserOrgMapID,
//             UserID,
//             UserBrandMapID,
//             OrganizationID,
//             IsActive,
//             IsDeleted,
//             CreatedBy
//           )
//           VALUES
//           (
//             $1,
//             $2,
//             $3,
//             $4,
//             TRUE,
//             FALSE,
//             $5
//           );
//           `,
//           [
//             UserOrgMapID,
//             UserID,
//             userBrandMapID,
//             OrganizationID,
//             ModifiedBy || UserID
//           ]
//         );
//       }
//     }

//     // ========================================================
//     // 12. PRODUCT MAPPING
//     // ========================================================

//     // First deactivate existing mappings

//     await client.query(
//       `
//       UPDATE user_product_mapping
//       SET
//         IsActive = FALSE,
//         IsDeleted = TRUE,

//         ModifiedBy = $1,
//         ModifiedDate = CURRENT_TIMESTAMP,

//         DeletedBy = $1,
//         DeletedDate = CURRENT_TIMESTAMP

//       WHERE UserID = $2
//         AND IsDeleted = FALSE;
//       `,
//       [
//         ModifiedBy || UserID,
//         UserID
//       ]
//     );

//     // Insert selected products

//     if (
//       Array.isArray(Products) &&
//       Products.length > 0
//     ) {

//       for (const product of Products) {

//         const {
//           ProductID
//         } = product;

//         if (!ProductID) {
//           throw new Error(
//             "ProductID is required"
//           );
//         }

//         // Generate Product Mapping ID

//         const mappingIdResult =
//           await client.query(
//             `
//             SELECT
//               COALESCE(MAX(UserProductMapID), 0) + 1
//               AS UserProductMapID
//             FROM user_product_mapping;
//             `
//           );

//         const UserProductMapID =
//           Number(
//             mappingIdResult.rows[0].userproductmapid
//           );

//         await client.query(
//           `
//           INSERT INTO user_product_mapping
//           (
//             UserProductMapID,
//             UserID,
//             ProductID,
//             IsActive,
//             IsDeleted,
//             CreatedBy
//           )
//           VALUES
//           (
//             $1,
//             $2,
//             $3,
//             TRUE,
//             FALSE,
//             $4
//           );
//           `,
//           [
//             UserProductMapID,
//             UserID,
//             ProductID,
//             ModifiedBy || UserID
//           ]
//         );
//       }
//     }

//     // ========================================================
//     // 13. COMMIT
//     // ========================================================

//     await client.query("COMMIT");

//     return {
//       success: true,
//       message: "User Updated Successfully",
//     };

//   } catch (error) {

//     await client.query("ROLLBACK");

//     console.log(
//       "Update User Error :",
//       error.message
//     );

//     const retryResponse =
//       retryableDatabaseResponse(error);

//     if (retryResponse) {
//       return retryResponse;
//     }

//     // Duplicate

//     if (error.code === "23505") {

//       if (
//         error.constraint === "uq_userbrandmapping"
//       ) {
//         return {
//           success: false,
//           message:
//             "User is already mapped with this Brand",
//         };
//       }

//       return {
//         success: false,
//         message:
//           "Username or Employee Code already exists",
//       };
//     }

//     // Foreign Key

//     if (error.code === "23503") {
//       return {
//         success: false,
//         message:
//           "Invalid User, Brand, Organization, Department, Division or Product",
//       };
//     }

//     return {
//       success: false,
//       message: error.message,
//     };

//   } finally {

//     client.release();

//   }
// };

// ============================================================
// UPDATE USER
// ============================================================
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
      DepartmentID,
      DivisionID,

      LoginType,
      UserType,

      Email,
      PhoneNumber,
      Gender,

      ProfilePhoto,

      BrandID,
      AllOrganizationAccess,

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
    // 1. CHECK USER
    // ========================================================

    const userCheck = await client.query(
      `
      SELECT
        UserID,
        ProfilePhoto,
        PasswordHash,
        LoginType,
        AllOrganizationAccess
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
        message: "User Not Found",
      };

    }


    const existingUser = userCheck.rows[0];


    // ========================================================
    // 2. PROFILE PHOTO
    // ========================================================

    const finalProfilePhoto =
      ProfilePhoto !== undefined
        ? ProfilePhoto
        : existingUser.profilephoto;


    // ========================================================
    // 3. PASSWORD
    // ========================================================

    let finalPasswordHash =
      existingUser.passwordhash;


    if (
      PasswordHash !== undefined &&
      PasswordHash !== null &&
      PasswordHash !== ""
    ) {

      finalPasswordHash =
        await bcrypt.hash(
          PasswordHash,
          10
        );

    }


    // ========================================================
    // 4. LOGIN TYPE VALIDATION
    // ========================================================

    if (
      ![
        "SuperAdmin",
        "Organization",
        "Brand"
      ].includes(LoginType)
    ) {

      throw new Error(
        "LoginType must be SuperAdmin, Organization or Brand"
      );

    }


    // ========================================================
    // 5. DEPARTMENT + DIVISION VALIDATION
    // ========================================================

    if (
      DepartmentID !== undefined ||
      DivisionID !== undefined
    ) {

      if (
        DepartmentID === undefined ||
        DepartmentID === null ||
        DivisionID === undefined ||
        DivisionID === null
      ) {

        throw new Error(
          "DepartmentID and DivisionID are required together"
        );

      }


      const departmentCheck =
        await client.query(
          `
          SELECT
            DepartmentID,
            DepartmentName,
            DivisionID

          FROM Department_Master

          WHERE DepartmentID = $1
            AND DivisionID = $2
            AND IsDeleted = FALSE

          LIMIT 1;
          `,
          [
            DepartmentID,
            DivisionID
          ]
        );


      if (
        departmentCheck.rows.length === 0
      ) {

        throw new Error(
          "Invalid DepartmentID or Department does not belong to selected Division"
        );

      }

    }


    // ========================================================
    // 6. PRODUCT VALIDATION
    //
    // IMPORTANT:
    // Product is NOT restricted by Department.
    //
    // Example:
    // Front Office user can have
    // Housekeeping product.
    //
    // We only check that ProductID exists
    // and is active.
    // ========================================================

    if (Array.isArray(Products)) {

      for (const product of Products) {

        const ProductID =
          Number(product?.ProductID);


        if (!ProductID) {

          throw new Error(
            "ProductID is required for every product"
          );

        }


        const productCheck =
          await client.query(
            `
            SELECT
              ProductID

            FROM Product_Master

            WHERE ProductID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE

            LIMIT 1;
            `,
            [ProductID]
          );


        if (
          productCheck.rows.length === 0
        ) {

          throw new Error(
            `Invalid or inactive ProductID: ${ProductID}`
          );

        }

      }

    }


    // ========================================================
    // 7. SUPER ADMIN VALIDATION
    // ========================================================

    if (
      LoginType === "SuperAdmin"
    ) {

      // ------------------------------------------
      // ALL ORGANIZATION ACCESS
      // ------------------------------------------

      if (
        AllOrganizationAccess === true
      ) {

        // No organization mapping required.

      }

      // ------------------------------------------
      // LIMITED ORGANIZATION ACCESS
      // ------------------------------------------

      else {

        if (
          !Array.isArray(Organizations) ||
          Organizations.length === 0
        ) {

          throw new Error(
            "At least one organization is required for limited SuperAdmin"
          );

        }

      }

    }


    // ========================================================
    // 8. ORGANIZATION LOGIN
    // ========================================================

    if (
      LoginType === "Organization"
    ) {

      if (
        !Array.isArray(Organizations) ||
        Organizations.length !== 1
      ) {

        throw new Error(
          "Organization user must have exactly one organization"
        );

      }


      if (
        AllOrganizationAccess === true
      ) {

        throw new Error(
          "AllOrganizationAccess is not allowed for Organization login"
        );

      }

    }


    // ========================================================
    // 9. BRAND LOGIN
    // ========================================================

    if (
      LoginType === "Brand"
    ) {

      if (!BrandID) {

        throw new Error(
          "BrandID is required for Brand login"
        );

      }


      if (
        !Array.isArray(Organizations) ||
        Organizations.length === 0
      ) {

        throw new Error(
          "At least one organization is required for Brand login"
        );

      }


      if (
        AllOrganizationAccess === true
      ) {

        throw new Error(
          "AllOrganizationAccess is not allowed for Brand login"
        );

      }


      // ------------------------------------------
      // Validate Brand
      // ------------------------------------------

      const brandCheck =
        await client.query(
          `
          SELECT
            BrandID

          FROM Brand_Master

          WHERE BrandID = $1
            AND IsDeleted = FALSE
            AND IsActive = TRUE

          LIMIT 1;
          `,
          [BrandID]
        );


      if (
        brandCheck.rows.length === 0
      ) {

        throw new Error(
          "Invalid or inactive Brand"
        );

      }

    }


    // ========================================================
    // 10. UPDATE USER MASTER
    // ========================================================

    const result =
      await client.query(
        `
        UPDATE user_master

        SET

          EmployeeCode = $1,
          Username = $2,
          PasswordHash = $3,
          FullName = $4,

          Designation = $5,
          DepartmentID = $6,
          DivisionID = $7,

          LoginType = $8,
          UserType = $9,

          Email = $10,
          PhoneNumber = $11,
          Gender = $12,

          ProfilePhoto = $13,

          AllOrganizationAccess = $14,

          LastPasswordChangedDate = $15,
          PasswordExpiryDate = $16,

          IsLocked = $17,
          IsActive = $18,

          DateOfJoining = $19,

          ModifiedBy = $20,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE UserID = $21
          AND IsDeleted = FALSE

        RETURNING UserID;
        `,
        [

          EmployeeCode,
          Username,
          finalPasswordHash,
          FullName,

          Designation || null,
          DepartmentID || null,
          DivisionID || null,

          LoginType,
          UserType || null,

          Email || null,
          PhoneNumber || null,
          Gender || null,

          finalProfilePhoto,

          LoginType === "SuperAdmin"
            ? (AllOrganizationAccess ?? false)
            : false,

          LastPasswordChangedDate || null,
          PasswordExpiryDate || null,

          IsLocked ?? false,
          IsActive ?? true,

          DateOfJoining || null,

          ModifiedBy || UserID,

          UserID,

        ]
      );


    if (
      result.rows.length === 0
    ) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User Not Found",
      };

    }


    // ========================================================
    // 11. BRAND MAPPING
    // ========================================================

    await client.query(
      `
      UPDATE user_brand_mapping

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
        UserID
      ]
    );


    let userBrandMapID = null;


    // ========================================================
    // CREATE / REACTIVATE BRAND
    // ========================================================

    if (
      LoginType === "Brand"
    ) {

      const existingBrandMapping =
        await client.query(
          `
          SELECT
            UserBrandMapID

          FROM user_brand_mapping

          WHERE UserID = $1
            AND BrandID = $2

          LIMIT 1;
          `,
          [
            UserID,
            BrandID
          ]
        );


      if (
        existingBrandMapping.rows.length > 0
      ) {

        userBrandMapID =
          existingBrandMapping.rows[0]
            .userbrandmapid;


        await client.query(
          `
          UPDATE user_brand_mapping

          SET

            Username = $1,

            IsActive = TRUE,
            IsDeleted = FALSE,

            ModifiedBy = $2,
            ModifiedDate = CURRENT_TIMESTAMP,

            DeletedBy = NULL,
            DeletedDate = NULL

          WHERE UserBrandMapID = $3;
          `,
          [
            Username,
            ModifiedBy || UserID,
            userBrandMapID
          ]
        );

      }

      else {

        const brandMappingResult =
          await client.query(
            `
            INSERT INTO user_brand_mapping
            (
              UserID,
              BrandID,
              Username,

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

            RETURNING UserBrandMapID;
            `,
            [
              UserID,
              BrandID,
              Username,
              ModifiedBy || UserID
            ]
          );


        userBrandMapID =
          brandMappingResult.rows[0]
            .userbrandmapid;

      }

    }


    // ========================================================
    // 12. ORGANIZATION MAPPING
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
        UserID
      ]
    );


    // ========================================================
    // SUPER ADMIN - ALL ORGANIZATIONS
    // ========================================================

    if (
      LoginType === "SuperAdmin" &&
      AllOrganizationAccess === true
    ) {

      // No mapping rows required.

    }


    // ========================================================
    // SUPER ADMIN - LIMITED
    // ========================================================

    else if (
      LoginType === "SuperAdmin" &&
      AllOrganizationAccess === false
    ) {

      for (
        const organization
        of Organizations
      ) {

        const OrganizationID =
          Number(
            organization?.OrganizationID
          );


        if (!OrganizationID) {

          throw new Error(
            "OrganizationID is required"
          );

        }


        const organizationCheck =
          await client.query(
            `
            SELECT
              OrganizationID

            FROM Organization_Master

            WHERE OrganizationID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE

            LIMIT 1;
            `,
            [OrganizationID]
          );


        if (
          organizationCheck.rows.length === 0
        ) {

          throw new Error(
            `Invalid or inactive OrganizationID: ${OrganizationID}`
          );

        }


        const existingMapping =
          await client.query(
            `
            SELECT
              UserOrgMapID

            FROM user_org_mapping

            WHERE UserID = $1
              AND OrganizationID = $2

            LIMIT 1;
            `,
            [
              UserID,
              OrganizationID
            ]
          );


        if (
          existingMapping.rows.length > 0
        ) {

          const UserOrgMapID =
            existingMapping.rows[0]
              .userorgmapid;


          await client.query(
            `
            UPDATE user_org_mapping

            SET

              UserBrandMapID = NULL,

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
              UserOrgMapID
            ]
          );

        }

        else {

          await client.query(
            `
            INSERT INTO user_org_mapping
            (
              UserID,
              UserBrandMapID,
              OrganizationID,

              IsActive,
              IsDeleted,

              CreatedBy
            )

            VALUES
            (
              $1,
              NULL,
              $2,

              TRUE,
              FALSE,

              $3
            );
            `,
            [
              UserID,
              OrganizationID,
              ModifiedBy || UserID
            ]
          );

        }

      }

    }


    // ========================================================
    // ORGANIZATION USER
    // ========================================================

    else if (
      LoginType === "Organization"
    ) {

      const OrganizationID =
        Number(
          Organizations[0]?.OrganizationID
        );


      if (!OrganizationID) {

        throw new Error(
          "OrganizationID is required"
        );

      }


      const organizationCheck =
        await client.query(
          `
          SELECT
            OrganizationID

          FROM Organization_Master

          WHERE OrganizationID = $1
            AND IsDeleted = FALSE
            AND IsActive = TRUE

          LIMIT 1;
          `,
          [OrganizationID]
        );


      if (
        organizationCheck.rows.length === 0
      ) {

        throw new Error(
          `Invalid or inactive OrganizationID: ${OrganizationID}`
        );

      }


      const existingMapping =
        await client.query(
          `
          SELECT
            UserOrgMapID

          FROM user_org_mapping

          WHERE UserID = $1
            AND OrganizationID = $2

          LIMIT 1;
          `,
          [
            UserID,
            OrganizationID
          ]
        );


      if (
        existingMapping.rows.length > 0
      ) {

        await client.query(
          `
          UPDATE user_org_mapping

          SET

            UserBrandMapID = NULL,

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
            existingMapping.rows[0]
              .userorgmapid
          ]
        );

      }

      else {

        await client.query(
          `
          INSERT INTO user_org_mapping
          (
            UserID,
            UserBrandMapID,
            OrganizationID,

            IsActive,
            IsDeleted,

            CreatedBy
          )

          VALUES
          (
            $1,
            NULL,
            $2,

            TRUE,
            FALSE,

            $3
          );
          `,
          [
            UserID,
            OrganizationID,
            ModifiedBy || UserID
          ]
        );

      }

    }


    // ========================================================
    // BRAND USER
    // ========================================================

    else if (
      LoginType === "Brand"
    ) {

      for (
        const organization
        of Organizations
      ) {

        const OrganizationID =
          Number(
            organization?.OrganizationID
          );


        if (!OrganizationID) {

          throw new Error(
            "OrganizationID is required"
          );

        }


        const organizationCheck =
          await client.query(
            `
            SELECT
              OrganizationID,
              BrandID

            FROM Organization_Master

            WHERE OrganizationID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE

            LIMIT 1;
            `,
            [OrganizationID]
          );


        if (
          organizationCheck.rows.length === 0
        ) {

          throw new Error(
            `Invalid or inactive OrganizationID: ${OrganizationID}`
          );

        }


        const organizationData =
          organizationCheck.rows[0];


        if (
          Number(organizationData.brandid) !==
          Number(BrandID)
        ) {

          throw new Error(
            `Organization ${OrganizationID} does not belong to selected Brand`
          );

        }


        const existingMapping =
          await client.query(
            `
            SELECT
              UserOrgMapID

            FROM user_org_mapping

            WHERE UserID = $1
              AND OrganizationID = $2

            LIMIT 1;
            `,
            [
              UserID,
              OrganizationID
            ]
          );


        if (
          existingMapping.rows.length > 0
        ) {

          await client.query(
            `
            UPDATE user_org_mapping

            SET

              UserBrandMapID = $1,

              IsActive = TRUE,
              IsDeleted = FALSE,

              ModifiedBy = $2,
              ModifiedDate = CURRENT_TIMESTAMP,

              DeletedBy = NULL,
              DeletedDate = NULL

            WHERE UserOrgMapID = $3;
            `,
            [
              userBrandMapID,
              ModifiedBy || UserID,
              existingMapping.rows[0]
                .userorgmapid
            ]
          );

        }

        else {

          await client.query(
            `
            INSERT INTO user_org_mapping
            (
              UserID,
              UserBrandMapID,
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

              TRUE,
              FALSE,

              $4
            );
            `,
            [
              UserID,
              userBrandMapID,
              OrganizationID,
              ModifiedBy || UserID
            ]
          );

        }

      }

    }


    // ========================================================
    // 13. PRODUCT MAPPING
    // ========================================================

    // IMPORTANT:
    // Products are independent of Department.
    //
    // Any active ProductID can be assigned to the user,
    // regardless of DepartmentID.
    // ========================================================


    // ------------------------------------------
    // Deactivate old products
    // ------------------------------------------

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
        UserID
      ]
    );


    // ------------------------------------------
    // Create / Reactivate Products
    // ------------------------------------------

    if (
      Array.isArray(Products)
    ) {

      for (
        const product
        of Products
      ) {

        const ProductID =
          Number(
            product?.ProductID
          );


        if (!ProductID) {

          throw new Error(
            "ProductID is required"
          );

        }


        // --------------------------------------
        // Product validity check
        //
        // NO Department check here.
        // --------------------------------------

        const productCheck =
          await client.query(
            `
            SELECT
              ProductID

            FROM Product_Master

            WHERE ProductID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE

            LIMIT 1;
            `,
            [ProductID]
          );


        if (
          productCheck.rows.length === 0
        ) {

          throw new Error(
            `Invalid or inactive ProductID: ${ProductID}`
          );

        }


        // --------------------------------------
        // Check existing mapping
        // --------------------------------------

        const existingProductMapping =
          await client.query(
            `
            SELECT
              UserProductMapID

            FROM user_product_mapping

            WHERE UserID = $1
              AND ProductID = $2

            LIMIT 1;
            `,
            [
              UserID,
              ProductID
            ]
          );


        // --------------------------------------
        // Reactivate
        // --------------------------------------

        if (
          existingProductMapping.rows.length > 0
        ) {

          const UserProductMapID =
            existingProductMapping.rows[0]
              .userproductmapid;


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
              UserProductMapID
            ]
          );

        }

        // --------------------------------------
        // Insert new product
        // --------------------------------------

        else {

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
              (
                SELECT
                  COALESCE(
                    MAX(UserProductMapID),
                    0
                  ) + 1
                FROM user_product_mapping
              ),

              $1,
              $2,

              TRUE,
              FALSE,

              $3
            );
            `,
            [
              UserID,
              ProductID,
              ModifiedBy || UserID
            ]
          );

        }

      }

    }


    // ========================================================
    // 14. COMMIT
    // ========================================================

    await client.query("COMMIT");


    // ========================================================
    // RESPONSE
    // ========================================================

    return {

      success: true,

      message:
        "User Updated Successfully",

    };


  } catch (error) {

    await client.query("ROLLBACK");


    console.log(
      "Update User Error :",
      error.message
    );


    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }


    // ========================================================
    // DUPLICATE
    // ========================================================

    if (
      error.code === "23505"
    ) {

      if (
        error.constraint ===
        "uq_userbrandmapping"
      ) {

        return {

          success: false,

          message:
            "User is already mapped with this Brand",

        };

      }


      if (
        error.constraint ===
        "uq_userproductmapping"
      ) {

        return {

          success: false,

          message:
            "User is already mapped with this Product",

        };

      }


      return {

        success: false,

        message:
          "Username or Employee Code already exists",

      };

    }


    // ========================================================
    // FOREIGN KEY
    // ========================================================

    if (
      error.code === "23503"
    ) {

      return {

        success: false,

        message:
          "Invalid User, Brand, Organization, Department, Division or Product",

      };

    }


    return {

      success: false,

      message:
        error.message,

    };

  } finally {

    client.release();

  }

};
// ============================================================
// UPDATE USER PERSONAL DETAILS
// ============================================================
const updateUserPersonalDetails = async (data) => {

  try {

    const {
      UserID,

      EmployeeCode,
      Username,
      FullName,

      Designation,

      DepartmentID,
      DivisionID,

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
    // 1. VALIDATE USER ID
    // ========================================================

    if (!UserID) {

      return {
        success: false,
        message: "UserID is required",
      };

    }


    // ========================================================
    // 2. CHECK USER
    // ========================================================

    const userCheck = await pool.query(
      `
      SELECT
        UserID
      FROM user_master
      WHERE UserID = $1
        AND IsDeleted = FALSE
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
    // 3. VALIDATE DEPARTMENT + DIVISION
    // ========================================================

    // DepartmentID and DivisionID both supplied
    // → Department must belong to selected Division

    if (
      DepartmentID !== undefined &&
      DepartmentID !== null &&
      DepartmentID !== "" &&
      DivisionID !== undefined &&
      DivisionID !== null &&
      DivisionID !== ""
    ) {

      const departmentCheck = await pool.query(
        `
        SELECT
          DepartmentID
        FROM Department_Master
        WHERE DepartmentID = $1
          AND DivisionID = $2
          AND IsDeleted = FALSE
        LIMIT 1;
        `,
        [
          DepartmentID,
          DivisionID
        ]
      );


      if (departmentCheck.rows.length === 0) {

        return {
          success: false,
          message:
            "Invalid DepartmentID or Department does not belong to selected Division",
        };

      }

    }


    // ========================================================
    // 4. VALIDATE DEPARTMENT ONLY
    // ========================================================

    if (
      DepartmentID !== undefined &&
      DepartmentID !== null &&
      DepartmentID !== ""
    ) {

      const departmentCheck = await pool.query(
        `
        SELECT
          DepartmentID
        FROM Department_Master
        WHERE DepartmentID = $1
          AND IsDeleted = FALSE
        LIMIT 1;
        `,
        [DepartmentID]
      );


      if (departmentCheck.rows.length === 0) {

        return {
          success: false,
          message: "Invalid DepartmentID",
        };

      }

    }


    // ========================================================
    // 5. VALIDATE DIVISION ONLY
    // ========================================================

    if (
      DivisionID !== undefined &&
      DivisionID !== null &&
      DivisionID !== ""
    ) {

      const divisionCheck = await pool.query(
        `
        SELECT
          DivisionID
        FROM Division_Master
        WHERE DivisionID = $1
          AND IsDeleted = FALSE
        LIMIT 1;
        `,
        [DivisionID]
      );


      if (divisionCheck.rows.length === 0) {

        return {
          success: false,
          message: "Invalid DivisionID",
        };

      }

    }


    // ========================================================
    // 6. DYNAMIC UPDATE
    // Only supplied fields will be updated
    // ========================================================

    const fields = [];
    const values = [];


    const addField = (column, value) => {

      if (value !== undefined) {

        values.push(value);

        fields.push(
          `${column} = $${values.length}`
        );

      }

    };


    // ========================================================
    // PERSONAL DETAILS
    // ========================================================

    addField(
      "employeecode",
      EmployeeCode
    );

    addField(
      "username",
      Username
    );

    addField(
      "fullname",
      FullName
    );

    addField(
      "designation",
      Designation
    );


    // ========================================================
    // DEPARTMENT / DIVISION
    // ========================================================

    addField(
      "departmentid",
      DepartmentID
    );

    addField(
      "divisionid",
      DivisionID
    );


    // ========================================================
    // CONTACT DETAILS
    // ========================================================

    addField(
      "email",
      Email
    );

    addField(
      "phonenumber",
      PhoneNumber
    );

    addField(
      "gender",
      Gender
    );


    // ========================================================
    // PROFILE PHOTO
    // ========================================================

    addField(
      "profilephoto",
      ProfilePhoto
    );


    // ========================================================
    // OTHER DETAILS
    // ========================================================

    addField(
      "dateofjoining",
      DateOfJoining
    );


    // ========================================================
    // ACCOUNT STATUS
    // ========================================================

    addField(
      "islocked",
      IsLocked
    );

    addField(
      "isactive",
      IsActive
    );


    // ========================================================
    // NO FIELDS
    // ========================================================

    if (fields.length === 0) {

      return {
        success: false,
        message: "No fields provided for update",
      };

    }


    // ========================================================
    // MODIFIED BY
    // ========================================================

    values.push(
      ModifiedBy || UserID
    );

    fields.push(
      `modifiedby = $${values.length}`
    );

    fields.push(
      `modifieddate = CURRENT_TIMESTAMP`
    );


    // ========================================================
    // USER ID
    // ========================================================

    values.push(UserID);

    const userIdParameter =
      values.length;


    // ========================================================
    // UPDATE QUERY
    // ========================================================

    const query = `
      UPDATE user_master

      SET
        ${fields.join(", ")}

      WHERE UserID = $${userIdParameter}
        AND IsDeleted = FALSE

      RETURNING

        UserID AS "UserID",

        EmployeeCode AS "EmployeeCode",
        Username AS "Username",
        FullName AS "FullName",

        Designation AS "Designation",

        DepartmentID AS "DepartmentID",
        DivisionID AS "DivisionID",

        Email AS "Email",
        PhoneNumber AS "PhoneNumber",
        Gender AS "Gender",

        ProfilePhoto AS "ProfilePhoto",

        DateOfJoining AS "DateOfJoining",

        IsLocked AS "IsLocked",
        IsActive AS "IsActive",

        ModifiedBy AS "ModifiedBy",
        ModifiedDate AS "ModifiedDate";
    `;


    // ========================================================
    // LOG
    // ========================================================

    console.log(
      "UPDATE USER PERSONAL DETAILS QUERY:",
      query
    );

    console.log(
      "UPDATE USER PERSONAL DETAILS VALUES:",
      values
    );


    // ========================================================
    // EXECUTE
    // ========================================================

    const result = await pool.query(
      query,
      values
    );


    // ========================================================
    // RESPONSE
    // ========================================================

    if (result.rows.length === 0) {

      return {
        success: false,
        message: "User not found",
      };

    }


    return {

      success: true,

      message:
        "User personal details updated successfully",

      data:
        result.rows[0],

    };


  } catch (error) {

    console.log(
      "Update User Personal Details Error:",
      error.message
    );


    // ========================================================
    // RETRYABLE DATABASE ERROR
    // ========================================================

    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }


    // ========================================================
    // DUPLICATE
    // ========================================================

    if (error.code === "23505") {

      return {

        success: false,

        message:
          "Username, or Employee Code already exists",

      };

    }


    // ========================================================
    // FOREIGN KEY
    // ========================================================

    if (error.code === "23503") {

      return {

        success: false,

        message:
          "Invalid Department or Division",

      };

    }


    // ========================================================
    // OTHER ERROR
    // ========================================================

    return {

      success: false,

      message:
        error.message,

    };

  }

};

// ============================================================
// UPDATE USER ORGANIZATIONS
// ============================================================
const updateUserOrganizations = async (
  UserID,
  Organizations,
  ModifiedBy,
  AllOrganizationAccess
) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");


    // ========================================================
    // 1. CHECK USER
    // ========================================================

    const userCheck = await client.query(
      `
      SELECT
        UserID,
        LoginType,
        AllOrganizationAccess
      FROM user_master

      WHERE UserID = $1
        AND IsDeleted = FALSE
        AND IsActive = TRUE

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


    const user = userCheck.rows[0];

    const LoginType = user.logintype;


    // ========================================================
    // 2. NORMALIZE ALL ORGANIZATION ACCESS
    // ========================================================

    let normalizedAllOrganizationAccess =
      AllOrganizationAccess;

    if (
      typeof normalizedAllOrganizationAccess === "string"
    ) {

      normalizedAllOrganizationAccess =
        normalizedAllOrganizationAccess.toLowerCase() === "true";

    }


    // If value not supplied, keep existing value
    if (
      normalizedAllOrganizationAccess === undefined ||
      normalizedAllOrganizationAccess === null
    ) {

      normalizedAllOrganizationAccess =
        user.allorganizationaccess === true;

    }


    // ========================================================
    // 3. VALIDATE ORGANIZATIONS
    // ========================================================

    if (!Array.isArray(Organizations)) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "Organizations must be an array",
      };

    }


    // ========================================================
    // 4. SUPER ADMIN
    // ========================================================

    if (LoginType === "SuperAdmin") {


      // ======================================================
      // SUPER ADMIN - ALL ORGANIZATION ACCESS
      // ======================================================

      if (
        normalizedAllOrganizationAccess === true
      ) {

        // ----------------------------------------------------
        // Remove organization mappings
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // Update User Master
        // ----------------------------------------------------

        await client.query(
          `
          UPDATE user_master

          SET
            AllOrganizationAccess = TRUE,

            ModifiedBy = $1,
            ModifiedDate = CURRENT_TIMESTAMP

          WHERE UserID = $2
            AND IsDeleted = FALSE;
          `,
          [
            ModifiedBy || UserID,
            UserID,
          ]
        );


        await client.query("COMMIT");


        return {
          success: true,

          message:
            "SuperAdmin updated with access to all organizations",
        };

      }


      // ======================================================
      // SUPER ADMIN - LIMITED ACCESS
      // ======================================================

      if (
        normalizedAllOrganizationAccess === false &&
        Organizations.length === 0
      ) {

        await client.query("ROLLBACK");

        return {
          success: false,

          message:
            "At least one organization is required for limited SuperAdmin",
        };

      }


      // ------------------------------------------------------
      // Update Access Flag
      // ------------------------------------------------------

      await client.query(
        `
        UPDATE user_master

        SET
          AllOrganizationAccess = FALSE,

          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE UserID = $2
          AND IsDeleted = FALSE;
        `,
        [
          ModifiedBy || UserID,
          UserID,
        ]
      );


      // ------------------------------------------------------
      // Deactivate Current Mappings
      // ------------------------------------------------------

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


      // ------------------------------------------------------
      // Add Selected Organizations
      // ------------------------------------------------------

      for (const organization of Organizations) {

        const OrganizationID =
          organization.OrganizationID;


        if (!OrganizationID) {

          throw new Error(
            "OrganizationID is required"
          );

        }


        // ----------------------------------------------------
        // Validate Organization
        // ----------------------------------------------------

        const organizationCheck =
          await client.query(
            `
            SELECT
              OrganizationID,
              BrandID,
              OrganizationName

            FROM Organization_Master

            WHERE OrganizationID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE

            LIMIT 1;
            `,
            [OrganizationID]
          );


        if (organizationCheck.rows.length === 0) {

          throw new Error(
            `Invalid or inactive OrganizationID: ${OrganizationID}`
          );

        }


        // ----------------------------------------------------
        // Check Existing Mapping
        // ----------------------------------------------------

        const existingMapping =
          await client.query(
            `
            SELECT
              UserOrgMapID

            FROM user_org_mapping

            WHERE UserID = $1
              AND OrganizationID = $2

            LIMIT 1;
            `,
            [
              UserID,
              OrganizationID,
            ]
          );


        // ----------------------------------------------------
        // Reactivate Existing Mapping
        // ----------------------------------------------------

        if (existingMapping.rows.length > 0) {

          await client.query(
            `
            UPDATE user_org_mapping

            SET
              UserBrandMapID = NULL,

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

              existingMapping.rows[0].userorgmapid,
            ]
          );

          continue;

        }


        // ----------------------------------------------------
        // Generate Mapping ID
        // ----------------------------------------------------

        const idResult =
          await client.query(
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


        // ----------------------------------------------------
        // Insert Mapping
        // ----------------------------------------------------

        await client.query(
          `
          INSERT INTO user_org_mapping
          (
            UserOrgMapID,
            UserID,
            UserBrandMapID,
            OrganizationID,

            IsActive,
            IsDeleted,

            CreatedBy
          )

          VALUES
          (
            $1,
            $2,
            NULL,
            $3,

            TRUE,
            FALSE,

            $4
          );
          `,
          [
            UserOrgMapID,
            UserID,
            OrganizationID,
            ModifiedBy || UserID,
          ]
        );

      }

    }


    // ========================================================
    // 5. ORGANIZATION LOGIN
    // ========================================================

    else if (LoginType === "Organization") {


      if (Organizations.length !== 1) {

        await client.query("ROLLBACK");

        return {
          success: false,

          message:
            "Organization user must have exactly one organization",
        };

      }


      const OrganizationID =
        Organizations[0].OrganizationID;


      if (!OrganizationID) {

        throw new Error(
          "OrganizationID is required"
        );

      }


      // ------------------------------------------------------
      // Validate Organization
      // ------------------------------------------------------

      const organizationCheck =
        await client.query(
          `
          SELECT
            OrganizationID

          FROM Organization_Master

          WHERE OrganizationID = $1
            AND IsDeleted = FALSE
            AND IsActive = TRUE

          LIMIT 1;
          `,
          [OrganizationID]
        );


      if (organizationCheck.rows.length === 0) {

        throw new Error(
          `Invalid or inactive OrganizationID: ${OrganizationID}`
        );

      }


      // ------------------------------------------------------
      // Organization cannot have All Access
      // ------------------------------------------------------

      await client.query(
        `
        UPDATE user_master

        SET
          AllOrganizationAccess = FALSE,

          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE UserID = $2
          AND IsDeleted = FALSE;
        `,
        [
          ModifiedBy || UserID,
          UserID,
        ]
      );


      // ------------------------------------------------------
      // Deactivate Old Mapping
      // ------------------------------------------------------

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


      // ------------------------------------------------------
      // Check Existing Mapping
      // ------------------------------------------------------

      const existingMapping =
        await client.query(
          `
          SELECT
            UserOrgMapID

          FROM user_org_mapping

          WHERE UserID = $1
            AND OrganizationID = $2

          LIMIT 1;
          `,
          [
            UserID,
            OrganizationID,
          ]
        );


      // ------------------------------------------------------
      // Reactivate
      // ------------------------------------------------------

      if (existingMapping.rows.length > 0) {

        await client.query(
          `
          UPDATE user_org_mapping

          SET
            UserBrandMapID = NULL,

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

            existingMapping.rows[0].userorgmapid,
          ]
        );

      }

      // ------------------------------------------------------
      // Insert New Mapping
      // ------------------------------------------------------

      else {

        const idResult =
          await client.query(
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


        await client.query(
          `
          INSERT INTO user_org_mapping
          (
            UserOrgMapID,
            UserID,
            UserBrandMapID,
            OrganizationID,

            IsActive,
            IsDeleted,

            CreatedBy
          )

          VALUES
          (
            $1,
            $2,
            NULL,
            $3,

            TRUE,
            FALSE,

            $4
          );
          `,
          [
            UserOrgMapID,
            UserID,
            OrganizationID,
            ModifiedBy || UserID,
          ]
        );

      }

    }


    // ========================================================
    // 6. BRAND LOGIN
    // ========================================================

    else if (LoginType === "Brand") {


      if (Organizations.length === 0) {

        await client.query("ROLLBACK");

        return {
          success: false,

          message:
            "At least one organization is required for Brand login",
        };

      }


      // ------------------------------------------------------
      // Get Brand Mapping
      // ------------------------------------------------------

      const brandMapping =
        await client.query(
          `
          SELECT
            UserBrandMapID,
            BrandID

          FROM user_brand_mapping

          WHERE UserID = $1
            AND IsDeleted = FALSE
            AND IsActive = TRUE

          LIMIT 1;
          `,
          [UserID]
        );


      if (brandMapping.rows.length === 0) {

        throw new Error(
          "Brand mapping not found for Brand user"
        );

      }


      const UserBrandMapID =
        brandMapping.rows[0].userbrandmapid;


      const BrandID =
        brandMapping.rows[0].brandid;


      // ------------------------------------------------------
      // Brand cannot have All Access
      // ------------------------------------------------------

      await client.query(
        `
        UPDATE user_master

        SET
          AllOrganizationAccess = FALSE,

          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP

        WHERE UserID = $2
          AND IsDeleted = FALSE;
        `,
        [
          ModifiedBy || UserID,
          UserID,
        ]
      );


      // ------------------------------------------------------
      // Deactivate Old Mappings
      // ------------------------------------------------------

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


      // ------------------------------------------------------
      // Selected Organizations
      // ------------------------------------------------------

      for (const organization of Organizations) {

        const OrganizationID =
          organization.OrganizationID;


        if (!OrganizationID) {

          throw new Error(
            "OrganizationID is required"
          );

        }


        // ----------------------------------------------------
        // Validate Organization + Brand
        // ----------------------------------------------------

        const organizationCheck =
          await client.query(
            `
            SELECT
              OrganizationID,
              BrandID

            FROM Organization_Master

            WHERE OrganizationID = $1
              AND IsDeleted = FALSE
              AND IsActive = TRUE

            LIMIT 1;
            `,
            [OrganizationID]
          );


        if (organizationCheck.rows.length === 0) {

          throw new Error(
            `Invalid or inactive OrganizationID: ${OrganizationID}`
          );

        }


        const organizationData =
          organizationCheck.rows[0];


        if (
          Number(organizationData.brandid) !==
          Number(BrandID)
        ) {

          throw new Error(
            `Organization ${OrganizationID} does not belong to user's Brand`
          );

        }


        // ----------------------------------------------------
        // Check Existing Mapping
        // ----------------------------------------------------

        const existingMapping =
          await client.query(
            `
            SELECT
              UserOrgMapID

            FROM user_org_mapping

            WHERE UserID = $1
              AND OrganizationID = $2

            LIMIT 1;
            `,
            [
              UserID,
              OrganizationID,
            ]
          );


        // ----------------------------------------------------
        // Reactivate Existing
        // ----------------------------------------------------

        if (existingMapping.rows.length > 0) {

          await client.query(
            `
            UPDATE user_org_mapping

            SET
              UserBrandMapID = $1,

              IsActive = TRUE,
              IsDeleted = FALSE,

              ModifiedBy = $2,
              ModifiedDate = CURRENT_TIMESTAMP,

              DeletedBy = NULL,
              DeletedDate = NULL

            WHERE UserOrgMapID = $3;
            `,
            [
              UserBrandMapID,

              ModifiedBy || UserID,

              existingMapping.rows[0].userorgmapid,
            ]
          );

        }

        // ----------------------------------------------------
        // Insert New Mapping
        // ----------------------------------------------------

        else {

          const idResult =
            await client.query(
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


          await client.query(
            `
            INSERT INTO user_org_mapping
            (
              UserOrgMapID,
              UserID,
              UserBrandMapID,
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
              UserBrandMapID,
              OrganizationID,
              ModifiedBy || UserID,
            ]
          );

        }

      }

    }


    // ========================================================
    // 7. INVALID LOGIN TYPE
    // ========================================================

    else {

      throw new Error(
        "Invalid LoginType"
      );

    }


    // ========================================================
    // 8. COMMIT
    // ========================================================

    await client.query("COMMIT");


    return {

      success: true,

      message:
        "User organizations updated successfully",

    };


  } catch (error) {

    await client.query("ROLLBACK");


    console.log(
      "Update User Organizations Error:",
      error.message
    );


    const retryResponse =
      retryableDatabaseResponse(error);

    if (retryResponse) {
      return retryResponse;
    }


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

      message:
        error.message,

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
