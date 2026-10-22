import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // PDF işçisi ?worker ile paketlenir; böylece .js uzantılı bir dosya olarak
  // sunulur ve eski Android WebView'larda .mjs MIME sorunu yaşanmaz.
  worker: { format: "es" },
  build: {
    target: "es2020",
    assetsInlineLimit: 0
  }
});
