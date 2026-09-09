/**
 * QR etiket sayfasının düzeni.
 *
 * Etiketler A4'e basılır ve makinelerin üstüne yapıştırılır. Bu dosya
 * **düzeni** hesaplar: kaç sütun, kaç satır, hangi etiket hangi sayfada.
 * Çizim `lib/reports/pdf` içindedir.
 *
 * Neden ızgara sabit
 * ------------------
 * Üç sütun ve sekiz satır (sayfa başına 24 etiket), yaygın A4 etiket
 * kâğıtlarına yakındır ve elde kesilebilir. Değişken bir ızgara, her
 * kurulumda farklı bir kâğıt gerektirirdi.
 *
 * QR neden kimlik taşır
 * ---------------------
 * İçerik `optiflow:makine/<kiracı>/<etiket>` biçimindedir. Bir URL yazılsaydı,
 * sunucu adresi değiştiğinde fabrikadaki bütün etiketlerin yeniden basılması
 * gerekirdi.
 */

import type { MachineLabel } from "./types";

/** Sayfadaki sütun sayısı. */
export const LABEL_COLUMNS = 3;

/** Sayfadaki satır sayısı. */
export const LABEL_ROWS = 8;

/** Bir sayfaya sığan etiket sayısı. */
export const LABELS_PER_PAGE = LABEL_COLUMNS * LABEL_ROWS;

/** Basılacak tek bir etiket. */
export interface LabelCell {
  label: string;
  machineId: string;
  line: string;
  qr: string;
}

/** Bir sayfadaki etiketler. */
export interface LabelPage {
  index: number;
  cells: LabelCell[];
}

/**
 * Etiketleri sayfalara böler.
 *
 * Son sayfa **doldurulmaz**: boş hücrelere yer tutucu koymak, kesilecek
 * kâğıtta anlamsız kutular bırakırdı.
 */
export function paginate(labels: MachineLabel[]): LabelPage[] {
  const pages: LabelPage[] = [];
  for (let start = 0; start < labels.length; start += LABELS_PER_PAGE) {
    pages.push({
      index: pages.length,
      cells: labels.slice(start, start + LABELS_PER_PAGE).map((item) => ({
        label: item.label,
        machineId: item.machineId,
        line: item.line,
        qr: item.qr,
      })),
    });
  }
  return pages;
}

/**
 * Basılacak etiket sayısı.
 *
 * Yalnızca **basılmamış** etiketler değil, hepsi sayılır: bir etiket
 * yıpranıp yeniden basılabilir ve kullanıcı hangisini basacağını kendisi
 * seçer.
 */
export function labelCount(labels: MachineLabel[]): number {
  return labels.length;
}

/** Kaç sayfa çıkacak? Etiket yoksa sıfır. */
export function pageCount(labels: MachineLabel[]): number {
  return Math.ceil(labels.length / LABELS_PER_PAGE);
}

/**
 * Etiket sayfasının dosya adı.
 *
 * Fabrika adı boşsa genel bir ad kullanılır; boş bir dosya adı, indirilen
 * dosyanın hangi kuruluma ait olduğunu bilinemez kılardı.
 */
export function labelFileName(factoryName: string): string {
  const cleaned = factoryName.trim();
  return cleaned.length > 0 ? `makine-etiketleri-${cleaned}` : "makine-etiketleri";
}

/**
 * Bir hücrenin QR'ının altında yazan metin.
 *
 * Etiket adı **büyük** ve tek başına yazılır; hattın adı altına küçük gelir.
 * Sahada okunacak olan etikettir, hat değil.
 */
export function cellCaption(cell: LabelCell): string {
  return cell.line.length > 0 ? `${cell.line} · ${cell.machineId}` : cell.machineId;
}
