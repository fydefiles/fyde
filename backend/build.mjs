import { build } from "esbuild";
const banner =
  "import { createRequire as fydeCreateRequire } from 'node:module'; const require = fydeCreateRequire(import.meta.url);";
for (const [entry, name] of [
  ["src/index.ts", "api"],
  ["src/jobs.ts", "jobs"],
]) {
  const outfile = `dist/${name}/index.mjs`;
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: { js: banner },
    logLevel: "info",
  });
  // Check the deployed ESM artifact, including bundled CommonJS dependencies.
  await import(new URL(outfile, import.meta.url).href);
}
