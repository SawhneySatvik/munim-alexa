// db-rds: Postgres on Amazon RDS / Aurora PostgreSQL, the AWS counterpart of Munim's Supabase / Cloud SQL Postgres.
// Returns a `pg` connection config (Munim core already depends on `pg`; this module does not). TLS is always on and
// verified (`rejectUnauthorized: true`); pass the RDS CA bundle as `ca` when the runtime's trust store lacks it. With
// `iamAuth`, `password` is a function that mints a fresh RDS IAM auth token (`@aws-sdk/rds-signer`, valid 15 min) for
// every new connection, so no database password is stored. Errors never include the token.
import { Signer } from "@aws-sdk/rds-signer";

/** @typedef {{ getAuthToken: () => Promise<string> }} SignerLike */
/** @typedef {{ hostname: string, port: number, username: string, region: string }} SignerOptions */
/**
 * @typedef {{
 *   host: string,
 *   port: number,
 *   database: string,
 *   user: string,
 *   password?: string | (() => Promise<string>),
 *   ssl: { rejectUnauthorized: true, ca?: string },
 * }} PgConfig
 */

/**
 * @param {{
 *   host: string,
 *   port?: number,
 *   database: string,
 *   user: string,
 *   region?: string,
 *   iamAuth?: boolean,
 *   password?: string,
 *   ca?: string,
 *   createSigner?: (o: SignerOptions) => SignerLike,
 * }} o
 * @returns {PgConfig}
 */
export function rdsPostgresConfig(o) {
  for (const k of /** @type {const} */ (["host", "database", "user"])) {
    if (!o?.[k]) throw new Error(`rdsPostgresConfig: ${k} is required`);
  }
  const port = o.port === undefined ? 5432 : Number(o.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("rdsPostgresConfig: port is invalid");
  /** @type {PgConfig["ssl"]} */
  const ssl = o.ca ? { rejectUnauthorized: true, ca: o.ca } : { rejectUnauthorized: true };
  /** @type {PgConfig} */
  const config = { host: o.host, port, database: o.database, user: o.user, ssl };
  if (o.iamAuth) {
    if (o.password) throw new Error("rdsPostgresConfig: use iamAuth or password, not both");
    if (!o.region) throw new Error("rdsPostgresConfig: region is required for iamAuth");
    const create = o.createSigner ?? ((s) => new Signer(s));
    const signer = create({ hostname: o.host, port, username: o.user, region: o.region });
    config.password = async () => {
      try {
        return await signer.getAuthToken();
      } catch (e) {
        const name = /** @type {{ name?: string }} */ (e ?? {}).name;
        throw new Error(`rds iam auth: token mint failed${typeof name === "string" && /^[A-Za-z]+$/.test(name) ? ` (${name})` : ""}`);
      }
    };
  } else if (o.password !== undefined) {
    config.password = o.password;
  }
  return config;
}

/**
 * Builds the config from the standard libpq env vars plus `MUNIM_RDS_IAM_AUTH` and `AWS_REGION`.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ ca?: string, createSigner?: (o: SignerOptions) => SignerLike }} [extra]
 * @returns {PgConfig}
 */
export function rdsPostgresConfigFromEnv(env = process.env, extra = {}) {
  const iamAuth = env.MUNIM_RDS_IAM_AUTH === "1" || env.MUNIM_RDS_IAM_AUTH === "true";
  return rdsPostgresConfig({
    host: env.PGHOST ?? "",
    port: env.PGPORT ? Number(env.PGPORT) : undefined,
    database: env.PGDATABASE ?? "",
    user: env.PGUSER ?? "",
    region: env.AWS_REGION,
    iamAuth,
    password: iamAuth ? undefined : env.PGPASSWORD,
    ...extra,
  });
}
