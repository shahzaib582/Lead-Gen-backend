const SAMPLE_KEYS = ['subject', 'body', 'html', 'text'];
const MAX_SAMPLES = 30;
const MAX_SUBJECT_LEN = 500;
const MAX_BODY_LEN = 50_000;

function assertMailTemplateSamplesValid(value) {
  if (value === undefined || value === null) return;

  if (!Array.isArray(value)) {
    throw new Error('mail_template_samples must be an array.');
  }
  if (value.length > MAX_SAMPLES) {
    throw new Error(`mail_template_samples must have at most ${MAX_SAMPLES} items.`);
  }

  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`mail_template_samples[${i}] must be an object.`);
    }
    const keys = Object.keys(item);
    for (const k of keys) {
      if (!SAMPLE_KEYS.includes(k)) {
        throw new Error(`mail_template_samples[${i}] has invalid field "${k}". Allowed: ${SAMPLE_KEYS.join(', ')}.`);
      }
      const v = item[k];
      if (v != null && typeof v !== 'string') {
        throw new Error(`mail_template_samples[${i}].${k} must be a string or null.`);
      }
      if (k === 'subject' && v != null && v.length > MAX_SUBJECT_LEN) {
        throw new Error(`mail_template_samples[${i}].subject must be at most ${MAX_SUBJECT_LEN} characters.`);
      }
      if ((k === 'body' || k === 'html' || k === 'text') && v != null && v.length > MAX_BODY_LEN) {
        throw new Error(`mail_template_samples[${i}].${k} must be at most ${MAX_BODY_LEN} characters.`);
      }
    }
    const hasContent = SAMPLE_KEYS.some((k) => {
      const v = item[k];
      return typeof v === 'string' && v.trim().length > 0;
    });
    if (!hasContent) {
      throw new Error(`mail_template_samples[${i}] must include at least one non-empty subject, body, html, or text field.`);
    }
  }
}

/**
 * @param {unknown} samples - JSON array from DB or API
 * @returns {string|null}
 */
function formatMailTemplateSamplesForPrompt(samples) {
  if (samples == null) return null;
  const arr = Array.isArray(samples) ? samples : [];
  if (arr.length === 0) return null;

  const blocks = arr.map((raw, i) => {
    const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const lines = [`### Sample ${i + 1}`];
    if (typeof s.subject === 'string' && s.subject.trim()) lines.push(`Subject: ${s.subject.trim()}`);
    if (typeof s.body === 'string' && s.body.trim()) lines.push(`Body:\n${s.body}`);
    if (typeof s.html === 'string' && s.html.trim()) lines.push(`HTML:\n${s.html}`);
    if (typeof s.text === 'string' && s.text.trim()) lines.push(`Plain text:\n${s.text}`);
    return lines.join('\n');
  });

  return blocks.join('\n\n');
}

module.exports = {
  SAMPLE_KEYS,
  assertMailTemplateSamplesValid,
  formatMailTemplateSamplesForPrompt,
};
