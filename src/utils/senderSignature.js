/**
 * Apply campaign sender fields to template text and append a signature block.
 */

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
  const lines = [];
  const name = campaign.sender_display_name ? String(campaign.sender_display_name).trim() : '';
  const address = campaign.sender_address ? String(campaign.sender_address).trim() : '';
  const phone = campaign.sender_phone ? String(campaign.sender_phone).trim() : '';

  if (name) lines.push(name);
  if (address) lines.push(address);
  if (phone) lines.push(phone);

  if (lines.length === 0) return body;
  return `${body}\n\n--\n${lines.join('\n')}`;
}

function finalizeOutboundBody(body, campaign) {
  return appendCampaignSignature(applySenderPlaceholders(body, campaign), campaign);
}

module.exports = {
  applySenderPlaceholders,
  appendCampaignSignature,
  finalizeOutboundBody,
};
