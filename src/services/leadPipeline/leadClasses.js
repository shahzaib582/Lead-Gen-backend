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
var leadClasses_exports = {};
__export(leadClasses_exports, {
  LEAD_CLASSES: () => LEAD_CLASSES,
  LEAD_CLASS_CODES: () => LEAD_CLASS_CODES,
  isLeadClass: () => isLeadClass
});
module.exports = __toCommonJS(leadClasses_exports);
const LEAD_CLASS_CODES = [
  "LEAD-01",
  "LEAD-02",
  "LEAD-03",
  "LEAD-04",
  "LEAD-05",
  "LEAD-06"
];
const LEAD_CLASSES = {
  "LEAD-01": {
    code: "LEAD-01",
    label: "Consumer/Executive Lead",
    description: "CEO, founder, executive or professional."
  },
  "LEAD-02": {
    code: "LEAD-02",
    label: "Workshop Lead",
    description: "Someone interested in Lessons/Workshops."
  },
  "LEAD-03": {
    code: "LEAD-03",
    label: "Activation Partner",
    description: "Potential Bundle Battle / Recall Redux / event partner."
  },
  "LEAD-04": {
    code: "LEAD-04",
    label: "Strategic Partner",
    description: "Potential ecosystem collaborator."
  },
  "LEAD-05": {
    code: "LEAD-05",
    label: "Enterprise Lead",
    description: "Company interested in licensing the Federated Ecosystem."
  },
  "LEAD-06": {
    code: "LEAD-06",
    label: "Capital Lead",
    description: "Investor, lender, capital partner or institutional fund."
  }
};
const isLeadClass = (value) => typeof value === "string" && LEAD_CLASS_CODES.includes(value);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LEAD_CLASSES,
  LEAD_CLASS_CODES,
  isLeadClass
});
