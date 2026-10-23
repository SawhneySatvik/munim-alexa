// node --test: no AWS or database call. A fake signer stands in for @aws-sdk/rds-signer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { rdsPostgresConfig, rdsPostgresConfigFromEnv } from "./index.js";

const HOST = "munim.cluster-abc123.ap-south-1.rds.amazonaws.com";

function fakeSigner(token = "fake-iam-token") {
  const made = [];
  let calls = 0;
  return {
    made,
    get calls() { return calls; },
    create(opts) {
      made.push(opts);
      return { getAuthToken: async () => { calls += 1; return `${token}-${calls}`; } };
    },
  };
}

test("password auth: TLS required and verified, password passed through", () => {
  const c = rdsPostgresConfig({ host: HOST, database: "munim", user: "munim_app", password: "pw" });
  assert.deepEqual(c, { host: HOST, port: 5432, database: "munim", user: "munim_app", password: "pw", ssl: { rejectUnauthorized: true } });
});

test("an RDS CA bundle is passed as ssl.ca", () => {
  const ca = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
  const c = rdsPostgresConfig({ host: HOST, port: 5433, database: "munim", user: "u", ca });
  assert.deepEqual(c.ssl, { rejectUnauthorized: true, ca });
  assert.equal(c.port, 5433);
  assert.equal("password" in c, false);
});

test("iamAuth: password is a function that mints a fresh token per connection", async () => {
  const s = fakeSigner();
  const c = rdsPostgresConfig({ host: HOST, database: "munim", user: "munim_iam", region: "ap-south-1", iamAuth: true, createSigner: s.create });
  assert.deepEqual(s.made, [{ hostname: HOST, port: 5432, username: "munim_iam", region: "ap-south-1" }]);
  assert.equal(typeof c.password, "function");
  assert.equal(s.calls, 0);
  assert.equal(await c.password(), "fake-iam-token-1");
  assert.equal(await c.password(), "fake-iam-token-2");
  assert.deepEqual(c.ssl, { rejectUnauthorized: true });
});

test("iamAuth: a signer failure names the error only", async () => {
  const c = rdsPostgresConfig({
    host: HOST, database: "munim", user: "u", region: "ap-south-1", iamAuth: true,
    createSigner: () => ({ getAuthToken: async () => { throw Object.assign(new Error("creds secret detail"), { name: "CredentialsProviderError" }); } }),
  });
  await assert.rejects(c.password(), { message: "rds iam auth: token mint failed (CredentialsProviderError)" });
});

test("iamAuth needs a region and excludes a static password; required fields are checked", () => {
  const s = fakeSigner();
  assert.throws(() => rdsPostgresConfig({ host: HOST, database: "d", user: "u", iamAuth: true, createSigner: s.create }), /region is required/);
  assert.throws(() => rdsPostgresConfig({ host: HOST, database: "d", user: "u", region: "r", iamAuth: true, password: "pw", createSigner: s.create }), /not both/);
  assert.throws(() => rdsPostgresConfig({ host: "", database: "d", user: "u" }), /host is required/);
  assert.throws(() => rdsPostgresConfig({ host: HOST, database: "", user: "u" }), /database is required/);
  assert.throws(() => rdsPostgresConfig({ host: HOST, database: "d", user: "" }), /user is required/);
  assert.throws(() => rdsPostgresConfig({ host: HOST, port: 70000, database: "d", user: "u" }), /port is invalid/);
  assert.equal(s.made.length, 0);
});

test("from env: PG* vars, MUNIM_RDS_IAM_AUTH and AWS_REGION", async () => {
  const s = fakeSigner("t");
  const c = rdsPostgresConfigFromEnv(
    { PGHOST: HOST, PGPORT: "5432", PGDATABASE: "munim", PGUSER: "munim_iam", AWS_REGION: "ap-south-1", MUNIM_RDS_IAM_AUTH: "true", PGPASSWORD: "ignored" },
    { createSigner: s.create },
  );
  assert.equal(await c.password(), "t-1");
  assert.deepEqual(s.made[0], { hostname: HOST, port: 5432, username: "munim_iam", region: "ap-south-1" });
  const p = rdsPostgresConfigFromEnv({ PGHOST: HOST, PGDATABASE: "munim", PGUSER: "u", PGPASSWORD: "pw" });
  assert.equal(p.password, "pw");
  assert.equal(p.port, 5432);
});
