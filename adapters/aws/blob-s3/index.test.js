// node --test: no AWS call. A mock S3 client (anything with `send`) records the real SDK command objects.
import assert from "node:assert/strict";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { test } from "node:test";
import { blobKey } from "../shared/port.js";
import { s3BlobStore } from "./index.js";

const KEY = blobKey("0192f3a4-5b6c-7d8e-9f00-112233445566", "a".repeat(64));

function mockS3() {
  const objects = new Map();
  const sent = [];
  return {
    sent,
    objects,
    async send(cmd) {
      sent.push(cmd);
      if (cmd instanceof PutObjectCommand) {
        objects.set(`${cmd.input.Bucket}/${cmd.input.Key}`, Uint8Array.from(cmd.input.Body));
        return { $metadata: { httpStatusCode: 200 } };
      }
      if (cmd instanceof GetObjectCommand) {
        const v = objects.get(`${cmd.input.Bucket}/${cmd.input.Key}`);
        if (!v) throw Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => v } };
      }
      throw new Error("unexpected command");
    },
  };
}

test("put then get round-trips binary bytes under <tenant>/<sha256>", async () => {
  const s3 = mockS3();
  const store = s3BlobStore({ bucket: "munim-blobs", client: s3 });
  const bytes = new Uint8Array([0, 255, 1, 254, 10, 13]);
  await store.put(KEY, bytes);
  assert.ok(s3.sent[0] instanceof PutObjectCommand);
  assert.deepEqual(
    { Bucket: s3.sent[0].input.Bucket, Key: s3.sent[0].input.Key, ContentType: s3.sent[0].input.ContentType },
    { Bucket: "munim-blobs", Key: KEY, ContentType: "application/octet-stream" },
  );
  const got = await store.get(KEY);
  assert.ok(s3.sent[1] instanceof GetObjectCommand);
  assert.ok(got instanceof Uint8Array);
  assert.deepEqual([...got], [...bytes]);
});

test("a key that is not <tenant>/<sha256> is refused before any S3 call", async () => {
  const s3 = mockS3();
  const store = s3BlobStore({ bucket: "b", client: s3 });
  for (const bad of ["../etc/passwd", `${KEY}/x`, "tenant/abc", ""]) {
    await assert.rejects(store.put(bad, new Uint8Array([1])), /blob key is not <tenant>\/<sha256>/);
    await assert.rejects(store.get(bad), /blob key is not <tenant>\/<sha256>/);
  }
  assert.equal(s3.sent.length, 0);
});

test("a missing object is 'not found'; other failures carry the status only", async () => {
  const store = s3BlobStore({ bucket: "b", client: mockS3() });
  await assert.rejects(store.get(KEY), { message: "blob get: not found" });
  const denied = s3BlobStore({ bucket: "b", client: { send: async () => { throw Object.assign(new Error("AccessDenied: secret detail"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }); } } });
  await assert.rejects(denied.put(KEY, new Uint8Array([1])), { message: "blob put: HTTP 403" });
  await assert.rejects(denied.get(KEY), { message: "blob get: HTTP 403" });
  const down = s3BlobStore({ bucket: "b", client: { send: async () => { throw new Error("getaddrinfo ENOTFOUND"); } } });
  await assert.rejects(down.put(KEY, new Uint8Array([1])), { message: "blob put: storage unreachable" });
});

test("bucket is required", () => {
  assert.throws(() => s3BlobStore({ bucket: "", client: mockS3() }), /bucket is required/);
});
