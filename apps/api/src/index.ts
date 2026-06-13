import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/", (ctx) => ctx.text("OK"));

serve({ fetch: app.fetch, port: 3000 });
