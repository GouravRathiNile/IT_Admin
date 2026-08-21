const multer = require("multer");
const STATUS_CODES = require("../utils/statusCodes");

const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) return callback(new Error("Only JPG, PNG, and PDF attachments are allowed."));
    callback(null, true);
  },
}).single("Attachment");

const guestGlitchUpload = (req, res, next) => upload(req, res, (error) => {
  if (!error) return next();
  const message = error.code === "LIMIT_FILE_SIZE"
    ? "Attachment must not exceed 10 MB."
    : error.message || "Invalid attachment.";
  return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message });
});

module.exports = guestGlitchUpload;
