// idp-cognito: the IdP adapter for Amazon Cognito user pools, the AWS counterpart of foodops-os
// adapters/gcp/idp-identity-platform. Verifies Cognito ID tokens (RS256) against the pool's published JWKS:
// issuer `https://cognito-idp.<region>.amazonaws.com/<poolId>`, audience `<app client id>`, `token_use = "id"`
// (an access token is refused). `email_verified` is a claim Cognito signs, so it is read from the token and
// `needEmailVerified` changes nothing. Roles never come from the token: Postgres decides.
// Plus `passwordGrant`, the server-side sign-in (Cognito InitiateAuth, USER_PASSWORD_AUTH) over plain fetch: no SDK.
// UNVERIFIED against a live user pool. CODE ONLY, NOT DEPLOYED: the live Munim demo runs on Supabase. URL shapes,
// headers and claim names follow AWS's public Cognito docs.
import { createHmac } from "node:crypto";
import { verifyJwt } from "../shared/jwt.js";
import { IdpError } from "../shared/port.js";

/** @typedef {import("../shared/port.js").IdP} IdP */
/** @typedef {import("../shared/port.js").Identity} Identity */
/** @typedef {import("../shared/jwt.js").Jwks} Jwks */

const TTL_MS = 10 * 60_000;
const MIN_REFETCH_MS = 60_000;
const TIMEOUT_MS = 3_000;

/** @param {string} region @param {string} userPoolId */
export const issuerFor = (region, userPoolId) => `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
/** @param {string} region @param {string} userPoolId */
export const jwksUrlFor = (region, userPoolId) => `${issuerFor(region, userPoolId)}/.well-known/jwks.json`;

/**
 * @param {{ region: string, userPoolId: string, clientId: string, fetch?: typeof fetch, now?: () => number,
 *   timeoutMs?: number, jwksUrl?: string }} opts
 * @returns {IdP}
 */
export function cognitoIdp(opts) {
  for (const k of /** @type {const} */ (["region", "userPoolId", "clientId"])) {
    if (!opts[k]) throw new Error(`cognitoIdp: ${k} is required`);
  }
  const get = opts.fetch ?? fetch;
  const clock = opts.now ?? Date.now;
  const jwksUrl = opts.jwksUrl ?? jwksUrlFor(opts.region, opts.userPoolId);
  const verifyOpts = {
    issuer: issuerFor(opts.region, opts.userPoolId),
    audience: opts.clientId,
    now: clock,
    // Cognito signs it as a boolean; older pools have been seen to emit the string "true".
    emailVerified: (/** @type {Record<string, unknown>} */ c) => c.email_verified === true || c.email_verified === "true",
    check: (/** @type {Record<string, unknown>} */ c) => {
      if (c.token_use !== "id") throw new IdpError("token_use");
    },
  };
  /** @type {{ jwks: Jwks, at: number } | null} */
  let cached = null;

  /** @param {boolean} force @returns {Promise<Jwks>} */
  async function load(force) {
    const now = clock();
    if (cached && now - cached.at < (force ? MIN_REFETCH_MS : TTL_MS)) return cached.jwks;
    let res;
    try {
      res = await get(jwksUrl, { signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS) });
    } catch {
      throw new IdpError("jwks unavailable");
    }
    if (!res.ok) throw new IdpError("jwks unavailable");
    const jwks = /** @type {Jwks} */ (await res.json().catch(() => ({})));
    if (!Array.isArray(jwks.keys)) throw new IdpError("jwks malformed");
    cached = { jwks, at: now };
    return jwks;
  }

  return {
    async verify(token, _o = {}) {
      try {
        return verifyJwt(token, await load(false), verifyOpts);
      } catch (e) {
        // A rotated key: refetch once (rate-limited) and retry.
        if (e instanceof IdpError && e.message === "unknown key") return verifyJwt(token, await load(true), verifyOpts);
        throw e;
      }
    },
  };
}

export class SignInError extends Error {
  name = "SignInError";
}

/** SECRET_HASH for an app client that has a secret: base64(HMAC-SHA256(secret, username + clientId)). */
export const secretHash = (/** @type {string} */ clientSecret, /** @type {string} */ username, /** @type {string} */ clientId) =>
  createHmac("sha256", clientSecret).update(username + clientId).digest("base64");

/**
 * The password grant: email + password -> an ID token, via Cognito `InitiateAuth` with `USER_PASSWORD_AUTH`
 * (the app client must allow ALLOW_USER_PASSWORD_AUTH). InitiateAuth is a public API: no SigV4, no SDK.
 * Server-side only. Errors carry the step and the HTTP status only: never a body, a token or the password.
 * @param {{ region: string, clientId: string, email: string, password: string, clientSecret?: string,
 *   fetch?: typeof fetch, apiBase?: string, timeoutMs?: number }} o
 * @returns {Promise<{ idToken: string, refreshToken: string | null, expiresIn: number | null }>}
 */
export async function passwordGrant(o) {
  const call = o.fetch ?? fetch;
  const url = `${(o.apiBase ?? `https://cognito-idp.${o.region}.amazonaws.com`).replace(/\/+$/, "")}/`;
  /** @type {Record<string, string>} */
  const params = { USERNAME: o.email, PASSWORD: o.password };
  if (o.clientSecret) params.SECRET_HASH = secretHash(o.clientSecret, o.email, o.clientId);
  let res;
  try {
    res = await call(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({ AuthFlow: "USER_PASSWORD_AUTH", ClientId: o.clientId, AuthParameters: params }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
  } catch {
    throw new SignInError("sign in: Cognito unreachable");
  }
  const j = /** @type {Record<string, any>} */ (await res.json().catch(() => ({})));
  if (!res.ok) throw new SignInError(`sign in: HTTP ${res.status}`);
  // A challenge (NEW_PASSWORD_REQUIRED for a user still in FORCE_CHANGE_PASSWORD, MFA, ...) is not a sign-in.
  if (typeof j.ChallengeName === "string") throw new SignInError(`sign in: challenge ${j.ChallengeName}`);
  const r = j.AuthenticationResult;
  if (!r || typeof r.IdToken !== "string") throw new SignInError("sign in: no ID token");
  return {
    idToken: r.IdToken,
    refreshToken: typeof r.RefreshToken === "string" ? r.RefreshToken : null,
    expiresIn: typeof r.ExpiresIn === "number" && Number.isFinite(r.ExpiresIn) ? r.ExpiresIn : null,
  };
}
