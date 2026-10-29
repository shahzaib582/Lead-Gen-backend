export type HunterVerificationStatus = 'verified' | 'invalid' | 'risky' | 'unknown' | 'unverified';

export interface HunterResult {
  email: string | null;
  status: HunterVerificationStatus;
  score: number | null;
  sources: unknown[];
  request_type: 'discovery' | 'verification' | 'none';
}

export class HunterError extends Error {
  constructor(
    public readonly kind: 'authentication' | 'rate_limit' | 'upstream' | 'malformed',
    public readonly status?: number
  ) {
    super(`Hunter ${kind} error`);
  }
}

interface HunterResponse {
  data?: {
    email?: string | null;
    status?: string | null;
    score?: number | null;
    sources?: unknown[] | null;
  };
}

const mapStatus = (status: string | null | undefined): HunterVerificationStatus => {
  switch (status) {
    case 'valid':
      return 'verified';
    case 'invalid':
      return 'invalid';
    case 'accept_all':
    case 'disposable':
    case 'webmail':
      return 'risky';
    case 'unknown':
      return 'unknown';
    default:
      return 'unverified';
  }
};

const hunterRequest = async (
  path: string,
  params: Record<string, string>,
  apiKey: string
): Promise<HunterResponse> => {
  const url = new URL(`https://api.hunter.io/v2/${path}`);
  Object.entries({ ...params, api_key: apiKey }).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  );
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new HunterError('upstream');
  }
  if (response.status === 401 || response.status === 403)
    throw new HunterError('authentication', response.status);
  if (response.status === 429) throw new HunterError('rate_limit', response.status);
  if (!response.ok) throw new HunterError('upstream', response.status);
  try {
    return (await response.json()) as HunterResponse;
  } catch {
    throw new HunterError('malformed', response.status);
  }
};

export const findHunterEmail = async (
  params: Record<string, string>,
  apiKey: string
): Promise<HunterResult> => {
  const response = await hunterRequest('email-finder', params, apiKey);
  const result = response.data;
  return {
    email: typeof result?.email === 'string' ? result.email.toLowerCase() : null,
    status: result?.email ? 'unverified' : 'unknown',
    score: typeof result?.score === 'number' ? result.score : null,
    sources: Array.isArray(result?.sources) ? result.sources : [],
    request_type: 'discovery',
  };
};

export const verifyHunterEmail = async (email: string, apiKey: string): Promise<HunterResult> => {
  const response = await hunterRequest('email-verifier', { email }, apiKey);
  const result = response.data;
  return {
    email: typeof result?.email === 'string' ? result.email.toLowerCase() : email,
    status: mapStatus(result?.status),
    score: typeof result?.score === 'number' ? result.score : null,
    sources: Array.isArray(result?.sources) ? result.sources : [],
    request_type: 'verification',
  };
};
