const multer = require("multer");
const STATUS_CODES = require("../utils/statusCodes");

const upload = multer({
  storage: multer.memoryStorage(),
}).array("Documents", 10);

const capexUpload = (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) return next();

    const message = error.code === "LIMIT_UNEXPECTED_FILE"
      ? "A maximum of 10 documents is allowed in the Documents field."
      : error.message || "Invalid CAPEX documents.";

    return res.status(STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message,
    });
  });
};

module.exports = capexUpload;
