import { defineConfig } from "drizzle-kit";

// `npm run db:generate` après toute modification de src/db/schema.ts.
// Les migrations sont appliquées automatiquement au démarrage (src/db/index.ts).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "./data/app.db" },
});
