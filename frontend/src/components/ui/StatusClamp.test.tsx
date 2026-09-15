/**
 * `StatusClamp` render testleri.
 *
 * Render `react-dom/server` ile yapılır; gerekçesi `Skeleton.test.tsx`
 * başlığında yazılıdır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusClamp } from "./StatusClamp";
import type { MeasuredState } from "../../lib/ui";

const STATES: MeasuredState[] = ["ok", "warn", "fault", "unknown"];

describe("StatusClamp", () => {
  it("durumu yalnızca renkle taşımaz", () => {
    // Kelepçenin rengi görsel bir sinyaldir; yazılı etiket ekran okuyucu için
    // aynı bilgiyi taşır (MASTER §22).
    const html = renderToStaticMarkup(
      <StatusClamp state="fault" stateLabel="Eşik aşıldı">
        <p>Torna</p>
      </StatusClamp>,
    );
    expect(html).toContain("Eşik aşıldı");
    expect(html).toContain("sr-only");
  });

  it("her durum için kendi kelepçe rengini kullanır", () => {
    for (const state of STATES) {
      const html = renderToStaticMarkup(
        <StatusClamp state={state} stateLabel="durum">
          <span>içerik</span>
        </StatusClamp>,
      );
      expect(html).toContain(`border-l-[var(--of-semantic-${state})]`);
    }
  });

  it("ölçülmemiş durumu arıza rengiyle göstermez", () => {
    const html = renderToStaticMarkup(
      <StatusClamp state="unknown" stateLabel="Ölçülmedi">
        <span>—</span>
      </StatusClamp>,
    );
    expect(html).toContain("--of-semantic-unknown");
    expect(html).not.toContain("--of-semantic-fault");
  });

  it("çocuklarını çizer", () => {
    const html = renderToStaticMarkup(
      <StatusClamp state="ok" stateLabel="Normal">
        <p>Kesme istasyonu</p>
      </StatusClamp>,
    );
    expect(html).toContain("Kesme istasyonu");
  });

  it("iki piksellik sol kenarlık uygular", () => {
    const html = renderToStaticMarkup(
      <StatusClamp state="warn" stateLabel="Eşiğe yakın">
        <span>x</span>
      </StatusClamp>,
    );
    expect(html).toContain("border-l-2");
  });
});
