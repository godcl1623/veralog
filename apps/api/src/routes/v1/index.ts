import { Hono } from "hono";

import { auth } from "./auth";

export const v1 = new Hono();

v1.route("/auth", auth);
