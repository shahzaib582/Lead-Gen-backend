const MAX_PROFILE_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED_PROFILE_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function getStorageBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET || 'lead_generation_bucket';
}

function extensionForMime(mime) {
  return MIME_TO_EXT[mime] || null;
}

function buildProfileImageObjectPath(userId, ext) {
  return `${userId}/avatar.${ext}`;
}

/**
 * Public URL for a path in the configured bucket.
 * @param {string} objectPath
 */
function getPublicObjectUrl(objectPath) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const bucket = getStorageBucket();
  const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}

/**
 * Extract storage object path from a Supabase public URL for this bucket, or null.
 * @param {string | null | undefined} url
 */
function objectPathFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const bucket = getStorageBucket();
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

module.exports = {
  MAX_PROFILE_IMAGE_BYTES,
  ALLOWED_PROFILE_IMAGE_MIME,
  extensionForMime,
  getStorageBucket,
  buildProfileImageObjectPath,
  getPublicObjectUrl,
  objectPathFromPublicUrl,
};
