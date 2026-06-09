const multer = require('multer');
const AppError = require('../utils/AppError');
const { MAX_PROFILE_IMAGE_BYTES, ALLOWED_PROFILE_IMAGE_MIME } = require('../config/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_PROFILE_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_PROFILE_IMAGE_MIME.has(file.mimetype)) {
      return cb(new AppError('Image must be JPEG, PNG, or WebP.', 422));
    }
    cb(null, true);
  },
});

function uploadProfileImageMiddleware(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Image must be 10 MB or smaller.', 413));
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new AppError('Use multipart field name "image" for the file.', 422));
      }
      return next(new AppError(err.message || 'Invalid upload.', 400));
    }

    return next(err);
  });
}

module.exports = { uploadProfileImageMiddleware };
