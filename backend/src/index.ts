import { config } from "./config.js";
import { createApp } from "./app.js";
let backend: ReturnType<typeof createApp>;
export default {
  fetch(request: Request) {
    backend ||= createApp(config());
    return backend.app.fetch(request);
  },
};
