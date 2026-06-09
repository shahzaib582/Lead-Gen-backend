/**
 * Apply campaign sender fields to template text and append a signature block.
 */

function normalizeLine(line) {
  return String(line || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function linesMatch(a, b) {
  const na = normalizeLine(a);
  const nb = normalizeLine(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (da.length >= 8 && db.length >= 8 && da === db) return true;
  return na.includes(nb) || nb.includes(na);
}

function signatureLinesFromCampaign(campaign) {
  const lines = [];
  const name = campaign.sender_display_name ? String(campaign.sender_display_name).trim() : '';
  const address = campaign.sender_address ? String(campaign.sender_address).trim() : '';
  const phone = campaign.sender_phone ? String(campaign.sender_phone).trim() : '';
  if (name) lines.push(name);
  if (address) lines.push(address);
  if (phone) lines.push(phone);
  return lines;
}

/**
 * True when the last non-empty lines of the body match the campaign signature lines in order.
 */
function bodyEndsWithSignatureLines(body, signatureLines) {
  if (!signatureLines.length) return false;

  const bodyLines = String(body || '')
    .trimEnd()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (bodyLines.length < signatureLines.length) return false;

  let bodyIdx = bodyLines.length - 1;
  for (let sigIdx = signatureLines.length - 1; sigIdx >= 0; sigIdx -= 1) {
    while (bodyIdx >= 0 && (bodyLines[bodyIdx] === '--' || bodyLines[bodyIdx] === '—')) {
      bodyIdx -= 1;
    }
    if (bodyIdx < 0 || !linesMatch(bodyLines[bodyIdx], signatureLines[sigIdx])) {
      return false;
    }
    bodyIdx -= 1;
  }
  return true;
}

/**
 * Remove a trailing `--` + duplicate signature when the body already ends with the same lines.
 */
function stripDuplicateTrailingSignature(body, signatureLines) {
  if (!signatureLines.length) return body;

  let text = String(body || '').trimEnd();
  const sigBlock = signatureLines.join('\n');
  const withSeparator = `--\n${sigBlock}`;

  while (text.endsWith(withSeparator)) {
    const before = text.slice(0, -withSeparator.length).trimEnd();
    if (bodyEndsWithSignatureLines(before, signatureLines)) {
      text = before;
      continue;
    }
    break;
  }

  return text;
}

function applySenderPlaceholders(text, campaign) {
  if (!text) return '';
  const name = campaign.sender_display_name ? String(campaign.sender_display_name).trim() : '';
  const address = campaign.sender_address ? String(campaign.sender_address).trim() : '';
  const phone = campaign.sender_phone ? String(campaign.sender_phone).trim() : '';

  let out = text
    .replace(/\[Your Name\]/gi, name)
    .replace(/\[your name\]/gi, name)
    .replace(/\{\{\s*yourName\s*\}\}/gi, name)
    .replace(/\{\{\s*senderName\s*\}\}/gi, name)
    .replace(/\{\{\s*sender_name\s*\}\}/gi, name);

  if (address) {
    out = out.replace(/\[Your Address\]/gi, address).replace(/\{\{\s*senderAddress\s*\}\}/gi, address);
  }
  if (phone) {
    out = out.replace(/\[Your Phone\]/gi, phone).replace(/\{\{\s*senderPhone\s*\}\}/gi, phone);
  }

  return out;
}

function appendCampaignSignature(body, campaign) {
  const lines = signatureLinesFromCampaign(campaign);
  if (lines.length === 0) return body;
  return `${body}\n\n--\n${lines.join('\n')}`;
}

function finalizeOutboundBody(body, campaign) {
  const signatureLines = signatureLinesFromCampaign(campaign);
  let text = applySenderPlaceholders(body, campaign);
  text = stripDuplicateTrailingSignature(text, signatureLines);

  if (bodyEndsWithSignatureLines(text, signatureLines)) {
    return text;
  }

  return appendCampaignSignature(text, campaign);
}

module.exports = {
  applySenderPlaceholders,
  appendCampaignSignature,
  finalizeOutboundBody,
  signatureLinesFromCampaign,
  bodyEndsWithSignatureLines,
  stripDuplicateTrailingSignature,
};
