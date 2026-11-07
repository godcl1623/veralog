import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { serializeDocument } from "./document.mjs";

export const outputPath = fileURLToPath(
  new URL("../../../../packages/api-contract/openapi.json", import.meta.url)
);

export async function checkDocument(path = outputPath) {
  return (await readFile(path, "utf8")) === (await serializeDocument());
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await serializeDocument());
    console.log("Generated packages/api-contract/openapi.json");
  } else if (args.length === 1 && args[0] === "--check") {
    if (!(await checkDocument()))
      throw new Error("OpenAPI spec is stale. Run openapi:generate.");
    console.log("OpenAPI spec is current");
  } else {
    throw new Error("Usage: export-openapi.mjs [--check]");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
