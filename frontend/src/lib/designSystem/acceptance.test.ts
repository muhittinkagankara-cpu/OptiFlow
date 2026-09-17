/// <reference types="node" />
/**
 * V4 kabul belgesi güncel mi? (Sprint 2M, Faz 6)
 *
 * Belge elle yazılsaydı, kurallar değiştikçe sessizce yalan söylemeye
 * başlardı — ve bir tasarım anayasasının en kötü hali, güncel olduğu sanılan
 * eski bir belgedir.
 *
 * Bu yüzden belge bir **üretici betikle** değil bir **testle** korunuyor.
 * Betik olsaydı çalıştırmayı unutmak mümkün olurdu; test her koşumda çalışır
 * ve belge kurallardan saptığı anda düşer.
 *
 * Yeniden üretmek için:
 *
 *     V4_ACCEPT_WRITE=1 npx vitest run src/lib/designSystem/acceptance.test.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCEPTANCE, renderAcceptance } from "./constitution";

const DOC_PATH = fileURLToPath(
  new URL("../../../../docs/design-system/V4_ACCEPTANCE.md", import.meta.url),
);

const beklenen = renderAcceptance();

if (process.env.V4_ACCEPT_WRITE === "1") {
  writeFileSync(DOC_PATH, beklenen, "utf8");
}

describe("V4 kabul belgesi", () => {
  it("depodaki belge kurallarla birebir aynı", () => {
    const mevcut = readFileSync(DOC_PATH, "utf8");
    expect(mevcut).toBe(beklenen);
  });

  it("her satır bir koruma katmanı adlandırır", () => {
    // "Korunuyor" demek, nerede korunduğunu yazmadan bir iddia olurdu.
    for (const row of ACCEPTANCE) {
      expect(row.guardedBy.trim().length).toBeGreaterThan(10);
      expect(row.rule.trim().length).toBeGreaterThan(3);
    }
  });

  it("durum yalnızca üç değerden biri olabilir", () => {
    for (const row of ACCEPTANCE) {
      expect(["otomatik", "ölçümle", "elle"]).toContain(row.status);
    }
  });

  it("elle korunan kurallar açıkça sayılır", () => {
    /*
     * Bu sayı bilinçli olarak sabitlenmedi: azalması iyi, artması bir
     * gerileme. Sıfırdan büyük olması da dürüstlüğün bir parçası — her şeyin
     * otomatik olduğunu söylemek, olmadığında en pahalı yalan olurdu.
     */
    const elle = ACCEPTANCE.filter((r) => r.status === "elle");
    expect(elle.length).toBeLessThanOrEqual(3);
  });

  it("belgede elle düzenleme uyarısı var", () => {
    expect(beklenen).toContain("Bu dosya elle düzenlenmez");
  });
});
