# adapters/aws

AWS counterparts of Munim's cloud adapters (`foodops-os/adapters/gcp`): identity, blob storage, model calls and Postgres. Each is a factory
function a composition root would pick by env, exactly as `services/core-api/src/blob-store.ts` picks `gcsBlobStore`.
Plain ESM JavaScript with JSDoc types; the port types are copied as typedefs in `shared/port.js` (sources cited there).

| Munim port | GCP adapter | AWS adapter (this folder) |
| --- | --- | --- |
| IdP (`services/core-api/src/auth/port.ts`) | `idp-identity-platform` (Identity Platform / Firebase Auth) | `idp-cognito` (Amazon Cognito user pools) |
| Password grant for the demo sign-in | `passwordGrant` (`accounts:signInWithPassword`) | `passwordGrant` (Cognito `InitiateAuth`, `USER_PASSWORD_AUTH`) |
| BlobStore (`services/core-api/src/modules/imports/blob.ts`) | `blob-gcs` (Cloud Storage JSON API) | `blob-s3` (Amazon S3, `@aws-sdk/client-s3`) |
| LLM (agent model calls) | Gemini / Vertex AI model calls | `llm-bedrock` (Amazon Bedrock Converse API, `@aws-sdk/client-bedrock-runtime`) |
| Postgres | Supabase / Cloud SQL Postgres | `db-rds` (Amazon RDS / Aurora PostgreSQL, optional IAM auth via `@aws-sdk/rds-signer`) |

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

## llm-bedrock

`bedrockLlm({ region?, modelId?, models?, client? })` returns `{ complete({ system, messages, maxTokens, temperature, role? }) }`
resolving to `{ text, usage: { inputTokens, outputTokens, totalTokens }, stopReason, modelId }`. Each call is one
`ConverseCommand`: `system` becomes `system: [{ text }]`, each `{ role: "user" | "assistant", content }` message becomes
`{ role, content: [{ text }] }`, and `maxTokens` / `temperature` go in `inferenceConfig`. The reply text is the
concatenated text blocks of `output.message.content`. The default model id is `modelId` or `MUNIM_BEDROCK_MODEL_ID`;
`models` maps Munim roles to model ids (e.g. `{ extractor: "amazon.nova-lite-v1:0" }`) and `complete({ role })` picks
from it, falling back to the default. A model id can be a foundation model id or an inference profile id/ARN. Errors
carry the SDK error name and HTTP status only (`llm bedrock: AccessDeniedException HTTP 403`), never prompt or reply
text. IAM: `bedrock:InvokeModel` on the model ARN (`arn:aws:bedrock:<region>::foundation-model/<modelId>`, plus the
inference profile ARN when one is used); Converse is authorized by `bedrock:InvokeModel`. The model must be enabled
under Bedrock model access in the account and region.

## db-rds

`rdsPostgresConfig({ host, port?, database, user, region?, iamAuth?, password?, ca? })` returns a `pg` connection config
(`new pg.Pool(config)`; `pg` is Munim core's dependency, not this module's). `ssl` is always
`{ rejectUnauthorized: true }`, with `ca` set when the RDS CA bundle is passed (download it from
`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem` when the runtime's trust store lacks it). With
`iamAuth: true`, `password` is an async function that mints an RDS IAM auth token with `@aws-sdk/rds-signer`
(`new Signer({ hostname, port, username, region }).getAuthToken()`); `pg` calls it for every new connection, so no
database password is stored and each token is fresh (tokens are valid for 15 minutes). `iamAuth` and a static
`password` are mutually exclusive. `rdsPostgresConfigFromEnv(env)` builds the same config from `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, `PGPASSWORD`, `MUNIM_RDS_IAM_AUTH` and `AWS_REGION`. Database setup for IAM auth: enable IAM
database authentication on the instance or cluster, then `CREATE USER munim_iam; GRANT rds_iam TO munim_iam;`. IAM:
`rds-db:connect` on `arn:aws:rds-db:<region>:<account>:dbuser:<DbiResourceId or cluster resource id>/<db user>`.

## Env

| Variable | Used by | GCP equivalent |
| --- | --- | --- |
| `MUNIM_IDP=cognito` | composition root picks `cognitoIdp` | `MUNIM_IDP=identity-platform` |
| `AWS_REGION` | all adapters | (none) |
| `MUNIM_COGNITO_USER_POOL_ID` | `cognitoIdp` | `MUNIM_IDP_PROJECT_ID` |
| `MUNIM_COGNITO_CLIENT_ID` | `cognitoIdp`, `passwordGrant` | `MUNIM_IDP_WEB_API_KEY` |
| `MUNIM_COGNITO_CLIENT_SECRET` (optional) | `passwordGrant` | (none) |
| `MUNIM_BLOB=s3` | composition root picks `s3BlobStore` | `MUNIM_BLOB=gcs` |
| `MUNIM_BLOB_BUCKET` | `s3BlobStore` | `MUNIM_BLOB_BUCKET` |
| `MUNIM_LLM=bedrock` | composition root picks `bedrockLlm` | Gemini / Vertex AI |
| `MUNIM_BEDROCK_MODEL_ID` | `bedrockLlm` default model id | Gemini model name |
| `MUNIM_DB=rds` | composition root picks `rdsPostgresConfig` | Supabase / Cloud SQL connection string |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | `rdsPostgresConfigFromEnv` | same libpq vars |
| `PGPASSWORD` (password auth only) | `rdsPostgresConfigFromEnv` | same |
| `MUNIM_RDS_IAM_AUTH=true` (optional) | `rdsPostgresConfig` mints IAM auth tokens | (none) |

## IAM

| Adapter | Actions | Resource |
| --- | --- | --- |
| `blob-s3` | `s3:PutObject`, `s3:GetObject` | `arn:aws:s3:::<bucket>/*` |
| `llm-bedrock` | `bedrock:InvokeModel` (authorizes Converse) | `arn:aws:bedrock:<region>::foundation-model/<modelId>` (and the inference profile ARN if used) |
| `db-rds` (IAM auth) | `rds-db:connect` | `arn:aws:rds-db:<region>:<account>:dbuser:<resource id>/<db user>` |
| `idp-cognito` | none (JWKS and `InitiateAuth` are public endpoints) | |

## Test

```bash
node --test 'adapters/aws/**/*.test.js'
```

No external call. The Cognito tests sign tokens with a locally generated RSA key and inject a `fetch` that plays the
pool's JWKS and InitiateAuth endpoints. The S3 tests pass a mock client and assert on the real SDK command objects. The Bedrock tests
inject a fake runtime client and assert the exact `ConverseCommand` input and the parsed reply. The RDS tests inject a
fake signer and check the TLS settings and per-connection token minting.
