// Test yapılandırması bilerek vite.config.ts'ten ayrıdır: vitest 2.x kendi içinde Vite 5 kullanır,
// proje ise Vite 6'dır. Ayrı dosya, `tsc -b` tarafından (tsconfig.node.json yalnızca vite.config.ts'i
// kapsar) tip denetimine girmez; böylece iki Vite sürümünün Plugin tipleri çakışamaz.
// Testler saf mantık olduğu için React eklentisine gerek yoktur.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"]
  }
});
