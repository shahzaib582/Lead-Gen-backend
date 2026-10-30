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
var hunter_exports = {};
__export(hunter_exports, {
  HunterError: () => HunterError,
  findHunterEmail: () => findHunterEmail,
  verifyHunterEmail: () => verifyHunterEmail
});
module.exports = __toCommonJS(hunter_exports);
class HunterError extends Error {
  constructor(kind, status) {
    super(`Hunter ${kind} error`);
    this.kind = kind;
    this.status = status;
  }
  kind;
  status;
}
const mapStatus = (status) => {
  switch (status) {
    case "valid":
      return "verified";
    case "invalid":
      return "invalid";
    case "accept_all":
    case "disposable":
    case "webmail":
      return "risky";
    case "unknown":
      return "unknown";
    default:
      return "unverified";
  }
};
const hunterRequest = async (path, params, apiKey) => {
  const url = new URL(`https://api.hunter.io/v2/${path}`);
  Object.entries({ ...params, api_key: apiKey }).forEach(
    ([key, value]) => url.searchParams.set(key, value)
  );
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new HunterError("upstream");
  }
  if (response.status === 401 || response.status === 403)
    throw new HunterError("authentication", response.status);
  if (response.status === 429) throw new HunterError("rate_limit", response.status);
  if (!response.ok) throw new HunterError("upstream", response.status);
  try {
    return await response.json();
  } catch {
    throw new HunterError("malformed", response.status);
  }
};
const findHunterEmail = async (params, apiKey) => {
  const response = await hunterRequest("email-finder", params, apiKey);
  const result = response.data;
  return {
    email: typeof result?.email === "string" ? result.email.toLowerCase() : null,
    status: result?.email ? "unverified" : "unknown",
    score: typeof result?.score === "number" ? result.score : null,
    sources: Array.isArray(result?.sources) ? result.sources : [],
    request_type: "discovery"
  };
};
const verifyHunterEmail = async (email, apiKey) => {
  const response = await hunterRequest("email-verifier", { email }, apiKey);
  const result = response.data;
  return {
    email: typeof result?.email === "string" ? result.email.toLowerCase() : email,
    status: mapStatus(result?.status),
    score: typeof result?.score === "number" ? result.score : null,
    sources: Array.isArray(result?.sources) ? result.sources : [],
    request_type: "verification"
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HunterError,
  findHunterEmail,
  verifyHunterEmail
});
