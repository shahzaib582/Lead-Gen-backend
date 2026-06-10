const { recordEmailOpen } = require('../services/emailOpenTrackingService');

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

async function openPixel(req, res) {
  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
  });

  void recordEmailOpen(req.params.token).catch(() => {});

  return res.status(200).send(TRANSPARENT_GIF);
}

module.exports = { openPixel };
