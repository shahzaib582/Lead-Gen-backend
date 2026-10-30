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
var clientCategories_exports = {};
__export(clientCategories_exports, {
  DEFAULT_EMPLOYEE_RANGES: () => DEFAULT_EMPLOYEE_RANGES,
  DEFAULT_LOCATIONS: () => DEFAULT_LOCATIONS,
  ENTITY_CONFIG: () => ENTITY_CONFIG,
  GLOBAL_EXCLUDED_DOMAINS: () => GLOBAL_EXCLUDED_DOMAINS,
  LEAD_CLASS_DEFAULTS: () => LEAD_CLASS_DEFAULTS,
  PERSONAL_EMAIL_DOMAINS: () => PERSONAL_EMAIL_DOMAINS,
  buildApolloParamsForCategory: () => buildApolloParamsForCategory,
  formatTargetSegment: () => formatTargetSegment,
  getCategoryConfig: () => getCategoryConfig,
  parseTargetSegment: () => parseTargetSegment,
  requireCategoryConfig: () => requireCategoryConfig
});
module.exports = __toCommonJS(clientCategories_exports);
const DEFAULT_LOCATIONS = [
  "Arizona, United States",
  "New Mexico, United States",
  "Nevada, United States",
  "Texas, United States",
  "California, United States"
];
const DEFAULT_EMPLOYEE_RANGES = ["11,50", "51,200", "201,500"];
const GLOBAL_EXCLUDED_DOMAINS = [
  "4e.games",
  "eqaiesports.com",
  "ceosocial.io",
  "pitch4capital.com",
  "cpacloudtaxusa.com"
];
const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "icloud.com",
  "protonmail.com",
  "mail.com",
  "zoho.com"
];
const ENTITY_CONFIG = {
  // ─── EQAIESPORTS ──────────────────────────────────────────────────────────
  EQAIESPORTS: {
    label: "EqAI Esports",
    default_locations: DEFAULT_LOCATIONS,
    default_employee_ranges: DEFAULT_EMPLOYEE_RANGES,
    categories: {
      VENUE: {
        label: "Venue",
        lead_type: "CO_EVENT_COLLABORATOR",
        lead_class: "LEAD-03",
        industries: [
          "Entertainment",
          "Sports",
          "Leisure and Fitness",
          "Events Services",
          "Facilities Services"
        ],
        keywords: [
          "esports arena",
          "gaming center",
          "gaming cafe",
          "convention center",
          "arena",
          "event center"
        ],
        titles: [
          "Events Director",
          "Director of Events",
          "General Manager",
          "Director of Partnerships",
          "Owner"
        ]
      },
      EVENT_ORGANIZER: {
        label: "Event Organizer",
        lead_type: "CO_EVENT_COLLABORATOR",
        lead_class: "LEAD-03",
        industries: ["Computer Games", "Entertainment", "Events Services", "Sports"],
        keywords: [
          "esports tournament",
          "esports league",
          "gaming events",
          "LAN events",
          "tournament operator"
        ],
        titles: ["Founder", "CEO", "Tournament Director", "Head of Events", "League Commissioner"]
      },
      ACTIVATION_PARTNER: {
        label: "Activation Partner",
        lead_type: "HIGH_TICKET",
        lead_class: "LEAD-03",
        industries: [
          "Computer Games",
          "Consumer Electronics",
          "Consumer Goods",
          "Food & Beverages",
          "Telecommunications",
          "Apparel & Fashion",
          "Retail",
          "Marketing & Advertising",
          "Banking",
          "Financial Services"
        ],
        keywords: [
          "esports sponsorship",
          "gaming marketing",
          "youth marketing",
          "brand partnerships",
          "experiential marketing"
        ],
        titles: [
          "CMO",
          "Head of Marketing",
          "VP Marketing",
          "Sponsorship Manager",
          "Partnerships Director",
          "Brand Manager"
        ],
        employee_ranges: ["51,200", "201,500", "501,1000", "1001,10000"]
      },
      COLLEGIATE: {
        label: "Collegiate",
        lead_type: "VOLUME",
        lead_class: "LEAD-02",
        industries: ["Higher Education"],
        keywords: ["collegiate esports", "university esports", "student gaming", "esports program"],
        titles: [
          "Esports Director",
          "Athletics Director",
          "Student Activities Director",
          "Director of Student Life"
        ]
      },
      TEAM_OR_STUDIO: {
        label: "Team or Studio",
        lead_type: "STRATEGIC_PARTNER",
        lead_class: "LEAD-04",
        industries: ["Computer Games", "Entertainment", "Media Production"],
        keywords: [
          "esports organization",
          "professional esports team",
          "game studio",
          "content creators"
        ],
        titles: ["Founder", "CEO", "Head of Partnerships", "Business Development"]
      },
      ENTERPRISE_LICENSE: {
        label: "Enterprise License",
        lead_type: "HIGH_TICKET",
        lead_class: "LEAD-05",
        industries: [
          "Computer Software",
          "Information Technology & Services",
          "Marketing & Advertising",
          "Management Consulting",
          "Financial Services"
        ],
        keywords: [
          "AI operating system",
          "marketing automation",
          "go-to-market",
          "revenue operations",
          "digital transformation"
        ],
        titles: [
          "CIO",
          "CTO",
          "COO",
          "Chief Digital Officer",
          "Chief Revenue Officer",
          "VP Operations",
          "VP Marketing",
          "Head of Growth"
        ],
        employee_ranges: ["201,500", "501,1000", "1001,10000"]
      }
    }
  },
  // ─── PITCH4CAPITAL ────────────────────────────────────────────────────────
  PITCH4CAPITAL: {
    label: "Pitch4Capital",
    default_locations: DEFAULT_LOCATIONS,
    default_employee_ranges: DEFAULT_EMPLOYEE_RANGES,
    categories: {
      INVESTOR: {
        label: "Investor",
        lead_type: "STRATEGIC_PARTNER",
        lead_class: "LEAD-06",
        industries: ["Venture Capital & Private Equity", "Investment Management"],
        keywords: [
          "esports",
          "gaming",
          "AI infrastructure",
          "early-stage",
          "seed",
          "pre-seed",
          "angel"
        ],
        titles: [
          "Managing Partner",
          "General Partner",
          "Partner",
          "Principal",
          "Venture Partner",
          "Founder"
        ],
        employee_ranges: ["1,10", "11,50", "51,200"]
      }
    }
  },
  // ─── CEOSOCIAL ────────────────────────────────────────────────────────────
  CEOSOCIAL: {
    label: "CEO Social",
    default_locations: DEFAULT_LOCATIONS,
    default_employee_ranges: DEFAULT_EMPLOYEE_RANGES,
    categories: {
      CEO_FOUNDER: {
        label: "CEO / Founder",
        lead_type: "VOLUME",
        lead_class: "LEAD-01",
        industries: [
          "Computer Software",
          "Information Technology & Services",
          "Professional Services",
          "Marketing & Advertising",
          "Financial Services",
          "Real Estate",
          "Construction",
          "Health, Wellness & Fitness"
        ],
        keywords: [],
        titles: ["Founder", "Co-Founder", "CEO", "Owner", "President"],
        employee_ranges: ["1,10", "11,50", "51,200"]
      }
    }
  },
  // ─── CPACLOUDTAXUSA ───────────────────────────────────────────────────────
  CPACLOUDTAXUSA: {
    label: "CPA Cloud Tax USA",
    default_locations: DEFAULT_LOCATIONS,
    default_employee_ranges: DEFAULT_EMPLOYEE_RANGES,
    categories: {
      CPA_FIRM: {
        label: "CPA Firm",
        lead_type: "STRATEGIC_PARTNER",
        lead_class: "LEAD-04",
        industries: ["Accounting", "Financial Services"],
        keywords: ["CPA firm", "tax preparation", "tax advisory", "bookkeeping"],
        titles: ["Managing Partner", "Partner", "Owner", "Managing Director", "Principal"],
        employee_ranges: ["1,10", "11,50", "51,200"]
      },
      SMB_TAX_CLIENT: {
        label: "SMB Tax Client",
        lead_type: "VOLUME",
        lead_class: "LEAD-01",
        industries: [
          "Retail",
          "Construction",
          "Real Estate",
          "Hospitality",
          "Professional Services"
        ],
        keywords: [],
        titles: ["Owner", "Founder", "CEO", "CFO"],
        employee_ranges: ["1,10", "11,50"]
      }
    }
  }
};
function getCategoryConfig(entity, category) {
  const entityCfg = ENTITY_CONFIG[entity];
  if (!entityCfg) return null;
  return entityCfg.categories[category] ?? null;
}
function requireCategoryConfig(entity, category) {
  if (!Object.keys(ENTITY_CONFIG).includes(entity)) {
    throw new Error(
      `Unknown entity "${entity}". Valid values: ${Object.keys(ENTITY_CONFIG).join(", ")}`
    );
  }
  const cfg = getCategoryConfig(entity, category);
  if (!cfg) {
    const validCategories = Object.keys(ENTITY_CONFIG[entity].categories).join(", ");
    throw new Error(
      `Category "${category}" is not valid for entity "${entity}". Valid categories: ${validCategories}`
    );
  }
  return cfg;
}
function formatTargetSegment(entity, category) {
  const raw = `${entity} | ${category}`;
  if (raw.length > 200) throw new Error(`target_segment "${raw}" exceeds the 200-character limit`);
  return raw;
}
function parseTargetSegment(targetSegment) {
  const parts = targetSegment.split(" | ");
  if (parts.length !== 2) return null;
  const [entity, category] = parts;
  return { entity, category };
}
function buildApolloParamsForCategory(entity, category, overrideLocations) {
  const entityCfg = ENTITY_CONFIG[entity];
  const categoryCfg = requireCategoryConfig(entity, category);
  return {
    industries: categoryCfg.industries,
    titles: categoryCfg.titles,
    keywords: categoryCfg.keywords,
    employee_ranges: categoryCfg.employee_ranges ?? entityCfg.default_employee_ranges,
    locations: overrideLocations ?? entityCfg.default_locations
  };
}
const LEAD_CLASS_DEFAULTS = {
  "LEAD-01": { entity: "CEOSOCIAL", category: "CEO_FOUNDER" },
  "LEAD-02": { entity: "EQAIESPORTS", category: "COLLEGIATE" },
  "LEAD-03": { entity: "EQAIESPORTS", category: "ACTIVATION_PARTNER" },
  "LEAD-04": { entity: "EQAIESPORTS", category: "TEAM_OR_STUDIO" },
  "LEAD-05": { entity: "EQAIESPORTS", category: "ENTERPRISE_LICENSE" },
  "LEAD-06": { entity: "PITCH4CAPITAL", category: "INVESTOR" }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_EMPLOYEE_RANGES,
  DEFAULT_LOCATIONS,
  ENTITY_CONFIG,
  GLOBAL_EXCLUDED_DOMAINS,
  LEAD_CLASS_DEFAULTS,
  PERSONAL_EMAIL_DOMAINS,
  buildApolloParamsForCategory,
  formatTargetSegment,
  getCategoryConfig,
  parseTargetSegment,
  requireCategoryConfig
});
