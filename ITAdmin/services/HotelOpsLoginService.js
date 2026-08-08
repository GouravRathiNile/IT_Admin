const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const formatDate = require("../utils/dateFormatter");

const generateUrl = require("../AzurConfigration/UserMaster/AzureGetData");


// ============================================================Login
const login = async (data) => {

  try {
    const {
      Username,
      Password,
      LoginType,
      DeviceID,
      DeviceToken,
    } = data;

    // ========================================================
    // Find Target User
    // ========================================================

    const userResult = await pool.query(
      `
      SELECT
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
        LastLogin,

        IsLocked,
        IsActive,
        IsDeleted,

        DateOfJoining,

        CreatedBy,
        CreatedDate,

        ModifiedBy,
        ModifiedDate

      FROM user_master

      WHERE LOWER(Username) = LOWER($1)
        AND IsDeleted = FALSE
        AND IsActive = TRUE

      LIMIT 1;
      `,
      [Username]
    );


    // ========================================================
    // User Not Found
    // ========================================================

    if (userResult.rows.length === 0) {

      return {
        success: false,
        message: "Invalid username or password",
      };

    }


    const user = userResult.rows[0];


    // ========================================================
    // Account Locked
    // ========================================================

    if (user.islocked === true) {

      return {
        success: false,
        message: "User account is locked",
      };

    }


    // ========================================================
    // LOGIN TYPE
    // ========================================================
    const requestedLoginType = LoginType.toUpperCase();


    // ========================================================
    // HOTEL / NORMAL LOGIN
    // ========================================================
    if (requestedLoginType !== "SUPERADMIN") {
      // ------------------------------------------------------
      // Login type must match user's actual LoginType
      // ------------------------------------------------------
      if (
        user.logintype.toUpperCase() !== requestedLoginType
      ) {
        return {
          success: false,
          message: "Invalid Login Type",
        };
      }


      // ------------------------------------------------------
      // Compare User Password
      // ------------------------------------------------------
      const passwordMatched =
        await bcrypt.compare(
          Password,
          user.passwordhash
        );


      if (!passwordMatched) {

        return {
          success: false,
          message: "Invalid username or password",
        };

      }

    }


    // ========================================================
    // SUPERADMIN LOGIN
    // ========================================================

    else {

      /*
       * Example:
       *
       * Username = rahul
       * Password = Admin@123
       * LoginType = SUPERADMIN
       *
       * Rahul ka PasswordHash compare nahi hoga.
       *
       * Active SUPERADMIN ka PasswordHash niklega
       * aur Admin@123 uske against compare hoga.
       */


      const superAdminResult = await pool.query(
        `
        SELECT
          UserID,
          Username,
          PasswordHash

        FROM user_master

        WHERE UPPER(LoginType) = 'SUPERADMIN'
          AND IsActive = TRUE
          AND IsDeleted = FALSE

        ORDER BY UserID ASC

        LIMIT 1;
        `
      );


      // ------------------------------------------------------
      // SuperAdmin Not Found
      // ------------------------------------------------------

      if (superAdminResult.rows.length === 0) {

        return {
          success: false,
          message: "Super Admin account not configured",
        };

      }


      const superAdmin =
        superAdminResult.rows[0];


      // ------------------------------------------------------
      // Check SuperAdmin Password
      // ------------------------------------------------------

      const masterPasswordMatched =
        await bcrypt.compare(
          Password,
          superAdmin.passwordhash
        );


      if (!masterPasswordMatched) {

        return {
          success: false,
          message: "Invalid Super Admin password",
        };

      }

    }


    // ========================================================
    // Generate JWT
    // ========================================================

    const token = jwt.sign(
      {
        UserID: user.userid,
        Username: user.username,
        LoginType: user.logintype,
        UserType: user.usertype,

        LoginMode:
          requestedLoginType === "SUPERADMIN"
            ? "SUPERADMIN"
            : "NORMAL",
      },

      process.env.JWT_SECRET,

      {
        expiresIn:
          process.env.JWT_EXPIRES_IN || "1d",
      }
    );


    // ========================================================
    // Update Last Login
    // ========================================================

    await pool.query(
      `
      UPDATE user_master
      SET LastLogin = CURRENT_TIMESTAMP
      WHERE UserID = $1;
      `,
      [user.userid]
    );


    // ========================================================
    // Response
    // ========================================================

    return {

      success: true,

      message:
        requestedLoginType === "SUPERADMIN"
          ? "Super Admin Login Successful"
          : "Login Successful",

      data: {

        Token: token,

        LoginType:
          requestedLoginType,

        LoginMode:
          requestedLoginType === "SUPERADMIN"
            ? "SUPERADMIN"
            : "NORMAL",

        DeviceID:
          DeviceID || null,

        DeviceToken:
          DeviceToken || null,

        User: {

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

          LastPasswordChangedDate:
            user.lastpasswordchangeddate
              ? formatDate(
                  user.lastpasswordchangeddate
                )
              : null,

          PasswordExpiryDate:
            user.passwordexpirydate
              ? formatDate(
                  user.passwordexpirydate
                )
              : null,

          LastLogin:
            user.lastlogin
              ? formatDate(user.lastlogin)
              : null,

          IsLocked:
            user.islocked,

          IsActive:
            user.isactive,

          DateOfJoining:
            user.dateofjoining
              ? formatDate(user.dateofjoining)
              : null,

        },

      },

    };

  } catch (error) {

    console.log(
      "Login Error :",
      error.message
    );

    return {

      success: false,

      message:
        error.message,

    };

  }

};


module.exports = {
  login,
};
