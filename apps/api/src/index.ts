import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { v1 } from "./routes/v1";

const app = new Hono();

app.route("/api/v1", v1);

app.get("/", (ctx) => ctx.text("Veralog API Server is running"));

serve({ fetch: app.fetch, port: Number(process.env.SERVER_PORT ?? 3000) });
