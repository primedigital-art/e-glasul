/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Aplicația e-glasul: PWA cetățean + administrare primărie (ADR-0001).
// Rutare, auth, rezolvare de tenant, service worker și Supabase vin ulterior.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
