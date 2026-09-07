import { describe, expect, it } from "vitest";
import { buildExecutiveReport } from "./executive";
import { buildTechnicalReport } from "./technical";
import { MAX_COLUMNS_PORTRAIT, splitWideTable } from "./tables";
import {
  NOT_MEASURED,
  decimal,
  fileDateStamp,
  formatReportDate,
  money,
  percent,
  slugify,
} from "./shared";
import { GENERATED_AT, context, emptyContext, runResponse } from "./fixtures";
import type { ReportBlock, ReportDocument } from "./types";

/** Belgedeki tüm metni tek dizeye indirir; içerik aramak için. */
function textOf(document: ReportDocument): string {
  const parts: string[] = [
    document.cover.title,
    document.cover.subtitle,
    document.cover.factoryName,
    document.cover.generatedAtLabel,
    ...document.cover.facts.flatMap((fact) => [fact.label, fact.value]),
  ];

  for (const block of document.blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
      case "note":
        parts.push(block.text);
        break;
      case "kpiGrid":
        parts.push(
          ...block.items.flatMap((item) => [item.label, item.value, item.hint ?? ""]),
        );
        break;
      case "table":
        parts.push(block.caption ?? "", ...block.columns, ...block.rows.flat());
        break;
      case "bars":
        parts.push(
          block.caption ?? "",
          ...block.items.flatMap((item) => [item.label, item.display]),
        );
        break;
      case "heatmap":
        parts.push(
          block.caption ?? "",
          ...block.cells.flatMap((cell) => [cell.stationName, cell.lossLabel]),
        );
        break;
      case "pageBreak":
        break;
    }
  }

  return parts.join(" | ");
}

function blocksOfKind<K extends ReportBlock["kind"]>(
  document: ReportDocument,
  kind: K,
): Extract<ReportBlock, { kind: K }>[] {
  return document.blocks.filter(
    (block): block is Extract<ReportBlock, { kind: K }> => block.kind === kind,
  );
}

/* -------------------------------------------------------------------------- */

describe("biçimlendiriciler", () => {
  it("olculemeyen degeri tire gosterir, sifir degil", () => {
    // Raporun en tehlikeli hatasi: "OEE %0" okuyan yonetici hattin durdugunu
    // sanir.
    expect(percent(null)).toBe(NOT_MEASURED);
    expect(money(null)).toBe(NOT_MEASURED);
    expect(decimal(null)).toBe(NOT_MEASURED);
    expect(percent(Number.NaN)).toBe(NOT_MEASURED);
  });

  it("yuzdeyi Turkce ondalik ayiraciyla yazar", () => {
    expect(percent(0.745, 1)).toBe("%74,5");
    expect(percent(0)).toBe("%0");
  });

  it("tarihi okunur biciimde yazar", () => {
    expect(formatReportDate(GENERATED_AT)).toContain("2026");
    expect(fileDateStamp(GENERATED_AT)).toBe("2026-09-04");
  });

  it("dosya adinda Turkce harfleri ASCII'ye cevirir", () => {
    // Indirilen dosya farkli isletim sistemleri ve e-posta sunuculari
    // arasinda dolasacak.
    expect(slugify("Yıldız Metal A.Ş.")).toBe("yildiz-metal-a-s");
    expect(slugify("Döküm & Kaynak")).toBe("dokum-kaynak");
  });

  it("bos adda okunur bir yedek uretir", () => {
    expect(slugify("   ")).toBe("fabrika");
    expect(slugify("!!!")).toBe("fabrika");
  });
});

describe("splitWideTable", () => {
  const wide = {
    caption: "Tüm istasyonlar",
    columns: ["İstasyon", "A", "B", "C", "D", "E", "F", "G"],
    rows: [["Kesim", "1", "2", "3", "4", "5", "6", "7"]],
    numericColumns: [1, 2, 3, 4, 5, 6, 7],
  };

  it("sigan tabloyu bolmez", () => {
    const narrow = { columns: ["A", "B"], rows: [["1", "2"]] };
    expect(splitWideTable(narrow)).toHaveLength(1);
  });

  it("genis tabloyu parcalar ve her parcada anahtar sutunu tekrarlar", () => {
    const parts = splitWideTable(wide);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.columns[0]).toBe("İstasyon");
      expect(part.rows[0][0]).toBe("Kesim");
      expect(part.columns.length).toBeLessThanOrEqual(MAX_COLUMNS_PORTRAIT);
    }
  });

  it("hicbir veri sutununu kaybetmez ve tekrarlamaz", () => {
    const parts = splitWideTable(wide);
    const seen = parts.flatMap((part) => part.columns.slice(1));
    expect(seen).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });

  it("parca numarasini basliga yazar", () => {
    const parts = splitWideTable(wide);
    expect(parts[0].caption).toBe("Tüm istasyonlar (1/2)");
    expect(parts[1].caption).toBe("Tüm istasyonlar (2/2)");
  });

  it("sayisal sutun indekslerini yeni konuma tasir", () => {
    const parts = splitWideTable(wide);
    // Anahtar sutun (0) sayisal degil; geri kalan hepsi sayisal olmali.
    for (const part of parts) {
      expect(part.numericColumns).toEqual(
        part.columns.map((_, index) => index).slice(1),
      );
    }
  });

  it("satirsiz tabloyu da tek parca dondurur", () => {
    const empty = { columns: ["A", "B"], rows: [] };
    expect(splitWideTable(empty)[0].rows).toEqual([]);
  });
});

