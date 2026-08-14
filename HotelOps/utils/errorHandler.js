const STATUS_CODES = require("./statusCodes");

const handleError = (error, res) => {

    console.error("Error :", error);

    const payload = {
        success: false,
        message: error.message || "Internal Server Error"
    };

    if (Array.isArray(error.errors) && error.errors.length > 0) {
        payload.errors = error.errors;
    }

    return res
        .status(error.statusCode || STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json(payload);

};

module.exports = handleError;
