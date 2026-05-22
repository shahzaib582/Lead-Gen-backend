const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');
const userService = require('./userService');
const {
  getStorageBucket,
  buildProfileImageObjectPath,
  getPublicObjectUrl,
  objectPathFromPublicUrl,
  extensionForMime,
  ALLOWED_PROFILE_IMAGE_MIME,
} = require('../config/storage');

function assertValidImageFile(file) {
  if (!file || !file.buffer?.length) {
    throw new AppError('Image file is required. Use multipart field name "image".', 422);
  }
  if (!ALLOWED_PROFILE_IMAGE_MIME.has(file.mimetype)) {
    throw new AppError('Image must be JPEG, PNG, or WebP.', 422);
  }
  const ext = extensionForMime(file.mimetype);
  if (!ext) throw new AppError('Unsupported image type.', 422);
  return ext;
}

async function removeStorageObjects(userId, paths) {
  const bucket = getStorageBucket();
  const toRemove = [...new Set(paths.filter(Boolean))];
  if (!toRemove.length) return;

  const { error } = await supabase.storage.from(bucket).remove(toRemove);
  if (error) {
    throw new AppError(error.message || 'Failed to remove old profile image from storage.', 500);
  }
}

async function removeAllAvatarObjectsForUser(userId) {
  const bucket = getStorageBucket();
  const { data: listed, error: listErr } = await supabase.storage.from(bucket).list(userId, { limit: 50 });
  if (listErr) return;

  const paths = (listed || [])
    .filter((f) => f.name && f.name.startsWith('avatar.'))
    .map((f) => `${userId}/${f.name}`);
  await removeStorageObjects(userId, paths);
}

/**
 * Upload profile image to Supabase Storage and save public URL on users.profile_pic.
 * Replaces any previous avatar file in the bucket for this user.
 *
 * @param {string} userId
 * @param {{ buffer: Buffer, mimetype: string, originalname?: string }} file
 */
async function uploadProfileImage(userId, file) {
  const ext = assertValidImageFile(file);
  const bucket = getStorageBucket();
  const objectPath = buildProfileImageObjectPath(userId, ext);

  const user = await userService.findUserById(userId);
  if (!user) throw new AppError('User not found.', 404);

  const oldPath = objectPathFromPublicUrl(user.profile_pic);
  await removeAllAvatarObjectsForUser(userId);

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: true,
    cacheControl: '3600',
  });

  if (uploadErr) {
    throw new AppError(uploadErr.message || 'Failed to upload profile image.', 500);
  }

  const publicUrl = getPublicObjectUrl(objectPath);
  const updated = await userService.setProfilePicUrl(userId, publicUrl);

  if (oldPath && oldPath !== objectPath) {
    await removeStorageObjects(userId, [oldPath]).catch(() => {});
  }

  return updated;
}

/**
 * Remove profile image from storage and clear users.profile_pic.
 */
async function deleteProfileImage(userId) {
  const user = await userService.findUserById(userId);
  if (!user) throw new AppError('User not found.', 404);

  const oldPath = objectPathFromPublicUrl(user.profile_pic);
  await removeAllAvatarObjectsForUser(userId);
  if (oldPath) {
    await removeStorageObjects(userId, [oldPath]);
  }

  return userService.setProfilePicUrl(userId, null);
}

module.exports = {
  uploadProfileImage,
  deleteProfileImage,
};
