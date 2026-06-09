/**
 * Parse a plain-text mail template with optional leading "Subject:" line.
 * @param {string|null|undefined} template
 * @returns {{ subject: string, body: string }}
 */
function parseMailTemplate(template) {
  if (!template) return { subject: 'Hello', body: '' };

  const lines = template.split('\n');
  let subject = null;
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.toLowerCase().startsWith('subject:')) {
      subject = trimmed.slice('subject:'.length).trim();
      bodyStart = i + 1;
      break;
    }
  }

  while (bodyStart < lines.length && lines[bodyStart].trim() === '') {
    bodyStart++;
  }

  const body = lines.slice(bodyStart).join('\n').trim();

  return {
    subject: subject || 'Reaching out',
    body,
  };
}

module.exports = { parseMailTemplate };
