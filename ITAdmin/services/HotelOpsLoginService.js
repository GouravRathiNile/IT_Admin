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
      DeviceType,
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
    // DEVICE REGISTRATION
    // ========================================================

    if (DeviceID && DeviceToken) {

      await pool.query(
        `
    INSERT INTO user_device
    (
      UserID,
      DeviceID,
      DeviceToken,
      DeviceType,
      IsActive,
      IsDeleted,
      CreatedBy,
      CreatedDate
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      TRUE,
      FALSE,
      $1,
      CURRENT_TIMESTAMP
    )

    ON CONFLICT (UserID, DeviceID)

    DO UPDATE SET
      DeviceToken = EXCLUDED.DeviceToken,
      DeviceType = EXCLUDED.DeviceType,
      IsActive = TRUE,
      IsDeleted = FALSE,
      ModifiedBy = EXCLUDED.UserID,
      ModifiedDate = CURRENT_TIMESTAMP;
    `,
        [
          user.userid,
          DeviceID,
          DeviceToken,
          DeviceType
        ]
      );

    }

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

// ============================================================Change Password
const changePassword = async (data) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const {
      UserID,
      CurrentPassword,
      NewPassword,
    } = data;

    // ========================================================
    // Get User
    // ========================================================

    const userResult = await client.query(
      `
      SELECT
        UserID,
        Username,
        PasswordHash,
        IsActive,
        IsDeleted

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

    if (userResult.rows.length === 0) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User not found",
      };

    }

    const user = userResult.rows[0];

    // ========================================================
    // Account Inactive
    // ========================================================

    if (!user.isactive) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "User account is inactive",
      };

    }

    // ========================================================
    // Verify Current Password
    // ========================================================

    const currentPasswordMatched =
      await bcrypt.compare(
        CurrentPassword,
        user.passwordhash
      );

    if (!currentPasswordMatched) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message: "Current password is incorrect",
      };

    }

    // ========================================================
    // Prevent Same Password
    // ========================================================

    const samePassword =
      await bcrypt.compare(
        NewPassword,
        user.passwordhash
      );

    if (samePassword) {

      await client.query("ROLLBACK");

      return {
        success: false,
        message:
          "New password must be different from current password",
      };

    }

    // ========================================================
    // Hash New Password
    // ========================================================

    const newPasswordHash =
      await bcrypt.hash(
        NewPassword,
        10
      );

    // ========================================================
    // Password Dates
    // ========================================================

    /*
     * Password Changed:
     * Current Timestamp
     *
     * Password Expiry:
     * 90 Days from Current Timestamp
     */

    // ========================================================
    // Update Password
    // ========================================================

    await client.query(
      `
      UPDATE user_master

      SET
        PasswordHash = $1,

        LastPasswordChangedDate =
          CURRENT_TIMESTAMP,

        PasswordExpiryDate =
          CURRENT_TIMESTAMP + INTERVAL '90 days',

        ModifiedBy = $2,

        ModifiedDate =
          CURRENT_TIMESTAMP

      WHERE UserID = $2;
      `,
      [
        newPasswordHash,
        UserID,
      ]
    );

    // ========================================================
    // Commit
    // ========================================================

    await client.query("COMMIT");

    return {

      success: true,

      message:
        "Password changed successfully",

      data: {

        UserID,

        PasswordChangedDate:
          new Date(),

        PasswordExpiryDate:
          new Date(
            Date.now() +
            90 * 24 * 60 * 60 * 1000
          ),

      },

    };

  } catch (error) {

    await client.query("ROLLBACK");

    console.log(
      "Change Password Error:",
      error.message
    );

    return {

      success: false,

      message:
        error.message,

    };

  } finally {

    client.release();

  }
};

module.exports = {
  login,
  changePassword,
};
