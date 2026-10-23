// blob-s3: the S3 BlobStore, the AWS counterpart of foodops-os adapters/gcp/blob-gcs (the port is
// services/core-api/src/modules/imports/blob.ts: `put` and `get`, nothing else, so no presigned URLs are needed).
// Keys are `<tenant>/<sha256>` only (the same check the local and GCS stores make), so a key can never walk out of its
// tenant prefix. Credentials come from the SDK's default chain (task role, instance profile, env).
// UNVERIFIED against a real bucket. CODE ONLY, NOT DEPLOYED: the live Munim demo runs on Supabase.
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { BLOB_KEY } from "../shared/port.js";

/** @typedef {import("../shared/port.js").BlobStore} BlobStore */
/** @typedef {{ send: (command: any) => Promise<any> }} S3Like */

/** @param {string} key */
const checked = (key) => {
  if (!BLOB_KEY.test(key)) throw new Error("blob key is not <tenant>/<sha256>");
  return key;
};

/** @param {unknown} e */
const notFound = (e) => {
  const err = /** @type {{ name?: string, $metadata?: { httpStatusCode?: number } }} */ (e ?? {});
  return err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404;
};

/** @param {unknown} e */
const status = (e) => /** @type {{ $metadata?: { httpStatusCode?: number } }} */ (e ?? {}).$metadata?.httpStatusCode;

/**
 * @param {{ bucket: string, region?: string, client?: S3Like }} o
 * @returns {BlobStore}
 */
export function s3BlobStore(o) {
  if (!o.bucket) throw new Error("s3BlobStore: bucket is required");
  const client = o.client ?? new S3Client(o.region ? { region: o.region } : {});
  return {
    async put(key, bytes) {
      const Key = checked(key);
      try {
        await client.send(new PutObjectCommand({ Bucket: o.bucket, Key, Body: bytes, ContentType: "application/octet-stream" }));
      } catch (e) {
        const s = status(e);
        throw new Error(s ? `blob put: HTTP ${s}` : "blob put: storage unreachable");
      }
    },
    async get(key) {
      const Key = checked(key);
      let out;
      try {
        out = await client.send(new GetObjectCommand({ Bucket: o.bucket, Key }));
      } catch (e) {
        if (notFound(e)) throw new Error("blob get: not found");
        const s = status(e);
        throw new Error(s ? `blob get: HTTP ${s}` : "blob get: storage unreachable");
      }
      if (!out?.Body || typeof out.Body.transformToByteArray !== "function") throw new Error("blob get: empty body");
      return new Uint8Array(await out.Body.transformToByteArray());
    },
  };
}
