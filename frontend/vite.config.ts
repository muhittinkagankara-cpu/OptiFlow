// `defineConfig` bilinçli olarak `vitest/config` paketinden alınır: aşağıdaki
// `test` bloğunu yalnızca o sürüm tanır. Vite'ın kendi `defineConfig`'i
// kullanıldığında `npm run build` (içinde `tsc -b` çalıştırır) bu dosyada tip
// hatası verir — `vite build` tek başına tipleri denetlemediği için sorun
// ancak tam derlemede ortaya çıkar.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Backend'deki CORS ayarı bu portu bekliyor (allow_origins).
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
