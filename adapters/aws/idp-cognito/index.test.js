// node --test: no AWS call. A locally generated RSA key plays the user pool's signing key; an injected fetch plays
// the pool's JWKS endpoint and the InitiateAuth endpoint.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { IdpError } from "../shared/port.js";
import { cognitoIdp, issuerFor, jwksUrlFor, passwordGrant, secretHash, SignInError } from "./index.js";

const REGION = "ap-south-1";
const POOL = "ap-south-1_TestPool1";
const CLIENT = "3n4b5test0client0id0abcd";
const ISS = `https://cognito-idp.${REGION}.amazonaws.com/${POOL}`;
const NOW = 1_800_000_000_000;

function keyPair(kid) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
function jwt(claims, { kid = "k1", key = k1.privateKey, alg = "RS256" } = {}) {
  const h = b64({ alg, kid });
  const p = b64(claims);
  const s = alg === "none" ? "" : sign("sha256", Buffer.from(`${h}.${p}`), key).toString("base64url");
  return `${h}.${p}.${s}`;
}
const idClaims = (over = {}) => ({
  sub: "c0ffee00-1111-2222-3333-444455556666", aud: CLIENT, iss: ISS, token_use: "id",
  email: "owner@cobnut-demo.invalid", email_verified: true,
  iat: NOW / 1000 - 60, exp: NOW / 1000 + 3600, ...over,
});

const k1 = keyPair("k1");
const k2 = keyPair("k2");

function jwksFetch(sets) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    const keys = sets[Math.min(calls.length - 1, sets.length - 1)];
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}
const idpWith = (sets, now = () => NOW) => {
  const j = jwksFetch(sets);
  return { idp: cognitoIdp({ region: REGION, userPoolId: POOL, clientId: CLIENT, fetch: j.f, now }), calls: j.calls };
};

test("issuer and JWKS URL follow the pool", () => {
  assert.equal(issuerFor(REGION, POOL), ISS);
  assert.equal(jwksUrlFor(REGION, POOL), `${ISS}/.well-known/jwks.json`);
});

test("a valid ID token maps to the port's Identity", async () => {
  const { idp, calls } = idpWith([[k1.jwk]]);
  const id = await idp.verify(jwt(idClaims()));
  assert.deepEqual(id, { sub: "c0ffee00-1111-2222-3333-444455556666", email: "owner@cobnut-demo.invalid", email_verified: true });
  assert.deepEqual(calls, [`${ISS}/.well-known/jwks.json`]);
  await idp.verify(jwt(idClaims()));
  assert.equal(calls.length, 1, "JWKS is cached");
});

test("email_verified: string \"true\" accepted, absent or false is false", async () => {
  const { idp } = idpWith([[k1.jwk]]);
  assert.equal((await idp.verify(jwt(idClaims({ email_verified: "true" })))).email_verified, true);
  assert.equal((await idp.verify(jwt(idClaims({ email_verified: false })))).email_verified, false);
  const { email_verified: _drop, ...noFlag } = idClaims();
  assert.equal((await idp.verify(jwt(noFlag))).email_verified, false);
  const { email: _e, ...noEmail } = idClaims();
  assert.deepEqual(await idp.verify(jwt(noEmail)), { sub: idClaims().sub, email: null, email_verified: false });
});

for (const [name, claims, opts, message] of [
  ["an access token (token_use=access)", idClaims({ token_use: "access" }), {}, "token_use"],
  ["a token for another app client", idClaims({ aud: "someone-else" }), {}, "audience"],
  ["a token from another pool", idClaims({ iss: `https://cognito-idp.${REGION}.amazonaws.com/${REGION}_Other` }), {}, "issuer"],
  ["an expired token", idClaims({ exp: NOW / 1000 - 3600 }), {}, "expired"],
  ["an alg:none token", idClaims(), { alg: "none" }, "algorithm"],
  ["a token signed by a key the pool does not publish", idClaims(), { key: k2.privateKey }, "signature"],
]) {
  test(`refuses ${name}`, async () => {
    const { idp } = idpWith([[k1.jwk]]);
    await assert.rejects(idp.verify(jwt(claims, opts)), (e) => e instanceof IdpError && e.message === message);
  });
}

test("refuses garbage", async () => {
  const { idp } = idpWith([[k1.jwk]]);
  await assert.rejects(idp.verify("not-a-jwt"), (e) => e instanceof IdpError && e.message === "malformed");
});

