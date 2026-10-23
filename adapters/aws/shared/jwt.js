// Compact-JWS verification against a JWKS with node:crypto. A plain-JS copy of foodops-os
// services/core-api/src/auth/jwt.ts (verifyJwt), plus one addition: an optional `check(claims)` hook that runs after
// the signature, expiry, issuer and audience pass (Cognito uses it for `token_use`). Only asymmetric algorithms are
// accepted: an `alg: none` or HS256 token is refused before any key lookup.
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { IdpError } from "./port.js";

/** @typedef {import("node:crypto").JsonWebKey & { kid?: string, alg?: string }} Jwk */
/** @typedef {{ keys: Jwk[] }} Jwks */
/** @typedef {import("./port.js").Identity} Identity */

/**
 * @typedef {object} VerifyOptions
 * @property {string} [issuer]
 * @property {string} [audience]
 * @property {number} [leeway] Seconds of clock skew tolerated on exp/nbf.
 * @property {() => number} [now]
 * @property {(claims: Record<string, unknown>) => boolean} [emailVerified] Where this IdP says "the email was confirmed".
 * @property {(claims: Record<string, unknown>) => void} [check] Extra claim checks; throw IdpError to refuse.
 */

/** @type {Record<string, { hash: string | null, p1363: boolean }>} */
const ALGS = {
  RS256: { hash: "sha256", p1363: false },
  ES256: { hash: "sha256", p1363: true },
  EdDSA: { hash: null, p1363: false },
};

/**
 * @param {string} token
 * @param {Jwks} jwks
 * @param {VerifyOptions} [opts]
 * @returns {Identity}
 */
export function verifyJwt(token, jwks, opts = {}) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new IdpError("malformed");
  const [h, p, s] = parts;
  const header = decode(h);
  const alg = typeof header.alg === "string" && Object.hasOwn(ALGS, header.alg) ? ALGS[header.alg] : undefined;
  if (!alg) throw new IdpError("algorithm");
  const jwk = jwks.keys.find((k) => k.kid === header.kid && (k.alg === undefined || k.alg === header.alg));
  if (!jwk) throw new IdpError("unknown key");
  let ok = false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const sig = Buffer.from(s, "base64url");
    ok = cryptoVerify(alg.hash, Buffer.from(`${h}.${p}`), alg.p1363 ? { key, dsaEncoding: "ieee-p1363" } : key, sig);
  } catch {
    ok = false;
  }
  if (!ok) throw new IdpError("signature");
  const claims = decode(p);
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  const leeway = opts.leeway ?? 30;
  if (typeof claims.exp !== "number" || claims.exp + leeway <= now) throw new IdpError("expired");
  if (typeof claims.nbf === "number" && claims.nbf - leeway > now) throw new IdpError("not yet valid");
  if (opts.issuer !== undefined && claims.iss !== opts.issuer) throw new IdpError("issuer");
  if (opts.audience !== undefined) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(opts.audience)) throw new IdpError("audience");
  }
  if (typeof claims.sub !== "string" || claims.sub === "") throw new IdpError("sub");
  opts.check?.(claims);
  const email = typeof claims.email === "string" ? claims.email : null;
  const verified = (opts.emailVerified ?? ((c) => c.email_verified === true))(claims);
  return { sub: claims.sub, email, email_verified: email !== null && verified };
}

/** @param {string} part @returns {Record<string, unknown>} */
function decode(part) {
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw new IdpError("malformed");
}
