import { defineConfig } from "@neon/config/v1";

// Initial secrets are supplied from a private env file. Later code deployments leave them managed
// in the function's environment. No database owner credentials belong in this policy.
const names = [
  "FYDE_DATABASE_URL",
  "FYDE_SESSION_SECRET",
  "FYDE_EDGE_KEY",
  "FYDE_JOB_KEY",
  "SITE_URL",
  "AWS_ENDPOINT_URL_S3",
  "FYDE_STORAGE_KEY_ID",
  "FYDE_STORAGE_SECRET",
  "AWS_REGION",
  "FYDE_STORAGE_BUCKET",
  "CUSTOMER_API_ORIGINS",
  "CLAMAV_HOST",
  "CLAMAV_PORT",
  "RELEASE_SHA",
];
const env = Object.fromEntries(
  names
    .filter((name) => !!process.env[name])
    .map((name) => [name, process.env[name]!]),
);
export default defineConfig({
  functions: {
    fydeapi: {
      name: "Fyde customer API",
      source: "./dist/api/index.mjs",
      bundler: "none",
      env,
    },
    fydejobs: {
      name: "Fyde private file processing",
      source: "./dist/jobs/index.mjs",
      bundler: "none",
      env,
    },
  },
  triggers: {
    "fyde-file-processing": {
      type: "schedule",
      function: "fydejobs",
      cron: "* * * * *",
      functionPath: "/",
      enabled: true,
    },
  },
  branch: () => ({}),
});
