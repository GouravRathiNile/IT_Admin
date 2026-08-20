// const multer = require("multer");

// const storage = multer.memoryStorage();

// const upload = multer({
//     storage
// });

// module.exports = upload;

const multer = require("multer");
const STATUS_CODES = require("../utils/statusCodes");

const storage = multer.memoryStorage();

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const upload = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (_req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      return callback(
        new Error("Only JPG, PNG, and PDF attachments are allowed.")
      );
    }

    callback(null, true);
  },
});

const guestGlitchUpload = (req, res, next) => {
  upload.single("Attachment")(req, res, (error) => {
    if (!error) {
      return next();
    }

    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Attachment must not exceed 10 MB."
        : error.message || "Invalid attachment.";

    return res.status(STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message,
    });
  });
};

// Keep existing routes working
module.exports = upload;

// Make Guest Glitch middleware available from the same file
module.exports.guestGlitchUpload = guestGlitchUpload;