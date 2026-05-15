const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const AppError = require('../utils/AppError');

const BCRYPT_ROUNDS = 12; // higher than OTP hashing — passwords deserve extra rounds

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

async function createUser(email, password) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data, error } = await supabase
    .from('users')
    .insert({
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
    })
    .select()
    .single();

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
