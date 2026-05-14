function needsTemplateJob(lead) {
  if (lead.status !== 'pending') return false;
  const mt = lead.mail_template;
  if (mt == null) return true;
  return String(mt).trim() === '';
}

module.exports = {
  needsTemplateJob,
};
