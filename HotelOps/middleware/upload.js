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
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.ms-excel.template.macroenabled.12",
  "application/vnd.ms-excel.addin.macroenabled.12",
  "text/csv",
]);

const upload = multer({
  storage,

  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },

  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || "").toLowerCase();
    const isAllowedImage = mimeType.startsWith("image/");

    if (!isAllowedImage && !allowedTypes.has(mimeType)) {
      return callback(
        new Error("Only image, PDF, Excel, and CSV attachments are allowed.")
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
        ? "Attachment must not exceed 50 MB."
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
