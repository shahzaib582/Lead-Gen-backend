/**
 * Replace {{firstName}}, {{fullName}}, {{email}} in template text.
 * @param {string} text
 * @param {{ firstName?: string|null, fullName?: string|null, email?: string|null }} leadInfo
 * @returns {string}
 */
function applyTemplatePlaceholders(text, leadInfo = {}) {
  if (!text) return '';
  const firstName = leadInfo.firstName != null ? String(leadInfo.firstName) : '';
  const fullName = leadInfo.fullName != null ? String(leadInfo.fullName) : '';
  const email = leadInfo.email != null ? String(leadInfo.email) : '';

  return text
    .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
    .replace(/\{\{\s*fullName\s*\}\}/gi, fullName)
    .replace(/\{\{\s*email\s*\}\}/gi, email);
}

module.exports = { applyTemplatePlaceholders };