describe("buildExecutiveReport", () => {
  it("kapakta fabrika adi ve tarih bulunur", () => {
    const document = buildExecutiveReport(context());
    expect(document.cover.factoryName).toBe("Yıldız Metal Hattı");
    expect(document.cover.title).toBe("Yönetici Raporu");
    expect(document.cover.generatedAtLabel).toContain("2026");
    expect(document.cover.orgName).toBe("Yıldız Metal A.Ş.");
  });

  it("dosya adi fabrika ve tarihi tasir", () => {
    expect(buildExecutiveReport(context()).fileName).toBe(
      "optiflow-yonetici-yildiz-metal-hatti-2026-09-04",
    );
  });

  it("istenen dort gostergeyi icerir", () => {
    const grids = blocksOfKind(buildExecutiveReport(context()), "kpiGrid");
    const labels = grids.flatMap((grid) => grid.items.map((item) => item.label));
    expect(labels).toEqual(
      expect.arrayContaining(["Hat OEE", "Throughput", "Darboğaz", "Aylık kayıp"]),
    );
  });

  it("yonetici ozetini Intelligence katmanindan alir", () => {
    // Ekranda ve PDF'te ayni cumle gorunmeli; toplantida ekrani acan kisiyle
    // raporu okuyan kisi ayni hikayeyi duymali.
    const text = textOf(buildExecutiveReport(context()));
    expect(text).toContain("Torna");
    expect(text).toContain("Yönetici Özeti");
  });

  it("kosum yokken sayilari uydurmaz", () => {
    const document = buildExecutiveReport(emptyContext());
    const grid = blocksOfKind(document, "kpiGrid")[0];
    expect(grid.items.every((item) => item.value === NOT_MEASURED)).toBe(true);
    expect(textOf(document)).toContain("koşumu olmadan üretildi");
  });

  it("finans yokken parasal etkiyi bos birakip nedenini yazar", () => {
    const text = textOf(buildExecutiveReport(context({ report: null })));
    expect(text).toContain("Maliyet oranları girilmediği için");
  });

  it("finans varken kayip kalemlerini ve paylarini yazar", () => {
    const tables = blocksOfKind(buildExecutiveReport(context()), "table");
    const loss = tables.find((table) => table.columns.includes("Payı"));
    expect(loss).toBeDefined();
    // Fikstürde toplam 1000; durus 400 → %40.
    expect(loss?.rows).toContainEqual(["Duruş kaybı", "₺400", "%40"]);
  });

  it("oncelik tablosunda parasal etkisi bilinmeyeni tire birakir", () => {
    const tables = blocksOfKind(
      buildExecutiveReport(context({ report: null })),
      "table",
    );
    const priorities = tables.find((table) => table.columns.includes("Aciliyet"));
    expect(priorities).toBeDefined();
    expect(priorities?.rows.every((row) => row[3] === NOT_MEASURED)).toBe(true);
  });

  it("kaydedilmemis modelde okunur bir ad kullanir", () => {
    const document = buildExecutiveReport(context({ factoryName: null }));
    expect(document.cover.factoryName).toBe("Kaydedilmemiş model");
    expect(document.fileName).toContain("fabrika");
  });
});

