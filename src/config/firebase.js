const admin = require('firebase-admin');
const logger = require('../utils/logger');

function isFirebaseConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

function loadPrivateKey() {
  const raw = process.env.FIREBASE_PRIVATE_KEY;
  if (!raw) return null;
  return String(raw).replace(/\\n/g, '\n');
}

/**
 * @returns {import('firebase-admin').app.App | null}
 */
function getFirebaseApp() {
  if (!isFirebaseConfigured()) return null;
  if (admin.apps.length > 0) return admin.apps[0];

  try {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: loadPrivateKey(),
      }),
    });
  } catch (err) {
    logger.error('[Firebase] initializeApp failed', { error: err.message });
    return null;
  }
}

/**
 * @returns {import('firebase-admin/messaging').Messaging | null}
 */
function getMessaging() {
  const app = getFirebaseApp();
  if (!app) return null;
  return admin.messaging(app);
}

module.exports = {
  isFirebaseConfigured,
  getFirebaseApp,
  getMessaging,
};
