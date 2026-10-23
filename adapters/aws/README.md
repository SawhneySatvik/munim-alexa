# adapters/aws

AWS counterparts of Munim's GCP adapters (`foodops-os/adapters/gcp`), behind the same two ports. Each is a factory
function a composition root would pick by env, exactly as `services/core-api/src/blob-store.ts` picks `gcsBlobStore`.
Plain ESM JavaScript with JSDoc types; the port types are copied as typedefs in `shared/port.js` (sources cited there).

| Munim port | GCP adapter | AWS adapter (this folder) |
| --- | --- | --- |
| IdP (`services/core-api/src/auth/port.ts`) | `idp-identity-platform` (Identity Platform / Firebase Auth) | `idp-cognito` (Amazon Cognito user pools) |
| Password grant for the demo sign-in | `passwordGrant` (`accounts:signInWithPassword`) | `passwordGrant` (Cognito `InitiateAuth`, `USER_PASSWORD_AUTH`) |
| BlobStore (`services/core-api/src/modules/imports/blob.ts`) | `blob-gcs` (Cloud Storage JSON API) | `blob-s3` (Amazon S3, `@aws-sdk/client-s3`) |

## idp-cognito

- `cognitoIdp({ region, userPoolId, clientId })` verifies Cognito **ID tokens**: RS256 against the pool's JWKS
  (`https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json`), `iss` =
  `https://cognito-idp.<region>.amazonaws.com/<poolId>`, `aud` = the app client id, `token_use` = `id` (access tokens
  are refused). Returns the port's `Identity` `{ sub, email, email_verified }`; `email_verified` is Cognito's signed
  claim. JWKS cached 10 min, one rate-limited refetch on an unknown `kid` (same as the GCP adapter). `shared/jwt.js` is a
  JS copy of core-api's `verifyJwt` (asymmetric algorithms only).
- `passwordGrant({ region, clientId, email, password, clientSecret? })` is the server-side sign-in: `POST
  https://cognito-idp.<region>.amazonaws.com/` with `X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth`,
  `Content-Type: application/x-amz-json-1.1`, body `{ AuthFlow: "USER_PASSWORD_AUTH", ClientId, AuthParameters }`.
  InitiateAuth is a public API: no SigV4, no SDK. `SECRET_HASH` is added when the app client has a secret. A challenge
  response (e.g. `NEW_PASSWORD_REQUIRED`) is an error. Errors carry the step and status only, never a body or password.
- Pool setup this assumes: the app client allows `ALLOW_USER_PASSWORD_AUTH`; users created with `AdminCreateUser` sit
  in `FORCE_CHANGE_PASSWORD` until `AdminSetUserPassword` with `Permanent: true`. Creating the demo accounts (the GCP
  `ensureDemoAccounts`) is not ported: Cognito's admin APIs need SigV4-signed calls.

## blob-s3

`s3BlobStore({ bucket, region? })` stores `<tenant>/<sha256>` objects (the key is checked before any S3 call) with
`PutObjectCommand` / `GetObjectCommand`. A missing object is `blob get: not found`. The port has only `put` and `get`,
so no presigned URLs (and no `@aws-sdk/s3-request-presigner`) are needed. Credentials come from the SDK's default
chain (task role, instance profile, env). IAM: the writer needs `s3:PutObject` and `s3:GetObject` on
`arn:aws:s3:::<bucket>/*`; a read-only worker needs `s3:GetObject` only.

## Env

| Variable | Used by | GCP equivalent |
| --- | --- | --- |
| `MUNIM_IDP=cognito` | composition root picks `cognitoIdp` | `MUNIM_IDP=identity-platform` |
| `AWS_REGION` | both adapters | (none) |
| `MUNIM_COGNITO_USER_POOL_ID` | `cognitoIdp` | `MUNIM_IDP_PROJECT_ID` |
| `MUNIM_COGNITO_CLIENT_ID` | `cognitoIdp`, `passwordGrant` | `MUNIM_IDP_WEB_API_KEY` |
| `MUNIM_COGNITO_CLIENT_SECRET` (optional) | `passwordGrant` | (none) |
| `MUNIM_BLOB=s3` | composition root picks `s3BlobStore` | `MUNIM_BLOB=gcs` |
| `MUNIM_BLOB_BUCKET` | `s3BlobStore` | `MUNIM_BLOB_BUCKET` |

## Test

```bash
node --test 'adapters/aws/**/*.test.js'
```

No external call. The Cognito tests sign tokens with a locally generated RSA key and inject a `fetch` that plays the
pool's JWKS and InitiateAuth endpoints. The S3 tests pass a mock client and assert on the real SDK command objects.