describe("buildTechnicalReport", () => {
  it("kosum yoksa nedenini yazip durur", () => {
    const document = buildTechnicalReport(emptyContext());
    expect(blocksOfKind(document, "table")).toHaveLength(0);
    expect(textOf(document)).toContain("simülasyon koşumu gerektirir");
  });

  it("istasyon tablosunu sayfaya sigacak parcalara boler", () => {
    const tables = blocksOfKind(buildTechnicalReport(context()), "table");
    const stationParts = tables.filter((table) =>
      table.caption?.startsWith("Tüm istasyonlar"),
    );
    expect(stationParts.length).toBeGreaterThan(1);
    for (const part of stationParts) {
      expect(part.columns.length).toBeLessThanOrEqual(MAX_COLUMNS_PORTRAIT);
    }
  });

  it("her istasyon icin bir satir uretir", () => {
    const tables = blocksOfKind(buildTechnicalReport(context()), "table");
    const firstPart = tables.find((table) => table.caption === "Tüm istasyonlar (1/2)");
    expect(firstPart?.rows).toHaveLength(2);
    expect(firstPart?.rows[1][0]).toContain("Torna");
  });

  it("darbogaz istasyonunu tabloda isaretler", () => {
    const base = context();
    const marked = context({
      result: runResponse({
        results: {
          ...base.result!.results,
          station_metrics: base.result!.results.station_metrics.map((station) =>
            station.station_id === "s2" ? { ...station, is_bottleneck: true } : station,
          ),
        },
      }),
    });
    const tables = blocksOfKind(buildTechnicalReport(marked), "table");
    const firstPart = tables.find((table) => table.caption === "Tüm istasyonlar (1/2)");
    expect(firstPart?.rows[1][0]).toContain("darboğaz");
    // Diğer istasyon işaretlenmez.
    expect(firstPart?.rows[0][0]).not.toContain("darboğaz");
  });

  it("doluluk cubuklarini uretir ve orani kirpar", () => {
    const bars = blocksOfKind(buildTechnicalReport(context()), "bars")[0];
    expect(bars.items).toHaveLength(2);
    for (const item of bars.items) {
      expect(item.ratio).toBeGreaterThanOrEqual(0);
      expect(item.ratio).toBeLessThanOrEqual(1);
    }
  });

  it("isi haritasini finans raporundan kurar", () => {
    const withHeat = context({
      report: {
        ...context().report!,
        heat: [
          {
            station_id: "s2",
            station_name: "Torna",
            score: 92,
            band: "red",
            components: [],
            total_loss: 700,
            is_bottleneck: true,
            is_relative: true,
          },
        ],
      },
    });
    const heat = blocksOfKind(buildTechnicalReport(withHeat), "heatmap")[0];
    expect(heat.cells).toHaveLength(1);
    expect(heat.cells[0].stationName).toBe("Torna");
    expect(heat.cells[0].lossLabel).toBe("₺700");
    expect(heat.isRelative).toBe(true);
  });

  it("finans yoksa isi haritasi ve kayip tablolari cizilmez", () => {
    const document = buildTechnicalReport(context({ report: null }));
    expect(blocksOfKind(document, "heatmap")).toHaveLength(0);
    const captions = blocksOfKind(document, "table").map((table) => table.caption);
    expect(captions).not.toContain("İstasyon bazında kayıp dağılımı");
  });

  it("orani verilmemis kayip kalemini sifir yazmaz", () => {
    const partial = context({
      report: {
        ...context().report!,
        impact: {
          ...context().report!.impact,
          components: [
            {
              name: "downtime_loss",
              label: "Duruş kaybı",
              amount: 0,
              provenance: "observed",
              quantity: 12,
              quantity_unit: "dk",
              rate_name: "downtime_cost_per_minute",
              rate_value: null,
              is_available: false,
              basis: "Arıza süresi",
            },
          ],
        },
      },
    });
    const tables = blocksOfKind(buildTechnicalReport(partial), "table");
    const components = tables.find((table) => table.columns.includes("Dayanak"));
    expect(components?.rows[0][1]).toBe(NOT_MEASURED);
  });

  it("dogrulama bolumunu her zaman yazar", () => {
    const text = textOf(buildTechnicalReport(context()));
    expect(text).toContain("Little Yasası");
    expect(text).toContain("Doğrulama");
  });

  it("uyari yokken bunu acikca soyler", () => {
    expect(textOf(buildTechnicalReport(context()))).toContain(
      "Koşum uyarı üretmedi",
    );
  });

  it("kosum uyarilarini tabloya yazar", () => {
    const noisy = context({
      result: runResponse({ warnings: ["Sistem kararsız: kuyruk büyüyor"] }),
    });
    const tables = blocksOfKind(buildTechnicalReport(noisy), "table");
    const warnings = tables.find((table) => table.caption === "Koşum uyarıları");
    expect(warnings?.rows).toHaveLength(1);
  });

  it("sayfa sonlarini bilincli olarak yerlestirir", () => {
    const document = buildTechnicalReport(context());
    expect(blocksOfKind(document, "pageBreak").length).toBeGreaterThan(0);
  });
});
