/**
 * Rapor belgelerinin PDF'ten bağımsız şeması.
 *
 * `ReportDocument`, bir raporun **içeriğidir**; nasıl çizileceğini bilmez.
 * Bu ayrım bilinçlidir: hangi sayının hangi başlık altında, hangi sırayla ve
 * hangi açıklamayla görüneceği bir üründür ve sınanabilir olmalıdır. pdfmake'in
 * `docDefinition`'ı doğrudan kurulsaydı, "yönetici özetinde darboğaz yazıyor
 * mu?" sorusunu ancak PDF üretip içine bakarak yanıtlayabilirdik.
 *
 * Aynı yapı yarın başka bir çıktıya da (HTML e-posta, sunucu tarafı PDF)
 * beslenebilir; değişecek olan yalnızca çizici olur.
 */

import type {
  FinancialReport,
  SimulationConfig,
  SimulationRunResponse,
} from "../../types/simulationTypes";

/** Raporun beslendiği tüm girdiler. */
export interface ReportContext {
  /** Açık fabrikanın adı; kaydedilmemiş bir modelde `null`. */
  factoryName: string | null;
  /** Raporun üretildiği an. Dışarıdan verilir ki işlevler saf kalsın. */
  generatedAt: Date;
  config: SimulationConfig | null;
  result: SimulationRunResponse | null;
  report: FinancialReport | null;
  /** Organizasyon adı; kapakta künye olarak görünür. */
  orgName: string | null;
}

/** Kapak sayfasının içeriği. */
export interface ReportCover {
  title: string;
  subtitle: string;
  factoryName: string;
  /** "4 Eylül 2026, 14:32" gibi okunur tarih. */
  generatedAtLabel: string;
  orgName: string | null;
  /** Kapakta gösterilen dört künye satırı. */
  facts: { label: string; value: string }[];
}

export type BlockTone = "good" | "warning" | "bad" | "neutral";

/** Tabloda tek bir sütunun genişlik davranışı. */
export type ColumnWidth = "auto" | "*" | number;

export interface KpiItem {
  label: string;
  value: string;
  hint?: string;
  tone?: BlockTone;
}

export interface BarItem {
  label: string;
  /** 0-1 arası dolgu oranı. */
  ratio: number;
  /** Çubuğun yanında yazan değer. */
  display: string;
  tone: BlockTone;
}

export interface HeatCell {
  stationName: string;
  /** 0-100 arası ısı skoru. */
  score: number;
  band: "green" | "yellow" | "orange" | "red";
  /** Mutlak kayıp; skor göreli olduğu için birlikte gösterilir. */
  lossLabel: string;
  isBottleneck: boolean;
}

/**
 * Rapor gövdesinin yapı taşları.
 *
 * Her blok bağımsızdır ve sırayla akar; sayfa sonu kararını çizici verir
 * (`pageBreak` bloğu dışında). Blokların kendi içinde sayfa bölmesi yapmaması
 * bilinçlidir — bölme kuralı tek yerde, çizicide durur.
 */
export type ReportBlock =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "paragraph"; text: string; muted?: boolean }
  | { kind: "kpiGrid"; items: KpiItem[] }
  | {
      kind: "table";
      caption?: string;
      columns: string[];
      rows: string[][];
      widths?: ColumnWidth[];
      /** Sağa yaslanacak sütun indeksleri (sayısal sütunlar). */
      numericColumns?: number[];
    }
  | { kind: "bars"; caption?: string; items: BarItem[] }
  | { kind: "heatmap"; caption?: string; cells: HeatCell[]; isRelative: boolean }
  | { kind: "note"; text: string; tone?: BlockTone }
  | { kind: "pageBreak" };

export interface ReportDocument {
  /** PDF meta başlığı ve indirilen dosyanın adı. */
  fileName: string;
  cover: ReportCover;
  blocks: ReportBlock[];
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                       */
/* -------------------------------------------------------------------------- */

/** Bir hücrenin değeri; `null` boş hücredir. */
export type SheetValue = string | number | null;

export interface SheetSpec {
  /** Excel sekmesinin adı. */
  name: string;
  columns: string[];
  rows: SheetValue[][];
  /**
   * Veri yoksa sekmenin en üstüne yazılacak açıklama.
   *
   * Boş bir sekme, kullanıcıya "veri yok mu, hata mı?" diye sordurur; nedenini
   * yazmak bu soruyu ortadan kaldırır.
   */
  emptyNote?: string;
}
