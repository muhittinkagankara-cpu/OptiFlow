/**
 * QR etiket belgesinin kurulumu.
 *
 * Etiketler A4'e basılır ve makinelerin üstüne yapıştırılır. Belge, mevcut
 * rapor altyapısını kullanır: yeni bir çizim katmanı yazmak, aynı yazı tipi
 * ve sayfa düzeni sorunlarını ikinci kez çözmek olurdu.
 *
 * QR neden tablo hücresinde
 * -------------------------
 * `pdfmake` bir QR bloğunu doğrudan destekler ama rapor katmanının blok
 * sözlüğünde böyle bir tür yok. Yeni bir blok türü eklemek, PDF çizicisini
 * bu sprintte değiştirmek demekti. Bunun yerine QR **içeriği** metin olarak
 * basılır: sahadaki telefon kamerası bir QR okuyamaz ama teknisyen kodu
 * elle girebilir ve etiket kimliği kâğıtta okunur kalır. Gerçek QR çizimi
 * ayrı bir sprintin işidir ve bu belge onu **iddia etmez**.
 */

import type { ReportBlock, ReportDocument } from "../reports/types";
import { LABELS_PER_PAGE, labelFileName, paginate } from "./labels";
import type { MachineLabel } from "./types";

/**
 * Etiket sayfalarının belgesi.
 *
 * Etiket yoksa boş bir belge değil, **nedenini yazan** bir belge üretilir:
 * boş bir PDF, kullanıcıya bir şeyin bozulduğunu düşündürürdü.
 */
export function buildLabelDocument(
  labels: MachineLabel[],
  factoryName: string,
): ReportDocument {
  const pages = paginate(labels);
  const blocks: ReportBlock[] = [
    { kind: "heading", level: 1, text: "Makine Etiketleri" },
    {
      kind: "paragraph",
      text:
        "Her satır bir makinenin sahadaki kalıcı kimliğidir. QR içeriği adres " +
        "değil kimlik taşır; sunucu adresi değişse de etiketler geçerli kalır.",
      muted: true,
    },
  ];

  if (pages.length === 0) {
    blocks.push({
      kind: "note",
      text: "Basılacak etiket yok. Önce makinelere saha kimliği verin.",
      tone: "warning",
    });
    return document(blocks, factoryName);
  }

  pages.forEach((page, index) => {
    if (index > 0) blocks.push({ kind: "pageBreak" });
    blocks.push({
      kind: "table",
      caption: `Sayfa ${index + 1} · ${page.cells.length} etiket`,
      columns: ["Etiket", "Makine", "Hat", "QR içeriği"],
      rows: page.cells.map((cell) => [
        cell.label,
        cell.machineId,
        cell.line || "—",
        cell.qr,
      ]),
      widths: ["auto", "auto", "auto", "*"],
    });
  });

  return document(blocks, factoryName);
}

function document(blocks: ReportBlock[], factoryName: string): ReportDocument {
  const total = blocks.filter((block) => block.kind === "table").length;
  return {
    fileName: labelFileName(factoryName),
    cover: {
      title: "Makine Etiketleri",
      subtitle: "Sahaya basılacak kalıcı kimlikler",
      factoryName,
      generatedAtLabel: new Date().toLocaleString("tr-TR"),
      orgName: null,
      facts: [
        { label: "Sayfa", value: String(total) },
        { label: "Sayfa başına", value: String(LABELS_PER_PAGE) },
        { label: "Biçim", value: "HARFLER-SAYI" },
        { label: "QR", value: "Kimlik" },
      ],
    },
    blocks,
  };
}
