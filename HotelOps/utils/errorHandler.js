const STATUS_CODES = require("./statusCodes");

const handleError = (error, res) => {

    console.error("Error :", error);

    return res
        .status(error.statusCode || STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({

            success: false,

            message: error.message || "Internal Server Error"

        });

};

module.exports = handleError;