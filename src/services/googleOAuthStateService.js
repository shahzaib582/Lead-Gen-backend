const crypto = require('crypto');
const connection = require('../queues/connection');
const AppError = require('../utils/AppError');

const COOKIE = 'leadgen_google_oauth';
const MAX_AGE = 600;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/google',
  };
}

async function createOAuthState(res) {
  const state = crypto.randomBytes(32).toString('hex');
  const browserSecret = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(browserSecret).digest('hex');
  await connection.set(`google_oauth:${state}`, hash, 'EX', MAX_AGE);
  res.cookie(COOKIE, browserSecret, { ...cookieOptions(), maxAge: MAX_AGE * 1000 });
  return state;
}

async function consumeOAuthState(req, res) {
  const state = req.query.state;
  const cookies = String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim());
  const secret = cookies.find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (
    typeof state !== 'string' ||
    !/^[a-f0-9]{64}$/.test(state) ||
    !secret ||
    !/^[a-f0-9]{64}$/.test(secret)
  ) {
    throw new AppError('Invalid or expired Google OAuth state. Start sign-in again.', 400);
  }
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  // Compare and consume atomically; a callback cannot be replayed across API replicas.
  const consumed = await connection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    `google_oauth:${state}`,
    hash
  );
  if (!consumed)
    throw new AppError('Invalid or expired Google OAuth state. Start sign-in again.', 400);
  res.clearCookie(COOKIE, cookieOptions());
}

module.exports = { createOAuthState, consumeOAuthState };
