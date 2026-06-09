/**
 * Shared leads_data query helpers for campaign assignment.
 */

function applyLeadSourceFilter(query, leadSource) {
  const source = leadSource || 'both';
  if (source === 'new') {
    return query.or('outreachStatus.is.null,outreachStatus.eq.""');
  }
  if (source === 'old') {
    return query.not('outreachStatus', 'is', null).neq('outreachStatus', '');
  }
  return query;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  applyLeadSourceFilter,
  shuffleInPlace,
};
