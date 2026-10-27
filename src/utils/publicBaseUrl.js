function getPublicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL;
  if (raw && String(raw).trim()) {
    return String(raw).trim().replace(/\/$/, '');
  }

  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

module.exports = { getPublicBaseUrl };
