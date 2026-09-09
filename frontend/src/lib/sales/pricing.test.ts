import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_ORDER,
  RECOVERABLE_SHARE,
  buildQuote,
  estimateFirstMonthSaving,
  selectPlan,
} from "./pricing";
import {
  EXCLUDED_MARK,
  INCLUDED_MARK,
  buildProposalDocument,
  proposalFileName,
} from "./proposal";
import { sampleLeads } from "./fixtures";

const NOW = new Date("2026-09-05T09:00:00");

describe("selectPlan", () => {
  it("kucuk atolyeyi Starter'a koyar", () => {
    expect(selectPlan({ machineCount: 5, employeeCount: 12 }).id).toBe("starter");
  });

  it("makine sayisi sinirinda kalirsa Starter'da birakir", () => {
    expect(
      selectPlan({
        machineCount: PLANS.starter.maxMachines,
        employeeCount: PLANS.starter.maxEmployees,
      }).id,
    ).toBe("starter");
  });

  it("yalnizca makine sinirini asmak bir ust pakete tasir", () => {
    // "Ve" ile baglansaydi 15 makineli uc kisilik bir atolye Starter'da
    // kalirdi.
    expect(selectPlan({ machineCount: 15, employeeCount: 3 }).id).toBe("growth");
  });

  it("yalnizca calisan sinirini asmak da bir ust pakete tasir", () => {
    expect(selectPlan({ machineCount: 2, employeeCount: 90 }).id).toBe("growth");
  });

  it("buyuk tesisi Enterprise'a koyar", () => {
    expect(selectPlan({ machineCount: 120, employeeCount: 900 }).id).toBe(
      "enterprise",
    );
  });

  it("gecersiz ve negatif girdide en kucuk pakete duser", () => {
    expect(selectPlan({ machineCount: -5, employeeCount: Number.NaN }).id).toBe(
      "starter",
    );
  });
});

describe("buildQuote", () => {
  it("aylik ucreti taban arti makine basina hesaplar", () => {
    const quote = buildQuote({ machineCount: 8, employeeCount: 20 });
    expect(quote.plan.id).toBe("starter");
    expect(quote.monthly).toBe(
      PLANS.starter.monthlyBase + 8 * PLANS.starter.monthlyPerMachine,
    );
  });

  it("ilk yil toplamina kurulumu ekler", () => {
    const quote = buildQuote({ machineCount: 12, employeeCount: 40 });
    expect(quote.firstYearTotal).toBe(quote.monthly * 12 + quote.setupFee);
  });

  it("sifir makinede taban ucreti korur", () => {
    // Makine sayisi henuz ogrenilmemisken elde "₺0" yazan bir teklif
    // kalmamali.
    const quote = buildQuote({ machineCount: 0, employeeCount: 5 });
    expect(quote.monthly).toBe(PLANS.starter.monthlyBase);
    expect(quote.monthly).toBeGreaterThan(0);
  });

  it("kesirli makine sayisini asagi yuvarlar", () => {
    expect(buildQuote({ machineCount: 8.9, employeeCount: 20 }).monthly).toBe(
      buildQuote({ machineCount: 8, employeeCount: 20 }).monthly,
    );
  });

  it("gerekce secilen paketi ve olcegi anlatir", () => {
    const quote = buildQuote({ machineCount: 34, employeeCount: 120 });
    expect(quote.rationale).toContain("Growth");
    expect(quote.rationale).toContain("34 makine");
    expect(quote.rationale).toContain("120 çalışan");
  });

  it("deterministiktir", () => {
    const input = { machineCount: 15, employeeCount: 55 };
    expect(buildQuote(input)).toEqual(buildQuote(input));
  });

  it("paketler buyudukce taban ucret artar", () => {
    for (let i = 1; i < PLAN_ORDER.length; i += 1) {
      expect(PLANS[PLAN_ORDER[i]].monthlyBase).toBeGreaterThan(
        PLANS[PLAN_ORDER[i - 1]].monthlyBase,
      );
      expect(PLANS[PLAN_ORDER[i]].setupFee).toBeGreaterThan(
        PLANS[PLAN_ORDER[i - 1]].setupFee,
      );
    }
  });
});

describe("estimateFirstMonthSaving", () => {
  it("kayip bilinmiyorsa null doner", () => {
    // Olculmemis bir tasarrufu teklife yazmak, ilk faturada tartisma cikarir.
    expect(estimateFirstMonthSaving(null, 9_000)).toBeNull();
    expect(estimateFirstMonthSaving(0, 9_000)).toBeNull();
    expect(estimateFirstMonthSaving(Number.NaN, 9_000)).toBeNull();
  });

  it("kurtarilabilir payi uzerinden hesaplar", () => {
    const result = estimateFirstMonthSaving(100_000, 9_000);
    expect(result?.saving).toBe(Math.round(100_000 * RECOVERABLE_SHARE));
    expect(result?.net).toBe(result!.saving - 9_000);
  });

  it("ucret tasarrufu asarsa net negatif kalir", () => {
    // Negatifi gizlemek, satiscinin savunamayacagi bir vaat olurdu.
    const result = estimateFirstMonthSaving(10_000, 9_000);
    expect(result?.net).toBeLessThan(0);
  });
});

