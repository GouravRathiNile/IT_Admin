class AppError extends Error {
    constructor(message, statusCode, errors = undefined) {
        super(message);

        this.statusCode = statusCode;
        this.status = "error";
        this.errors = errors;

        Error.captureStackTrace(this, this.constructor);

    }

}

module.exports = AppError;
