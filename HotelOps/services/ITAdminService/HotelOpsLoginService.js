const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { pool } = require("../../db");
const formatDate = require("../../utils/dateFormatter");
const { sendPasswordResetOTP } = require("../../utils/emailService");

const FORGOT_PASSWORD_MESSAGE = "A verification OTP has been sent to your registered email.";
const FORGOT_PASSWORD_OTP_PURPOSE = "FORGOT_PASSWORD_OTP";
const PASSWORD_RESET_VERIFIED_PURPOSE = "PASSWORD_RESET_VERIFIED";

// ============================================================Login
const login = async (data) => {
  try {
    const { Username, Password, DeviceID, DeviceToken, DeviceType } = data;

    // ========================================================
    // FIND USER
    // ========================================================

    const userResult = await pool.query(
      `
      SELECT
    um.UserID,
    um.EmployeeCode,
    um.Username,
    um.PasswordHash,
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
    um.Gender,

    um.ProfilePhoto,

    um.LastPasswordChangedDate,
    um.PasswordExpiryDate,
    um.LastLogin,

    um.IsLocked,
    um.IsActive,
    um.IsDeleted,

    um.DateOfJoining,

    um.AllOrganizationAccess

FROM user_master um

LEFT JOIN Department_Master dm
    ON um.DepartmentID = dm.DepartmentID

LEFT JOIN Division_Master dv
    ON um.DivisionID = dv.DivisionID

WHERE um.Username = $1
  AND um.IsDeleted = FALSE
  AND um.IsActive = TRUE
LIMIT 1;
      `,
      [Username],
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
      user.passwordhash,
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
        `,
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

      const masterPasswordMatched = await bcrypt.compare(
        Password,
        superAdmin.passwordhash,
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
    // console.log('login data:', user.usertype);

    const jti = crypto.randomUUID();

    const token = jwt.sign(
      {
        UserID: user.userid,
        Username: user.username,
        // User details
        UserType: user.usertype,
        DepartmentID: user.departmentid,
        DepartmentName: user.departmentname,

        DivisionID: user.divisionid,
        DivisionName: user.divisionname,
        Designation: user.designation,
        // Actual user's LoginType
        LoginType: user.logintype,
        // How authentication happened
        LoginMode: loginMode,
        AllOrganizationAccess: user.allorganizationaccess,
      },

      process.env.JWT_SECRET,

      {
        expiresIn: process.env.JWT_EXPIRES_IN || "1d",

        jwtid: jti,
      },
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
      [user.userid],
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
        [user.userid, DeviceID, DeviceToken, DeviceType],
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
    console.log("Login Error:", error);

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

    const { UserID, CurrentPassword, NewPassword } = data;

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
      [UserID],
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

    const currentPasswordMatched = await bcrypt.compare(
      CurrentPassword,
      user.passwordhash,
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

    const samePassword = await bcrypt.compare(NewPassword, user.passwordhash);

    if (samePassword) {
      await client.query("ROLLBACK");

      return {
        success: false,
        message: "New password must be different from current password",
      };
    }

    // ========================================================
    // Hash New Password
    // ========================================================

    const newPasswordHash = await bcrypt.hash(NewPassword, 10);

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
      [newPasswordHash, UserID],
    );

    // ========================================================
    // Commit
    // ========================================================

    await client.query("COMMIT");

    return {
      success: true,

      message: "Password changed successfully",

      data: {
        UserID,

        PasswordChangedDate: new Date(),

        PasswordExpiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.log("Change Password Error:", error.message);

    return {
      success: false,

      message: error.message,
    };
  } finally {
    client.release();
  }
};
// ============================================================Forgot Password
const forgotPassword = async (data) => {
  try {
    const userResult = await pool.query(
      `SELECT UserID, Username, Email, IsActive, IsDeleted, IsLocked
       FROM user_master
       WHERE Username = $1
       LIMIT 1;`,
      [data.Username],
    );

    const user = userResult.rows[0];

    if (!user) {
      return {
        success: false,
        statusCode: 400,
        message: "Username not found. Please enter a registered username.",
      };
    }

    if (!user.isactive) {
      return {
        success: false,
        statusCode: 400,
        message: "This user account is inactive.",
      };
    }

    if (user.isdeleted) {
      return {
        success: false,
        statusCode: 400,
        message: "This user account is no longer available.",
      };
    }

    if (user.islocked) {
      return {
        success: false,
        statusCode: 400,
        message:
          "This user account is locked. Please contact the administrator.",
      };
    }

    if (!user.email || !String(user.email).trim()) {
      return {
        success: false,
        statusCode: 400,
        message: "No registered email address was found for this user.",
      };
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, 10);

    try {
      await sendPasswordResetOTP(user.email, otp);
    } catch (error) {
      console.log("Password Reset Email Error:", error.message);
      return {
        success: false,
        statusCode: 503,
        message: "Unable to send the verification OTP. Please try again later.",
      };
    }

    const token = jwt.sign(
      {
        UserID: user.userid,
        Username: user.username,
        OTPHash: otpHash,
        purpose: FORGOT_PASSWORD_OTP_PURPOSE,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "10m",
      },
    );

    return { success: true, message: FORGOT_PASSWORD_MESSAGE, token };
  } catch (error) {
    console.log("Forgot Password Error:", error.message);
    return {
      success: false,
      statusCode: 503,
      message:
        "Unable to process password reset request right now. Please try again later.",
    };
  }
};
// ============================================================Verify Forgot Password OTP
const verifyForgotPasswordOTP = async (data) => {
  try {
    if (!data.UserID || !data.Username || !data.OTPHash) {
      return { success: false, message: "Invalid OTP." };
    }

    const otpMatched = await bcrypt.compare(data.OTP, data.OTPHash);
    if (!otpMatched) {
      return { success: false, message: "Invalid OTP." };
    }

    const verifiedToken = jwt.sign(
      {
        UserID: data.UserID,
        Username: data.Username,
        purpose: PASSWORD_RESET_VERIFIED_PURPOSE,
      },
      process.env.JWT_SECRET,
      { expiresIn: "10m" },
    );

    return {
      success: true,
      message: "OTP verified successfully",
      verifiedToken,
    };
  } catch (error) {
    console.log("Verify Forgot Password OTP Error:", error.message);
    return {
      success: false,
      statusCode: 503,
      message: "Unable to verify OTP right now. Please try again later.",
    };
  }
};
// ============================================================Reset Password
const resetPassword = async (data) => {
  let client;
  try {
    if (!data.UserID || !data.Username) {
      return { success: false, message: "Invalid verified reset token" };
    }

    client = await pool.connect();
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT UserID, Username, PasswordHash FROM user_master
       WHERE UserID = $1
         AND Username = $2
         AND IsActive = TRUE AND IsDeleted = FALSE
         AND COALESCE(IsLocked, FALSE) = FALSE
       LIMIT 1 FOR UPDATE;`,
      [data.UserID, data.Username],
    );
    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return {
        success: false,
        message: "User account is unavailable for password reset",
      };
    }

    const user = userResult.rows[0];

    const newPasswordHash = await bcrypt.hash(data.NewPassword, 10);
    await client.query(
      `UPDATE user_master
       SET PasswordHash = $1,
           LastPasswordChangedDate = CURRENT_TIMESTAMP,
           PasswordExpiryDate = CURRENT_TIMESTAMP + INTERVAL '90 days',
           ModifiedBy = $2, ModifiedDate = CURRENT_TIMESTAMP
       WHERE UserID = $2;`,
      [newPasswordHash, user.userid],
    );
    await client.query("COMMIT");
    return { success: true, message: "Password reset successfully" };
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.log("Reset Password Error:", error.message);
    return {
      success: false,
      statusCode: 503,
      message: "Unable to reset password right now. Please try again later.",
    };
  } finally {
    if (client) client.release();
  }
};

