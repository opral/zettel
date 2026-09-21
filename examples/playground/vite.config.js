import { defineConfig } from "vite";
import { documentSchema } from "@opral/zettel-ast";
export default defineConfig({
  plugins: [
    {
      name: "zettel-schema",
      configureServer(server) {
        server.middlewares.use("/schema/1/schema.json", (_req, res) => {
          res.setHeader("Content-Type", "application/schema+json");
          res.end(JSON.stringify(documentSchema, null, 2));
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "schema/1/schema.json",
          source: JSON.stringify(documentSchema, null, 2) + "\n",
        });
      },
    },
  ],
});
