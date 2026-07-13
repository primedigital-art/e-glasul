// @ts-check
import { defineConfig } from "astro/config";

// Site public e-glasul. Output static (ADR-0001): un singur build servește
// toți tenanții; rezolvarea tenantului și anunțurile vin ulterior (FUP-1, FUP-8).
export default defineConfig({
  output: "static",
});
