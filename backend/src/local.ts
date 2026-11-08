import { serve } from "@hono/node-server";
import backend from "./index.js";
serve({
  fetch: backend.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 8020),
});
