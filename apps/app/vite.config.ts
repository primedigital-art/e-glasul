import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Aplicația e-glasul: PWA cetățean + administrare primărie (ADR-0001).
// Rutare, auth, rezolvare de tenant, service worker și Supabase vin ulterior.
export default defineConfig({
  plugins: [react()],
});
