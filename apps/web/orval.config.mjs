import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(fileURLToPath(import.meta.url));

export function createApiConfig(output = resolve(web, "src/api/generated")) {
  return {
    auth: {
      input: {
        target: resolve(web, "../../packages/api-contract/openapi.json"),
        filters: { mode: "include", tags: ["AuthSession"] },
        parserOptions: { externalRefs: { allow: [] } },
      },
      output: {
        target: resolve(output, "auth.ts"),
        schemas: resolve(output, "models"),
        mode: "split",
        client: "react-query",
        httpClient: "axios",
        headers: false,
        clean: false,
        override: {
          mutator: {
            path: resolve(web, "src/api/transport.ts"),
            name: "apiRequest",
          },
          query: {
            version: 5,
            useQuery: false,
            useMutation: true,
            mutationOptions: {
              path: resolve(web, "src/api/transport.ts"),
              name: "authMutationOptions",
              useHooks: false,
            },
          },
        },
      },
    },
  };
}

export default createApiConfig();
