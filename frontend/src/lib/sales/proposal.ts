/**
 * Teklif belgesi.
 *
 * Rapor katmanının `ReportDocument` şemasını kullanır: kapak, bloklar ve
 * pdfmake çizicisi zaten var ve Türkçe glifleri gömülü Roboto ile doğru
 * basıyor. Teklife özel ikinci bir PDF hattı yazmak, aynı yazı tipi ve sayfa
 * taşması sorunlarını ikinci kez çözmek olurdu.
 *
 * Rakamlar `pricing.buildQuote`'tan gelir; burada hiçbir tutar hesaplanmaz.
 * Ekranda gösterilen teklifle müşteriye giden PDF'in ayrışması bu sayede
 * mümkün değildir.
 */

import {
  NOT_MEASURED,
  fileDateStamp,
  formatReportDate,
  money,
  slugify,
  type ReportBlock,
  type ReportDocument,
} from "../reports";
import { PLANS, PLAN_ORDER, estimateFirstMonthSaving } from "./pricing";
import type { Lead, Quote } from "./types";

/**
 * Matris işaretleri.
 *
 * Onay işareti (U+2713) **kullanılamaz**: PDF’e gömülen Roboto alt kümesi bu
 * karakteri içermiyor ve pdfmake onu notdef olarak basıyor — karşılaştırma
 * tablosundaki kapsanan özellikler boş hücre olarak görünüyordu. Üretilen
 * PDF’ten metin çıkarılarak doğrulandı. Buradaki iki işaret de gömülü yazı
 * tipinde kesin olarak bulunan karakterlerden oluşur.
 */
export const INCLUDED_MARK = "Var";
export const EXCLUDED_MARK = "—";

export interface ProposalInput {
  lead: Lead;
  quote: Quote;
  /** Teklifin hazırlandığı an. */
  preparedAt: Date;
  /** Teklifi hazırlayan firma. */
  vendorName: string;
  /** Demoda ölçülmüş aylık kayıp; bilinmiyorsa `null`. */
  monthlyLoss: number | null;
}

/** Teklifin dosya adı (uzantısız). */
export function proposalFileName(input: ProposalInput): string {
  return `optiflow-teklif-${slugify(input.lead.company)}-${fileDateStamp(input.preparedAt)}`;
}

