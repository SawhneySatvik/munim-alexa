// The two Munim ports the AWS adapters implement, copied here as JSDoc typedefs so this repo needs no TS build.
// Sources (foodops-os, the Munim monorepo):
//   - IdP port:   services/core-api/src/auth/port.ts      (Identity, VerifyOpts, IdP, IdpError)
//   - Blob port:  services/core-api/src/modules/imports/blob.ts  (BlobStore; chosen by services/core-api/src/blob-store.ts)
// When these adapters are lifted into foodops-os they should import core-api's own `IdpError` and `verifyJwt`
// instead of these copies: a copied error class breaks `instanceof IdpError` at the composition root.

/**
 * @typedef {object} Identity
 * @property {string} sub
 * @property {string | null} email
 * @property {boolean} email_verified The IdP says this address was confirmed. An unverified email never claims an invite; absent = false.
 */

/**
 * @typedef {object} VerifyOpts
 * @property {boolean} [needEmailVerified] Ask the IdP whether the address is confirmed. An adapter whose token already
 *   carries a signed `email_verified` claim (Cognito ID tokens do) can ignore it.
 */

/**
 * @typedef {object} IdP
 * @property {(token: string, opts?: VerifyOpts) => Promise<Identity>} verify Resolves the identity, or rejects with
 *   IdpError for any bad, forged, expired or unreadable token. Roles never come from the token: Postgres decides.
 */

/**
 * @typedef {object} BlobStore
 * @property {(key: string, bytes: Uint8Array) => Promise<void>} put Idempotent: the key is content-addressed.
 * @property {(key: string) => Promise<Uint8Array>} get
 */

export class IdpError extends Error {
  name = "IdpError";
}

/** `<tenant>/<sha256>`: the only keys the blob port writes (same check as the local and GCS stores). */
export const BLOB_KEY = /^[0-9a-f-]{36}\/[0-9a-f]{64}$/;

/** @param {string} tenantId @param {string} sha256 */
export const blobKey = (tenantId, sha256) => `${tenantId}/${sha256}`;
