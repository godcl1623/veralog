import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { v1 } from "./routes/v1";
import { startRefreshReplayCleanup } from "./utils/refresh-cleanup";
import { loadRefreshReplayCipher } from "./utils/refresh-replay";

loadRefreshReplayCipher();
const stopCleanup = startRefreshReplayCleanup();

const app = new Hono();

app.route("/api/v1", v1);

app.get("/", (ctx) => ctx.text("Veralog API Server is running"));

const server = serve({
  fetch: app.fetch,
  port: Number(process.env.SERVER_PORT ?? 3000),
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopCleanup();
    server.close(() => process.exit(0));
  });
}
