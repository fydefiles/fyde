export type Config = {
  databaseUrl: string;
  siteUrl: string;
  authUrl: string;
  secret: string;
  edgeKey: string;
  jobKey: string;
  origins: string[];
  revision: string;
  bucket: string;
  s3Endpoint: string;
  s3Key: string;
  s3Secret: string;
  region: string;
  scannerHost: string;
  scannerPort: number;
  googleEnabled?: boolean;
};

export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string, fallback?: string) => {
    const value = env[name] || (fallback ? env[fallback] : "");
    if (!value) throw new Error(`Configure ${name} before starting Fyde.`);
    return value;
  };
  const siteUrl = required("SITE_URL").replace(/\/$/, "");
  const site = new URL(siteUrl);
  if (
    siteUrl !== site.origin ||
    (site.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(site.hostname))
  )
    throw new Error("SITE_URL must be the exact HTTPS application origin.");
  const authUrl = required("NEON_AUTH_BASE_URL").replace(/\/$/, "");
  if (!authUrl.startsWith("https://"))
    throw new Error("Managed Auth requires HTTPS.");
  const secret = required("FYDE_SESSION_SECRET", "DJANGO_SECRET_KEY");
  if (secret.length < 32)
    throw new Error(
      "Use a stable random session secret of at least 32 characters.",
    );
  return {
    databaseUrl: required("FYDE_DATABASE_URL", "DATABASE_URL"),
    siteUrl,
    authUrl,
    secret,
    edgeKey: required("FYDE_EDGE_KEY"),
    jobKey: required("FYDE_JOB_KEY"),
    origins: [
      siteUrl,
      ...(env.CUSTOMER_API_ORIGINS || "").split(",").filter(Boolean),
    ],
    revision: env.RELEASE_SHA || "local",
    bucket: env.FYDE_STORAGE_BUCKET || env.NEON_STORAGE_BUCKET || "uploads",
    s3Endpoint: required("AWS_ENDPOINT_URL_S3"),
    s3Key: required("FYDE_STORAGE_KEY_ID", "AWS_ACCESS_KEY_ID"),
    s3Secret: required("FYDE_STORAGE_SECRET", "AWS_SECRET_ACCESS_KEY"),
    region: env.AWS_REGION || "us-east-2",
    scannerHost: env.CLAMAV_HOST || "",
    scannerPort: Number(env.CLAMAV_PORT || "3310"),
    googleEnabled: env.FYDE_GOOGLE_AUTH_ENABLED !== "false",
  };
}
