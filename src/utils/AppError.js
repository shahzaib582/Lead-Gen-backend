class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   * @param {string} [code]  machine-readable code (e.g. TOKEN_EXPIRED)
   */
  constructor(message, statusCode, code) {
    super(message);

    this.statusCode = statusCode || 500;
    this.status = String(this.statusCode).startsWith('4') ? 'fail' : 'error';

    this.isOperational = true;
    if (code !== undefined) this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
