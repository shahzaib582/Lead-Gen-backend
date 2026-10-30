var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var scoring_exports = {};
__export(scoring_exports, {
  scoreLead: () => scoreLead
});
module.exports = __toCommonJS(scoring_exports);
const SENIORITY_SCORES = {
  owner: 20,
  founder: 20,
  c_suite: 20,
  vp: 15,
  director: 10,
  manager: 5,
  senior: 3,
  entry: 0
};
const SENIORITY_MAP = {
  owner: "owner",
  founder: "founder",
  c_suite: "c_suite",
  c_level: "c_suite",
  cxo: "c_suite",
  vp: "vp",
  "vice president": "vp",
  director: "director",
  manager: "manager",
  senior: "senior",
  "mid-level": "entry",
  junior: "entry",
  entry: "entry"
};
const normalise = (s) => s?.trim().toLowerCase() ?? "";
function isInsideEmployeeRanges(count, ranges) {
  if (count === null || count === void 0) return false;
  return ranges.some((range) => {
    const [minStr, maxStr] = range.split(",");
    const min = parseInt(minStr ?? "0", 10);
    const max = parseInt(maxStr ?? "999999", 10);
    return count >= min && count <= max;
  });
}
function isInsideLocations(location, targets) {
  if (!location) return false;
  const loc = normalise(location);
  return targets.some((t) => {
    const target = normalise(t);
    return loc.includes(target) || target.includes(loc);
  });
}
function scoreLead(input, config, targetLocations) {
  let score = 0;
  const reasons = [];
  const jobTitleNorm = normalise(input.job_title);
  const matchedTitle = config.titles.find((t) => normalise(t) === jobTitleNorm);
  if (matchedTitle) {
    score += 40;
    reasons.push(`title "${matchedTitle}"`);
  }
  const seniorityNorm = normalise(input.seniority);
  const tier = SENIORITY_MAP[seniorityNorm] ?? null;
  const seniorityPoints = tier ? SENIORITY_SCORES[tier] ?? 0 : 0;
  if (seniorityPoints > 0) {
    score += seniorityPoints;
    if (!matchedTitle) reasons.push(`seniority "${input.seniority}"`);
  }
  const industryNorm = normalise(input.industry);
  const matchedIndustry = config.industries.find(
    (i) => normalise(i) === industryNorm || industryNorm.includes(normalise(i))
  );
  const keywordsToCheck = config.keywords;
  const orgKeywordNorms = (input.org_keywords ?? []).map(normalise);
  const matchedKeyword = keywordsToCheck.find(
    (kw) => orgKeywordNorms.some((ok) => ok.includes(normalise(kw)))
  );
  if (matchedIndustry || matchedKeyword) {
    score += 20;
    if (matchedIndustry) reasons.push(`industry "${matchedIndustry}"`);
    else if (matchedKeyword) reasons.push(`keyword "${matchedKeyword}"`);
  }
  if (isInsideLocations(input.location, targetLocations)) {
    score += 10;
    reasons.push(`location "${input.location}"`);
  }
  const effectiveRanges = config.employee_ranges ?? ["11,50", "51,200", "201,500"];
  if (isInsideEmployeeRanges(input.employee_count, effectiveRanges)) {
    score += 10;
  }
  const fit_reason = reasons.length > 0 ? `Matched on ${reasons.join(", ")} for ${config.label}.` : `No strong signal matched for ${config.label}.`;
  return { score: Math.min(score, 100), fit_reason };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  scoreLead
});
