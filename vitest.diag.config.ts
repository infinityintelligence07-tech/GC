// Config separada para diagnósticos que leem o banco de produção e importam a
// lógica real do app. Fica fora do `npm test` de propósito: a suíte principal
// não pode depender de rede nem de dados vivos.
//
// Uso: npx vitest run --config vitest.diag.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["scripts/**/*.diag.test.ts"],
    testTimeout: 180_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
