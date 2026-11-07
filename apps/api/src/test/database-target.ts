export function assertTestDatabaseUrl(value: string | undefined): string {
  const message =
    "DATABASE_URL_TEST must target local :5432/veralog_test without URL options";
  let target: URL;
  try {
    target = new URL(value ?? "");
  } catch {
    throw new Error(message);
  }
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    (target.port !== "" && target.port !== "5432") ||
    target.pathname !== "/veralog_test" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error(message);
  }
  target.port = "5432";
  return target.href;
}