export function buildProposalDocument(input: ProposalInput): ReportDocument {
  const { lead, quote, preparedAt, vendorName, monthlyLoss } = input;
  const saving = estimateFirstMonthSaving(monthlyLoss, quote.monthly);

  const blocks: ReportBlock[] = [];

  /* --- Neden bu paket --- */
  blocks.push({ kind: "heading", level: 1, text: "Önerilen Paket" });
  blocks.push({ kind: "paragraph", text: quote.rationale });

  blocks.push({
    kind: "kpiGrid",
    items: [
      {
        label: "Paket",
        value: quote.plan.label,
        hint: quote.plan.support,
      },
      {
        label: "Aylık ücret",
        value: money(quote.monthly),
        hint: `${lead.machineCount} makine dâhil`,
      },
      {
        label: "Kurulum (tek seferlik)",
        value: money(quote.setupFee),
        hint: "Veri aktarımı ve eğitim dâhil",
      },
    ],
  });

  /* --- Fiyat tablosu --- */
  blocks.push({ kind: "heading", level: 2, text: "Fiyat Dökümü" });
  blocks.push({
    kind: "table",
    columns: ["Kalem", "Hesap", "Tutar"],
    widths: ["*", "auto", "auto"],
    numericColumns: [2],
    rows: [
      ["Aylık taban ücret", quote.plan.label, money(quote.plan.monthlyBase)],
      [
        "Makine başına aylık",
        `${lead.machineCount} × ${money(quote.plan.monthlyPerMachine)}`,
        money(quote.monthly - quote.plan.monthlyBase),
      ],
      ["Aylık toplam", "", money(quote.monthly)],
      ["Kurulum ücreti", "Tek seferlik", money(quote.setupFee)],
      ["İlk yıl toplamı", "12 ay + kurulum", money(quote.firstYearTotal)],
    ],
  });

  if (saving !== null) {
    blocks.push({
      kind: "note",
      text: `Demoda ölçülen aylık kaybın kurtarılabilir payı ${money(saving.saving)}. Aylık ücret düşüldüğünde ilk aydan itibaren beklenen net etki ${money(saving.net)}.`,
      tone: saving.net > 0 ? "good" : "neutral",
    });
  } else {
    // Ölçülmemiş bir tasarrufu teklife yazmak, ilk faturada tartışma çıkarır.
    blocks.push({
      kind: "note",
      text: "Tasarruf tahmini bu teklife dâhil edilmedi: firmanın kendi verisiyle bir koşum yapılmadan güvenilir bir rakam verilemez.",
      tone: "neutral",
    });
  }

  /* --- Özellik karşılaştırması --- */
  blocks.push({ kind: "pageBreak" });
  blocks.push({ kind: "heading", level: 1, text: "Paket Karşılaştırması" });
  blocks.push({
    kind: "table",
    caption: `Seçilen paket: ${quote.plan.label}`,
    columns: ["Özellik", ...PLAN_ORDER.map((id) => PLANS[id].label)],
    widths: ["*", "auto", "auto", "auto"],
    rows: featureMatrix(),
  });

  blocks.push({
    kind: "table",
    caption: "Kapsam ve destek",
    columns: ["", ...PLAN_ORDER.map((id) => PLANS[id].label)],
    widths: ["auto", "*", "*", "*"],
    rows: [
      ["Aylık taban", ...PLAN_ORDER.map((id) => money(PLANS[id].monthlyBase))],
      [
        "Makine başına",
        ...PLAN_ORDER.map((id) => money(PLANS[id].monthlyPerMachine)),
      ],
      ["Kurulum", ...PLAN_ORDER.map((id) => money(PLANS[id].setupFee))],
      ["Destek", ...PLAN_ORDER.map((id) => PLANS[id].support)],
    ],
  });

  /* --- Geçerlilik ve imza --- */
  blocks.push({ kind: "heading", level: 2, text: "Geçerlilik" });
  blocks.push({
    kind: "paragraph",
    text: `Bu teklif ${formatReportDate(preparedAt)} tarihinde hazırlanmıştır ve 30 gün geçerlidir. Fiyatlara KDV dâhil değildir.`,
    muted: true,
  });

  blocks.push({
    kind: "signature",
    parties: [
      { role: "Satıcı", name: vendorName },
      {
        role: "Müşteri",
        name: `${lead.company} — ${lead.contactName || "Yetkili"}`,
      },
    ],
  });

  return {
    fileName: proposalFileName(input),
    cover: {
      title: "Fiyat Teklifi",
      subtitle: `${quote.plan.label} paketi · ${money(quote.monthly)} / ay`,
      factoryName: lead.company,
      generatedAtLabel: formatReportDate(preparedAt),
      orgName: vendorName,
      facts: [
        { label: "Yetkili", value: lead.contactName || NOT_MEASURED },
        { label: "Sektör / şehir", value: `${lead.sector} · ${lead.city}` },
        {
          label: "Ölçek",
          value: `${lead.machineCount} makine · ${lead.employeeCount} çalışan`,
        },
        { label: "Geçerlilik", value: "30 gün" },
      ],
    },
    blocks,
  };
}

/**
 * Özellik matrisi.
 *
 * Her özellik bir satır, her paket bir sütun. Bir paketin özelliği kapsayıp
 * kapsamadığı `PLANS` içindeki listelerden okunur; matris elle yazılsaydı bir
 * paket güncellendiğinde ikisi ayrışırdı.
 *
 * Üst paketler "alttakinin her şeyi" satırını taşıdığı için kapsama
 * **kümülatiftir**: bir özellik hangi pakette ilk göründüyse, ondan sonraki
 * paketlerin hepsinde vardır.
 */
function featureMatrix(): string[][] {
  const rows: string[][] = [];
  const seen: string[] = [];

  for (const id of PLAN_ORDER) {
    for (const feature of PLANS[id].features) {
      // "Starter'daki her şey" gibi özet satırları matriste yer almaz;
      // kümülatiflik zaten işaretlerle görünür.
      if (feature.includes("her şey") || seen.includes(feature)) {
        continue;
      }
      seen.push(feature);
      const firstIndex = PLAN_ORDER.indexOf(id);
      rows.push([
        feature,
        ...PLAN_ORDER.map((_, index) =>
          index >= firstIndex ? INCLUDED_MARK : EXCLUDED_MARK,
        ),
      ]);
    }
  }

  return rows;
}