// ============================================================
// Logout
// ============================================================

const logout = async (data) => {
  try {

    const {
      UserID,
      JTI,
      TokenIssuedAt,
      TokenExpiresAt,
      DeviceID,
      RevokedBy,
      RevocationReason,
    } = data;

    // ========================================================
    // Validate Authentication
    // ========================================================

    if (!UserID) {
      return {
        success: false,
        statusCode: 401,
        message: "Authentication token is required",
      };
    }

    if (!JTI) {
      return {
        success: false,
        statusCode: 401,
        message: "Invalid authentication token",
      };
    }

    if (!TokenIssuedAt || !TokenExpiresAt) {
      return {
        success: false,
        statusCode: 401,
        message: "Invalid authentication token",
      };
    }

    // ========================================================
    // Blacklist Current JWT
    // ========================================================

    await pool.query(
      `
      INSERT INTO auth_token_blacklist
      (
        UserID,
        JTI,
        TokenIssuedAt,
        TokenExpiresAt,
        RevokedAt,
        RevokedBy,
        RevocationReason,
        DeviceID,
        IsActive,
        CreatedDate
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        CURRENT_TIMESTAMP,
        $5,
        $6,
        $7,
        TRUE,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT (JTI)
      DO UPDATE SET
        IsActive = TRUE,
        RevokedAt = CURRENT_TIMESTAMP,
        RevokedBy = EXCLUDED.RevokedBy,
        RevocationReason = EXCLUDED.RevocationReason,
        DeviceID = EXCLUDED.DeviceID;
      `,
      [
        UserID,
        JTI,
        TokenIssuedAt,
        TokenExpiresAt,
        RevokedBy || UserID,
        RevocationReason || "LOGOUT",
        DeviceID || null,
      ]
    );

    // ========================================================
    // Deactivate Current Device
    // ========================================================

    if (DeviceID) {

      await pool.query(
        `
        UPDATE user_device
        SET
          IsActive = FALSE,
          ModifiedBy = $1,
          ModifiedDate = CURRENT_TIMESTAMP
        WHERE UserID = $1
          AND DeviceID = $2
          AND IsDeleted = FALSE;
        `,
        [
          UserID,
          DeviceID,
        ]
      );

    }

    // ========================================================
    // Logout Successful
    // ========================================================

    return {
      success: true,
      message: "Logout successful",
    };

  } catch (error) {

    console.log(
      "Logout Error:",
      error.message
    );

    return {
      success: false,
      statusCode: 503,
      message: "Unable to logout right now. Please try again later.",
    };
  }
};

module.exports = {
  login,
  logout,
  changePassword,
  forgotPassword,
  verifyForgotPasswordOTP,
  resetPassword,
};
