/**
 * Devreye alma katmanının testleri.
 *
 * Savunulan kurallar:
 *
 * 1. **Token metni yalnızca üretim yanıtında bulunur.** Liste kaydında yoktur.
 * 2. **Ölçülemeyen adım "bekliyor" sayılmaz.** İkisi farklı iki kişiyi
 *    ilgilendirir: birinde eksik olan iş, ötekinde ölçümdür.
 * 3. **Türetilemeyen etiket önerisi `null` kalır.** Uydurulmuş bir etiket,
 *    sahada yanlış makineye yapıştırılan bir kâğıttır.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_DEPLOYMENT,
  EMPTY_FIELD_DIAGNOSTICS,
  LABELS_PER_PAGE,
  NOT_MEASURED,
  PROBE_STATE_LABEL,
  STEP_STATE_LABEL,
  TOKEN_STATUS_LABEL,
  cellCaption,
  deploymentCaption,
  diagnosticsCaption,
  formatDuration,
  labelCount,
  labelFileName,
  labelWarnings,
  lineValue,
  pageCount,
  paginate,
  parseChecklistStep,
  parseDeployment,
  parseDiagnosticLine,
  parseFieldDiagnostics,
  parseIssuedToken,
  parseLabelReview,
  parseProbeState,
  parseStepState,
  parseToken,
  parseTokenStatus,
  parseTokens,
  printedRatio,
  probeTone,
  stepTone,
  tokenCaption,
  tokenTone,
  type MachineLabel,
} from "./index";

function etiket(label: string, printed: number | null = null): MachineLabel {
  return {
    machineId: label.toLowerCase().replace("-", "_"),
    label,
    line: "Hat 1",
    qr: `optiflow:makine/org-a/${label}`,
    printedAtMs: printed,
    createdAtMs: 1_000,
    createdBy: "sistem",
    note: "",
  };
}

describe("token durumu", () => {
  it("tanınan durum geçer", () => {
    expect(parseTokenStatus("used")).toBe("used");
  });

  it("tanınmayan durum kapalı sayılır", () => {
    // "Kullanılabilir"e düşmek, anlamadığımız bir tokenı açık göstermek olurdu.
    expect(parseTokenStatus("belirsiz")).toBe("expired");
  });

  it("dört durum tanımlı", () => {
    expect(Object.keys(TOKEN_STATUS_LABEL)).toHaveLength(4);
  });

  it("etkin token yeşil", () => {
    expect(tokenTone("active")).toBe("good");
  });

  it("kullanılmış token nötr", () => {
    expect(tokenTone("used")).toBe("neutral");
  });

  it("iptal edilmiş token kırmızı", () => {
    expect(tokenTone("revoked")).toBe("bad");
  });
});

describe("token kaydı", () => {
  it("kimlik okunur", () => {
    expect(parseToken({ id: "kurulum-1" }).id).toBe("kurulum-1");
  });

  it("özet ön eki okunur", () => {
    expect(parseToken({ digest_prefix: "abcd1234" }).digestPrefix).toBe("abcd1234");
  });

  it("kullanılmamış tokenda kullanım anı null", () => {
    expect(parseToken({}).usedAtMs).toBeNull();
  });

  it("kullanım günlüğü çözülür", () => {
    const token = parseToken({ usage_log: [{ at_ms: 5, action: "redeem" }] });
    expect(token.usageLog[0].action).toBe("redeem");
  });

  it("liste yanıtı çözülür", () => {
    expect(parseTokens({ tokens: [{ id: "a" }, { id: "b" }] })).toHaveLength(2);
  });

  it("boş liste yanıtı boş", () => {
    expect(parseTokens(null)).toEqual([]);
  });

  it("üretim yanıtında token metni bulunur", () => {
    expect(parseIssuedToken({ token: "gizli-metin" }).token).toBe("gizli-metin");
  });

  it("metinsiz üretim yanıtı boş metin döner", () => {
    // Boş bir metni "token" diye kopyalatmak, kurulumu sahada bozar.
    expect(parseIssuedToken({}).token).toBe("");
  });

  it("liste kaydında token alanı yoktur", () => {
    const token = parseToken({ id: "a", token: "sızmış" });
    expect(Object.keys(token)).not.toContain("token");
  });
});

describe("token metinleri", () => {
  it("etkin tokenda kalan süre yazılır", () => {
    const token = parseToken({ status: "active", remaining_ms: 3_600_000 });
    expect(tokenCaption(token)).toBe("1 sa geçerli");
  });

  it("kullanılmış tokenda kim kullandı yazılır", () => {
    // Sayı göstermek onu hâlâ kullanılabilir sanmaya yol açardı.
    const token = parseToken({ status: "used", used_by: "ayşe" });
    expect(tokenCaption(token)).toBe("ayşe tarafından kullanıldı");
  });

  it("kullananı bilinmeyen token da anlatılır", () => {
    const token = parseToken({ status: "used" });
    expect(tokenCaption(token)).toContain("bilinmeyen kişi");
  });

  it("iptal edilen tokenda neden yazılır", () => {
    const token = parseToken({ status: "revoked", revoked_reason: "yanlış kişi" });
    expect(tokenCaption(token)).toBe("yanlış kişi");
  });

  it("süresi dolan tokenda yenisi istenir", () => {
    const token = parseToken({ status: "expired" });
    expect(tokenCaption(token)).toContain("yeni token");
  });
});

describe("süre biçimi", () => {
  it("ölçülemeyen süre tire", () => {
    expect(formatDuration(null)).toBe(NOT_MEASURED);
  });

  it("saniye", () => {
    expect(formatDuration(4_000)).toBe("4 sn");
  });

  it("dakika", () => {
    expect(formatDuration(180_000)).toBe("3 dk");
  });

  it("saat", () => {
    expect(formatDuration(7_200_000)).toBe("2 sa");
  });

  it("gün", () => {
    expect(formatDuration(3 * 86_400_000)).toBe("3 gün");
  });
});

describe("makine etiketleri", () => {
  it("etiket çözülür", () => {
    const review = parseLabelReview({ labels: [{ machine_id: "a", label: "FREZE-01" }] });
    expect(review.labels[0].label).toBe("FREZE-01");
  });

  it("basılmamış etiketin anı null", () => {
    const review = parseLabelReview({ labels: [{ machine_id: "a", label: "FREZE-01" }] });
    expect(review.labels[0].printedAtMs).toBeNull();
  });

  it("çakışmalar okunur", () => {
    expect(parseLabelReview({ duplicates: ["FREZE-01"] }).duplicates).toEqual(["FREZE-01"]);
  });

  it("etiketsiz makineler okunur", () => {
    expect(parseLabelReview({ unlabeled: ["TORNA_01"] }).unlabeled).toEqual(["TORNA_01"]);
  });

  it("türetilemeyen öneri null kalır", () => {
    // Uydurulmuş bir etiket, sahada yanlış makineye yapıştırılan kâğıttır.
    const review = parseLabelReview({ suggestions: { hat: null } });
    expect(review.suggestions.hat).toBeNull();
  });

  it("türetilen öneri okunur", () => {
    const review = parseLabelReview({ suggestions: { torna_1: "TORNA-01" } });
    expect(review.suggestions.torna_1).toBe("TORNA-01");
  });

  it("çakışma uyarısı üretilir", () => {
    const uyarılar = labelWarnings(parseLabelReview({ duplicates: ["FREZE-01"] }));
    expect(uyarılar[0]).toContain("birden çok makinede");
  });

  it("etiketsiz makine uyarısı üretilir", () => {
    const uyarılar = labelWarnings(parseLabelReview({ unlabeled: ["A", "B"] }));
    expect(uyarılar[0]).toContain("2 makinenin etiketi yok");
  });

  it("sorun yoksa uyarı yok", () => {
    expect(labelWarnings(parseLabelReview({}))).toEqual([]);
  });

  it("etiket yoksa basım oranı null", () => {
    // "%0 basıldı" demek, basılacak bir şeyi olmayan kurulumu eksik gösterirdi.
    expect(printedRatio(parseLabelReview({}))).toBeNull();
  });

  it("basım oranı hesaplanır", () => {
    const review = { ...parseLabelReview({}), labels: [etiket("A-01", 5), etiket("A-02")] };
    expect(printedRatio(review)).toBe(0.5);
  });
});

describe("etiket sayfası", () => {
  it("sayfa başına yirmi dört etiket", () => {
    expect(LABELS_PER_PAGE).toBe(24);
  });

  it("etiket yoksa sayfa yok", () => {
    expect(paginate([])).toEqual([]);
  });

  it("tek sayfa", () => {
    expect(paginate([etiket("A-01")])).toHaveLength(1);
  });

  it("sayfa taşınca ikinci sayfa açılır", () => {
    const etiketler = Array.from({ length: LABELS_PER_PAGE + 1 }, (_, i) =>
      etiket(`A-${i}`),
    );
    expect(paginate(etiketler)).toHaveLength(2);
  });

  it("son sayfa doldurulmaz", () => {
    // Boş hücrelere yer tutucu koymak, kesilecek kâğıtta anlamsız kutular
    // bırakırdı.
    const etiketler = Array.from({ length: LABELS_PER_PAGE + 1 }, (_, i) =>
      etiket(`A-${i}`),
    );
    expect(paginate(etiketler)[1].cells).toHaveLength(1);
  });

  it("sayfa sayısı hesaplanır", () => {
    expect(pageCount(Array.from({ length: 25 }, (_, i) => etiket(`A-${i}`)))).toBe(2);
  });

  it("etiket sayısı", () => {
    expect(labelCount([etiket("A-01")])).toBe(1);
  });

  it("dosya adı fabrikayı taşır", () => {
    expect(labelFileName("Pilot")).toBe("makine-etiketleri-Pilot");
  });

  it("fabrikasız dosya adı genel", () => {
    expect(labelFileName("  ")).toBe("makine-etiketleri");
  });

  it("hücre açıklaması hattı taşır", () => {
    const [sayfa] = paginate([etiket("A-01")]);
    expect(cellCaption(sayfa.cells[0])).toContain("Hat 1");
  });

  it("hatsız hücrede yalnızca makine kimliği", () => {
    const [sayfa] = paginate([{ ...etiket("A-01"), line: "" }]);
    expect(cellCaption(sayfa.cells[0])).toBe("a_01");
  });
});

describe("kontrol listesi", () => {
  it("tanınan durum geçer", () => {
    expect(parseStepState("done")).toBe("done");
  });

  it("tanınmayan durum ölçülemedi olur", () => {
    expect(parseStepState("belki")).toBe("unknown");
  });

  it("üç durum tanımlı", () => {
    expect(Object.keys(STEP_STATE_LABEL)).toHaveLength(3);
  });

  it("nedeni olmayan adıma durum yazılır", () => {
    expect(parseChecklistStep({ state: "pending" }).reason).toBe("Bekliyor");
  });

  it("sunucunun nedeni korunur", () => {
    expect(parseChecklistStep({ reason: "Yedek yok" }).reason).toBe("Yedek yok");
  });

  it("yapılacak iş yoksa null", () => {
    expect(parseChecklistStep({ state: "done" }).action).toBeNull();
  });

  it("boş gövde varsayılan rapor", () => {
    expect(parseDeployment(null)).toBe(EMPTY_DEPLOYMENT);
  });

  it("varsayılan rapor hazır değil", () => {
    expect(EMPTY_DEPLOYMENT.ready).toBe(false);
  });

  it("adımlar çözülür", () => {
    const rapor = parseDeployment({ steps: [{ id: "server" }, { id: "license" }] });
    expect(rapor.steps).toHaveLength(2);
  });

  it("sunucu saymadıysa adımlardan sayılır", () => {
    const rapor = parseDeployment({ steps: [{ id: "a", state: "done" }] });
    expect(rapor.done).toBe(1);
  });

  it("özet cümlesi taşınır", () => {
    const rapor = parseDeployment({ summary: "9/10 adım tamam" });
    expect(deploymentCaption(rapor)).toBe("9/10 adım tamam");
  });

  it("tamamlanan adım yeşil", () => {
    expect(stepTone("done")).toBe("good");
  });

  it("bekleyen adım uyarı", () => {
    expect(stepTone("pending")).toBe("warning");
  });

  it("ölçülemeyen adım nötr", () => {
    // Bilinmeyen bir adımı yeşil göstermek, listeyi güvenilmez kılardı.
    expect(stepTone("unknown")).toBe("neutral");
  });
});

describe("saha tanılama", () => {
  it("tanınan durum geçer", () => {
    expect(parseProbeState("failed")).toBe("failed");
  });

  it("tanınmayan durum ölçülmedi olur", () => {
    expect(parseProbeState("kopuk")).toBe("unknown");
  });

  it("dört durum tanımlı", () => {
    expect(Object.keys(PROBE_STATE_LABEL)).toHaveLength(4);
  });

  it("ölçülen değer okunur", () => {
    expect(parseDiagnosticLine({ value: 12.5 }).value).toBe(12.5);
  });

  it("ölçülmeyen satır null kalır", () => {
    expect(parseDiagnosticLine({}).value).toBeNull();
  });

  it("nedensiz ölçülmeyen satıra neden yazılır", () => {
    expect(parseDiagnosticLine({}).reason).toBe("Sunucu bu satırı bildirmedi");
  });

  it("metin sonuç ölçülmüş sayılır", () => {
    expect(parseDiagnosticLine({ text: "Bağlandı" }).measured).toBe(true);
  });

  it("ölçülen değer birimiyle yazılır", () => {
    const satır = parseDiagnosticLine({ value: 12.5, unit: "ms" });
    expect(lineValue(satır)).toBe("12,5 ms");
  });

  it("metin sonuç olduğu gibi yazılır", () => {
    expect(lineValue(parseDiagnosticLine({ text: "Bağlandı" }))).toBe("Bağlandı");
  });

  it("ölçülmeyen satır tire yazar", () => {
    expect(lineValue(parseDiagnosticLine({}))).toBe(NOT_MEASURED);
  });

  it("boş gövde varsayılan tanılama", () => {
    expect(parseFieldDiagnostics(null)).toBe(EMPTY_FIELD_DIAGNOSTICS);
  });

  it("satırlar çözülür", () => {
    const rapor = parseFieldDiagnostics({ lines: [{ id: "ping" }, { id: "mqtt" }] });
    expect(rapor.lineCount).toBe(2);
  });

  it("ölçülen sayısı türetilir", () => {
    const rapor = parseFieldDiagnostics({ lines: [{ id: "a", value: 1 }, { id: "b" }] });
    expect(rapor.measuredCount).toBe(1);
  });

  it("kaç satırın ölçüldüğü yazılır", () => {
    // Yedi satırdan ikisinin ölçüldüğü ekranda "her şey normal" yanıltıcıdır.
    const rapor = parseFieldDiagnostics({ lines: [{ id: "a", value: 1 }, { id: "b" }] });
    expect(diagnosticsCaption(rapor)).toBe("2 ölçütten 1 tanesi ölçüldü");
  });

  it("okunmamış tanılamada bunu söyler", () => {
    expect(diagnosticsCaption(EMPTY_FIELD_DIAGNOSTICS)).toContain("henüz okunmadı");
  });

  it("başarısız satır kırmızı", () => {
    expect(probeTone("failed")).toBe("bad");
  });

  it("ölçülmeyen satır nötr", () => {
    expect(probeTone("unknown")).toBe("neutral");
  });
});
