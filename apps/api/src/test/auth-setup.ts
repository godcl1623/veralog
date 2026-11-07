import { vi } from "vitest";

// Route imports must never fall back to the application's DATABASE_URL.
vi.mock("../db/client", async () => import("./db"));

import "./setup";
