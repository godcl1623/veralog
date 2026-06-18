import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/", (ctx) => ctx.text("OK"));

serve({ fetch: app.fetch, port: Number(process.env.SERVER_PORT ?? 3000) });