describe("buildProposalDocument", () => {
  const lead = sampleLeads(NOW)[0];
  const quote = buildQuote({
    machineCount: lead.machineCount,
    employeeCount: lead.employeeCount,
  });
  const input = {
    lead,
    quote,
    preparedAt: NOW,
    vendorName: "OptiFlow",
    monthlyLoss: 180_000,
  };

  it("kapakta firma, tarih ve paket bulunur", () => {
    const doc = buildProposalDocument(input);
    expect(doc.cover.factoryName).toBe("ABC Metal");
    expect(doc.cover.title).toBe("Fiyat Teklifi");
    expect(doc.cover.subtitle).toContain(quote.plan.label);
    expect(doc.cover.generatedAtLabel).toContain("2026");
  });

  it("dosya adi Turkce harfleri ASCII'ye cevirir", () => {
    const doc = buildProposalDocument({
      ...input,
      lead: { ...lead, company: "Toros Döküm A.Ş." },
    });
    expect(doc.fileName).toBe("optiflow-teklif-toros-dokum-a-s-2026-09-05");
    expect(proposalFileName({ ...input, lead: { ...lead, company: "Toros Döküm A.Ş." } })).toBe(
      doc.fileName,
    );
  });

  it("fiyat tablosundaki aylik toplam teklifle ayni", () => {
    // Ekranda gorulen rakamla musteriye giden rakam ayrisamaz.
    const doc = buildProposalDocument(input);
    const table = doc.blocks.find(
      (block) => block.kind === "table" && block.columns.includes("Hesap"),
    );
    expect(table).toBeDefined();
    if (table?.kind === "table") {
      const row = table.rows.find((item) => item[0] === "Aylık toplam");
      expect(row?.[2]).toContain(String(quote.monthly).slice(0, 2));
    }
  });

  it("imza alanini iki tarafla ekler", () => {
    const doc = buildProposalDocument(input);
    const signature = doc.blocks.find((block) => block.kind === "signature");
    expect(signature).toBeDefined();
    if (signature?.kind === "signature") {
      expect(signature.parties).toHaveLength(2);
      expect(signature.parties[1].name).toContain("ABC Metal");
    }
  });

  it("kayip bilinmiyorsa tasarruf yerine nedenini yazar", () => {
    const doc = buildProposalDocument({ ...input, monthlyLoss: null });
    const notes = doc.blocks.filter((block) => block.kind === "note");
    expect(
      notes.some(
        (note) => note.kind === "note" && note.text.includes("dâhil edilmedi"),
      ),
    ).toBe(true);
  });

  it("ozellik matrisinde her satir uc paketi de kapsar", () => {
    const doc = buildProposalDocument(input);
    const matrix = doc.blocks.find(
      (block) => block.kind === "table" && block.columns[0] === "Özellik",
    );
    expect(matrix).toBeDefined();
    if (matrix?.kind === "table") {
      expect(matrix.rows.length).toBeGreaterThan(0);
      for (const row of matrix.rows) {
        expect(row).toHaveLength(4);
        // Kapsam kumulatiftir: bir ozellik gorundugu paketten sonra hep var.
        const marks = row.slice(1);
        const first = marks.indexOf(INCLUDED_MARK);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(
          marks.slice(first).every((mark) => mark === INCLUDED_MARK),
        ).toBe(true);
      }
    }
  });


  it("teklif metni gomulu yazi tipinde olmayan glif tasimaz", () => {
    /*
     * PDF’e gömülen Roboto alt kümesi ok, matematik ve sembol bloklarını
     * içermez. Böyle bir karakter belgeye girdiğinde hata verilmez; pdfmake
     * onu sessizce notdef olarak basar ve müşteriye giden teklifte boş bir
     * hücre görünür. Bu test o sessiz kaybı yakalar.
     */
    const doc = buildProposalDocument(input);
    const text = [
      doc.cover.title,
      doc.cover.subtitle ?? "",
      ...doc.cover.facts.map((fact) => `${fact.label} ${fact.value}`),
      ...doc.blocks.flatMap((block) => {
        if (block.kind === "table") {
          return [...block.columns, ...block.rows.flat()];
        }
        if (block.kind === "kpiGrid") {
          return block.items.flatMap((item) => [
            item.label,
            item.value,
            item.hint ?? "",
          ]);
        }
        if (block.kind === "signature") {
          return block.parties.flatMap((party) => [party.role, party.name]);
        }
        return "text" in block ? [block.text] : [];
      }),
    ].join(" ");

    const unsupported = [...text].find((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (code >= 0x2190 && code <= 0x2bff) || code >= 0x1f000;
    });
    expect(unsupported).toBeUndefined();

    // Isaretler yine de anlasilir kalmali.
    expect(text).toContain(INCLUDED_MARK);
    expect(text).toContain(EXCLUDED_MARK);
  });

  it("ozet satirlari matriste yer almaz", () => {
    const doc = buildProposalDocument(input);
    const matrix = doc.blocks.find(
      (block) => block.kind === "table" && block.columns[0] === "Özellik",
    );
    if (matrix?.kind === "table") {
      expect(matrix.rows.some((row) => row[0].includes("her şey"))).toBe(false);
    }
  });
});
