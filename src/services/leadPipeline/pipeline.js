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
var pipeline_exports = {};
__export(pipeline_exports, {
  isPersonalEmail: () => isPersonalEmail,
  runPipeline: () => runPipeline
});
module.exports = __toCommonJS(pipeline_exports);
var import_client_categories = require("./clientCategories");
var import_hunter = require("./hunter");
var import_lead = require("./lead");
var import_scoring = require("./scoring");
const isPersonalEmail = (email) => {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && import_client_categories.PERSONAL_EMAIL_DOMAINS.includes(domain);
};
const stripInternal = (row) => {
  const { dedupe_key: _dedupe, ...safe } = row;
  return safe;
};
const runPipeline = async (input) => {
  const now = input.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const stats = {
    found: input.people.length,
    inserted: 0,
    updated: 0,
    already_verified: 0,
    verified_by_apollo: 0,
    verified_by_hunter: 0,
    rejected_no_email: 0,
    rejected_personal_email: 0,
    rejected_unverified: 0,
    rejected_hunter_error: 0,
    hunter_calls: 0
  };
  const warnings = [];
  const leads = [];
  const seen = /* @__PURE__ */ new Set();
  let hunterDisabled = false;
  if (!input.hunter) {
    warnings.push(
      "Hunter is not configured: only emails Apollo already marks as verified can be saved."
    );
  }
  const verify = async (lead) => {
    const apolloStatus = lead.metadata.apollo_email_status ?? null;
    if (lead.email && apolloStatus === "verified") {
      return { ok: true, email: lead.email, by: "apollo" };
    }
    let hunterFailed = false;
    if (input.hunter && !hunterDisabled) {
      try {
        let email = lead.email;
        if (!email) {
          const params = {};
          if (lead.first_name) params.first_name = lead.first_name;
          if (lead.last_name) params.last_name = lead.last_name;
          if (lead.company_domain) params.domain = lead.company_domain;
          else if (lead.company_name) params.company = lead.company_name;
          if (params.first_name && params.last_name && (params.domain || params.company)) {
            stats.hunter_calls++;
            const found = await input.hunter.find(params);
            if (found.email) email = found.email.toLowerCase();
          }
        }
        if (email && !isPersonalEmail(email)) {
          stats.hunter_calls++;
          const result = await input.hunter.verify(email);
          if (result.status === "verified") {
            return {
              ok: true,
              email: (result.email ?? email).toLowerCase(),
              by: "hunter",
              hunter: result
            };
          }
        }
      } catch (err) {
        hunterFailed = true;
        if (err instanceof import_hunter.HunterError) {
          if (err.kind === "authentication" || err.kind === "rate_limit") {
            hunterDisabled = true;
            warnings.push(`Hunter ${err.kind} error: remaining leads skipped.`);
          } else {
            warnings.push(`Hunter ${err.kind} error for one lead: skipped.`);
          }
        } else {
          warnings.push("Hunter lookup failed for one lead: skipped.");
        }
      }
    }
    if (hunterFailed) return { ok: false, reason: "hunter_error" };
    return { ok: false, reason: lead.email ? "unverified" : "no_email" };
  };
  for (const person of input.people) {
    let fitScore = null;
    let fitReason = null;
    if (input.categoryConfig) {
      const scored = (0, import_scoring.scoreLead)(
        {
          job_title: typeof person.title === "string" ? person.title : null,
          seniority: typeof person.seniority === "string" ? person.seniority : null,
          industry: typeof person.organization?.industry === "string" ? person.organization.industry : null,
          org_keywords: person.organization?.keywords ?? null,
          location: [person.state, person.country].filter(Boolean).join(", ") || null,
          employee_count: typeof person.organization?.estimated_num_employees === "number" ? person.organization.estimated_num_employees : null
        },
        input.categoryConfig,
        input.targetLocations
      );
      fitScore = scored.score;
      fitReason = scored.fit_reason;
    }
    const lead = (0, import_lead.normalizeLead)(
      person,
      input.campaignId,
      input.leadType,
      input.targetSegment,
      fitScore,
      fitReason,
      input.leadClass
    );
    if (seen.has(lead.dedupe_key)) continue;
    seen.add(lead.dedupe_key);
    if (isPersonalEmail(lead.email)) {
      stats.rejected_personal_email++;
      continue;
    }
    const existing = await input.repo.findExisting(lead);
    if (existing && existing.email_verification_status === "verified" && existing.email) {
      stats.already_verified++;
      leads.push(stripInternal(existing));
      continue;
    }
    const verdict = await verify(lead);
    if (!verdict.ok) {
      if (verdict.reason === "no_email") stats.rejected_no_email++;
      else if (verdict.reason === "personal_email") stats.rejected_personal_email++;
      else if (verdict.reason === "hunter_error") stats.rejected_hunter_error++;
      else stats.rejected_unverified++;
      continue;
    }
    if (verdict.by === "apollo") stats.verified_by_apollo++;
    else stats.verified_by_hunter++;
    lead.email = verdict.email;
    lead.email_verification_status = "verified";
    lead.metadata = {
      ...lead.metadata,
      verification: {
        verified_by: verdict.by,
        verified_at: now(),
        ...verdict.hunter ? {
          hunter: {
            status: verdict.hunter.status,
            score: verdict.hunter.score,
            request_type: verdict.hunter.request_type
          }
        } : {}
      }
    };
    const saved = await input.repo.save(lead, existing);
    if (saved.kind === "inserted") stats.inserted++;
    else stats.updated++;
    leads.push(stripInternal(saved.row));
  }
  const unsaved = stats.rejected_no_email + stats.rejected_personal_email + stats.rejected_unverified + stats.rejected_hunter_error;
  if (unsaved > 0) {
    warnings.push(
      `${unsaved} of ${stats.found} Apollo results were not saved because no verified email was found.`
    );
  }
  return { leads, stats, warnings };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isPersonalEmail,
  runPipeline
});
