/**
 * Stable JSON shape for `user` in API responses (camelCase).
 * @param {Record<string, unknown>} row -- users table row from Supabase
 */
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    isVerified: row.is_verified,
    createdAt: row.created_at,
    name: row.name ?? null,
    profilePic: row.profile_pic ?? null,
    address: row.address ?? null,
    contact: row.contact ?? null,
    timezone: row.timezone ?? null,
    notificationsEnabled: row.notifications_enabled !== false,
    role: row.role || 'user',
  };
}

module.exports = { toPublicUser };
