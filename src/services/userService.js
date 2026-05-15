const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');

const BCRYPT_ROUNDS = 12; // higher than OTP hashing — passwords deserve extra rounds

const PROFILE_MAX = {
  name: 200,
  profile_pic: 2048,
  address: 500,
  contact: 120,
};

function trimProfileField(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

// ─── Find ─────────────────────────────────────────────────────────────────────

async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error) throw new AppError('Database error', 500);
  return data; // null if not found
}

async function findUserById(id) {
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();

  if (error) throw new AppError('Database error', 500);
  return data;
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Email/password signup — always creates `role` via DB default (`user`). Never pass `role` from clients.
 * @param {{ name?: string, profile_pic?: string, address?: string, contact?: string }} [profile]
 */
async function createUser(email, password, profile = {}) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const row = {
    email: email.toLowerCase().trim(),
    password_hash: passwordHash,
  };

  const name = trimProfileField(profile.name, PROFILE_MAX.name);
  const profilePic = trimProfileField(profile.profile_pic, PROFILE_MAX.profile_pic);
  const address = trimProfileField(profile.address, PROFILE_MAX.address);
  const contact = trimProfileField(profile.contact, PROFILE_MAX.contact);
  if (name != null) row.name = name;
  if (profilePic != null) row.profile_pic = profilePic;
  if (address != null) row.address = address;
  if (contact != null) row.contact = contact;

  const { data, error } = await supabase.from('users').insert(row).select().single();

  if (error) {
    console.log('Supabase createUser error:', error); // 👈 DEBUG

    if (error.code === '23505') {
      throw new AppError('An account with this email already exists.', 409);
    }

    throw new AppError(error.message || 'Failed to create user', 500);
  }

  return data;
}

// ─── Update ───────────────────────────────────────────────────────────────────

async function markUserVerified(userId) {
  const { error } = await supabase.from('users').update({ is_verified: true }).eq('id', userId);

  if (error) throw new AppError('Failed to verify user', 500);
}

async function updatePassword(userId, plainPassword) {
  const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);

  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', userId);

  if (error) throw new AppError('Failed to update password.', 500);
}

// ─── Password ─────────────────────────────────────────────────────────────────

async function checkPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

// ─── Google OAuth helpers ─────────────────────────────────────────────────────

async function findOrCreateGoogleUser({ email }) {
  return findUserByEmail(email);
}

async function updateAuthProvider(userId, provider) {
  const { error } = await supabase
    .from('users')
    .update({ auth_provider: provider })
    .eq('id', userId);
  if (error) throw new AppError('Failed to update auth provider', 500);
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  markUserVerified,
  updatePassword,
  checkPassword,
  findOrCreateGoogleUser,
  updateAuthProvider,
};