test("a rotated key triggers one refetch, rate-limited", async () => {
  let t = NOW;
  const { idp, calls } = idpWith([[k1.jwk], [k1.jwk, k2.jwk]], () => t);
  await idp.verify(jwt(idClaims()));
  // Inside the rate limit a new kid does not refetch.
  await assert.rejects(idp.verify(jwt(idClaims(), { kid: "k2", key: k2.privateKey })), (e) => e.message === "unknown key");
  assert.equal(calls.length, 1);
  t = NOW + 61_000;
  const id = await idp.verify(jwt(idClaims(), { kid: "k2", key: k2.privateKey }));
  assert.equal(id.sub, idClaims().sub);
  assert.equal(calls.length, 2);
  await assert.rejects(idp.verify(jwt(idClaims(), { kid: "k9" })), (e) => e.message === "unknown key");
  assert.equal(calls.length, 2, "no third fetch inside the rate limit");
});

test("JWKS unreachable or malformed is an IdpError", async () => {
  const down = cognitoIdp({ region: REGION, userPoolId: POOL, clientId: CLIENT, now: () => NOW, fetch: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(down.verify(jwt(idClaims())), (e) => e instanceof IdpError && e.message === "jwks unavailable");
  const bad = cognitoIdp({ region: REGION, userPoolId: POOL, clientId: CLIENT, now: () => NOW, fetch: async () => new Response("{}") });
  await assert.rejects(bad.verify(jwt(idClaims())), (e) => e instanceof IdpError && e.message === "jwks malformed");
});

function initiateAuthFetch(status, body) {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/x-amz-json-1.1" } });
  };
  return { f, seen };
}

test("passwordGrant sends InitiateAuth USER_PASSWORD_AUTH and returns the ID token", async () => {
  const { f, seen } = initiateAuthFetch(200, {
    AuthenticationResult: { IdToken: "id.tok.en", RefreshToken: "refresh", AccessToken: "acc", ExpiresIn: 3600, TokenType: "Bearer" },
  });
  const out = await passwordGrant({ region: REGION, clientId: CLIENT, email: "owner@cobnut-demo.invalid", password: "pw-123", fetch: f });
  assert.deepEqual(out, { idToken: "id.tok.en", refreshToken: "refresh", expiresIn: 3600 });
  assert.equal(seen.length, 1);
  const { url, init } = seen[0];
  assert.equal(url, `https://cognito-idp.${REGION}.amazonaws.com/`);
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/x-amz-json-1.1");
  assert.equal(init.headers["x-amz-target"], "AWSCognitoIdentityProviderService.InitiateAuth");
  assert.equal(init.headers.authorization, undefined, "public API: no SigV4");
  assert.deepEqual(JSON.parse(init.body), {
    AuthFlow: "USER_PASSWORD_AUTH", ClientId: CLIENT, AuthParameters: { USERNAME: "owner@cobnut-demo.invalid", PASSWORD: "pw-123" },
  });
});

test("passwordGrant adds SECRET_HASH for a client with a secret", async () => {
  const { f, seen } = initiateAuthFetch(200, { AuthenticationResult: { IdToken: "t" } });
  const out = await passwordGrant({ region: REGION, clientId: CLIENT, clientSecret: "s3cret", email: "a@b.invalid", password: "pw", fetch: f });
  assert.deepEqual(out, { idToken: "t", refreshToken: null, expiresIn: null });
  const params = JSON.parse(seen[0].init.body).AuthParameters;
  assert.equal(params.SECRET_HASH, secretHash("s3cret", "a@b.invalid", CLIENT));
  // Shape: base64 of a 32-byte HMAC-SHA256 digest.
  assert.match(params.SECRET_HASH, /^[A-Za-z0-9+/]{43}=$/);
});

test("passwordGrant errors carry the status or challenge only, never the password or body", async () => {
  const pw = "hunter2-very-secret";
  const cases = [
    initiateAuthFetch(400, { __type: "NotAuthorizedException", message: `Incorrect username or password ${pw}` }),
    initiateAuthFetch(200, { ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "sess" }),
    initiateAuthFetch(200, {}),
  ];
  const expected = ["sign in: HTTP 400", "sign in: challenge NEW_PASSWORD_REQUIRED", "sign in: no ID token"];
  for (const [i, { f }] of cases.entries()) {
    await assert.rejects(passwordGrant({ region: REGION, clientId: CLIENT, email: "a@b.invalid", password: pw, fetch: f }), (e) => {
      assert.ok(e instanceof SignInError);
      assert.equal(e.message, expected[i]);
      assert.ok(!e.message.includes(pw));
      return true;
    });
  }
  await assert.rejects(
    passwordGrant({ region: REGION, clientId: CLIENT, email: "a@b.invalid", password: pw, fetch: async () => { throw new Error(pw); } }),
    (e) => e instanceof SignInError && e.message === "sign in: Cognito unreachable",
  );
});
