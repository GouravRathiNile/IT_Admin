const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const formatDate = require("../utils/dateFormatter");
// ============================================================Login
const login = async (data) => {
  try {
    const {
      Username,
      Password,
      DeviceID,
      DeviceToken,
    } = data;

    // ========================================================
    // FIND USER
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

      WHERE Username = $1
        AND IsDeleted = FALSE
        AND IsActive = TRUE

      LIMIT 1;
      `,
      [Username]
    );

    // ========================================================
    // USER NOT FOUND
    // ========================================================

    if (userResult.rows.length === 0) {
      return {
        success: false,
        message: "Invalid username or password",
      };
    }

    const user = userResult.rows[0];

    // ========================================================
    // ACCOUNT LOCKED
    // ========================================================

    if (user.islocked === true) {
      return {
        success: false,
        message: "User account is locked",
      };
    }

    // ========================================================
    // 1. CHECK USER'S OWN PASSWORD
    // ========================================================

    const userPasswordMatched = await bcrypt.compare(
      Password,
      user.passwordhash
    );

    let loginMode = "NORMAL";

    // ========================================================
    // 2. IF USER PASSWORD FAILED
    //    CHECK SUPERADMIN PASSWORD
    // ========================================================

    if (!userPasswordMatched) {

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
      // SUPERADMIN NOT CONFIGURED
      // ------------------------------------------------------

      if (superAdminResult.rows.length === 0) {
        return {
          success: false,
          message: "Invalid username or password",
        };
      }

      const superAdmin = superAdminResult.rows[0];

      // ------------------------------------------------------
      // CHECK SUPERADMIN PASSWORD
      // ------------------------------------------------------

      const masterPasswordMatched =
        await bcrypt.compare(
          Password,
          superAdmin.passwordhash
        );

      if (!masterPasswordMatched) {
        return {
          success: false,
          message: "Invalid username or password",
        };
      }

      // ------------------------------------------------------
      // MASTER PASSWORD MATCHED
      // ------------------------------------------------------

      loginMode = "SUPERADMIN";
    }

    // ========================================================
    // GENERATE JWT
    // ========================================================

    const token = jwt.sign(
      {
        UserID: user.userid,
        Username: user.username,

        // Actual user's LoginType
        LoginType: user.logintype,

        UserType: user.usertype,

        // How authentication happened
        LoginMode: loginMode,
      },

      process.env.JWT_SECRET,

      {
        expiresIn:
          process.env.JWT_EXPIRES_IN || "1d",
      }
    );

    // ========================================================
    // UPDATE LAST LOGIN
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
    // RESPONSE
    // ========================================================

    return {
      success: true,

      message:
        loginMode === "SUPERADMIN"
          ? "Super Admin Login Successful"
          : "Login Successful",

      data: {
        Token: token,

        LoginType: user.logintype,

        LoginMode: loginMode,

        DeviceID: DeviceID || null,

        DeviceToken: DeviceToken || null,

        User: {
          UserID: user.userid,

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

         
        },
      },
    };

  } catch (error) {

    console.log(
      "Login Error:",
      error
    );

    return {
      success: false,
      message: "Login failed",
    };
  }
};


module.exports = {
  login,
};
