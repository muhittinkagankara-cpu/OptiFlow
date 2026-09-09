/**
 * `ReportDocument` → PDF çizici.
 *
 * Bu dosya raporun **tek** yan etkili parçasıdır: içerik kararları
 * `executive.ts` ve `technical.ts` içinde, sınanabilir biçimde verilmiştir;
 * burada yalnızca çizim yapılır.
 *
 * Sayfa taşmaları
 * ---------------
 * Taşma üç ayrı yerde çözülür ve üçü de burada toplanır:
 *
 * 1. **Satır taşması** — pdfmake tabloyu kendiliğinden sayfalara böler.
 *    `headerRows: 1` başlığı her sayfada tekrarlar, `dontBreakRows: true` bir
 *    satırın ortadan ikiye bölünmesini engeller. Bunlar olmadan ikinci sayfada
 *    başlıksız sayılar ve yarım kesilmiş satırlar kalırdı.
 * 2. **Sütun taşması** — `splitWideTable` (bkz. `tables.ts`) geniş tabloyu
 *    sayfaya sığan parçalara ayırır; bu karar saf ve sınanmıştır.
 * 3. **Başlık yalnızlığı** — başlık ile onu izleyen ilk blok `unbreakable` bir
 *    yığında birleştirilir; aksi hâlde bir başlık sayfanın en altında tek
 *    başına kalabilirdi.
 *
 * Yazı tipi
 * ---------
 * Roboto gömülüdür ve Türkçe'nin tamamını (ğ, ş, İ, ı) ve ₺ işaretini kapsar.
 * pdfmake'in standart yazı tipleri WinAnsi kodlamasıyla sınırlı olsaydı
 * "Darboğaz" ve "İstasyon" bozuk çıkardı.
 *
 * pdfmake ve gömülü yazı tipleri yaklaşık bir megabayttır; bu yüzden **devingen
 * olarak** yüklenir (`import()`). Kullanıcı rapor almadıkça uygulamanın ilk
 * açılışına hiçbir maliyet bindirmez.
 *
 * Sürüm notu: 0.2 serisi kullanılıyor. 0.3.11 tarayıcıda çalışmıyor — paketlenmiş
 * zlib'i geliştirmede `Z_DATA_ERROR` atıyor, üretim derlemesinde ise sessizce
 * askıda kalıyor. 0.2 serisi tarayıcıda yaygın kullanılan sürüm ve aynı Roboto
 * yazı tipini taşıyor.
 */

import type {
  BarItem,
  HeatCell,
  KpiItem,
  ReportBlock,
  ReportDocument,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Renkler — ekrandaki koyu tema değil, kâğıt için açık tema                    */
/* -------------------------------------------------------------------------- */

/*
 * Rapor beyaz kâğıda basılır. Uygulamanın koyu paleti doğrudan kullanılsaydı
 * ya siyah zemin yazdırılır ya da açık gri metin okunamazdı. Bu yüzden
 * raporun kendi paleti var ve baskıda okunacak kontrastta seçildi.
 */
const INK = "#0F172A";
const MUTED = "#64748B";
const HAIRLINE = "#E2E8F0";
const BRAND = "#2563EB";

const TONE_COLOR: Record<string, string> = {
  good: "#15803D",
  warning: "#B45309",
  bad: "#B91C1C",
  neutral: MUTED,
};

const BAND_COLOR: Record<HeatCell["band"], string> = {
  green: "#DCFCE7",
  yellow: "#FEF9C3",
  orange: "#FFEDD5",
  red: "#FEE2E2",
};

const BAND_LABEL: Record<HeatCell["band"], string> = {
  green: "Düşük",
  yellow: "Orta",
  orange: "Yüksek",
  red: "Kritik",
};

/** Gövde genişliği (punto): A4 eni 595 − iki yandan 40'ar. */
const BODY_WIDTH = 515;

/** Gömülü Roboto ailesi; dosya adları `vfs_fonts` içindeki anahtarlardır. */
const ROBOTO = {
  normal: "Roboto-Regular.ttf",
  bold: "Roboto-Medium.ttf",
  italics: "Roboto-Italic.ttf",
  bolditalics: "Roboto-MediumItalic.ttf",
} as const;

/* -------------------------------------------------------------------------- */

/**
 * Belgeyi PDF'e çevirip indirir.
 *
 * `logoDataUrl` yalnızca PNG/JPEG veri URL'i olmalıdır; doğrulaması
 * `logo.ts` içindedir ve çağıran tarafından yapılmış sayılır.
 */
export async function downloadPdf(
  document: ReportDocument,
  logoDataUrl: string | null,
): Promise<void> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import("pdfmake/build/pdfmake.js"),
    import("pdfmake/build/vfs_fonts.js"),
  ]);

  pdfMake.addVirtualFileSystem(vfs);
  // 0.2 serisinde varsayılan yazı tipi eşlemesi gelmiyor; Roboto elle
  // kaydedilir. Kaydedilmezse pdfmake standart (WinAnsi) yazı tipine düşer ve
  // "Darboğaz" ile "İstasyon" bozuk çıkar.
  pdfMake.addFonts({ Roboto: ROBOTO });
  pdfMake
    .createPdf(buildDocDefinition(document, logoDataUrl))
    .download(`${document.fileName}.pdf`);
}

/* -------------------------------------------------------------------------- */

type PdfNode = Record<string, unknown>;

/** `ReportDocument`'ı pdfmake belge tanımına çevirir. */
export function buildDocDefinition(
  document: ReportDocument,
  logoDataUrl: string | null,
): Record<string, unknown> {
  return {
    info: {
      title: `${document.cover.title} — ${document.cover.factoryName}`,
      author: document.cover.orgName ?? "OptiFlow",
      creator: "OptiFlow",
    },
    pageSize: "A4",
    pageMargins: [40, 46, 40, 54],
    defaultStyle: { font: "Roboto", fontSize: 9, color: INK, lineHeight: 1.25 },
    content: [...coverNodes(document, logoDataUrl), ...bodyNodes(document.blocks)],
    footer: footer(document),
    styles: {
      h1: { fontSize: 15, bold: true, margin: [0, 14, 0, 6] },
      h2: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      caption: { fontSize: 8, color: MUTED, margin: [0, 0, 0, 4] },
      th: { fontSize: 8, bold: true, color: MUTED },
    },
  };
}

/* --- Kapak ------------------------------------------------------------------ */

function coverNodes(
  document: ReportDocument,
  logoDataUrl: string | null,
): PdfNode[] {
  const { cover } = document;
  const nodes: PdfNode[] = [];

  if (logoDataUrl !== null) {
    // `fit` oranı korur: geniş bir logo kutuyu taşırmaz, uzun bir logo
    // ezilmez.
    nodes.push({ image: logoDataUrl, fit: [150, 52], margin: [0, 0, 0, 24] });
  }

  nodes.push(
    { text: cover.title, fontSize: 26, bold: true, margin: [0, logoDataUrl ? 0 : 40, 0, 2] },
    { text: cover.subtitle, fontSize: 11, color: MUTED, margin: [0, 0, 0, 26] },
    {
      canvas: [
        { type: "line", x1: 0, y1: 0, x2: BODY_WIDTH, y2: 0, lineWidth: 2, lineColor: BRAND },
      ],
      margin: [0, 0, 0, 22],
    },
    { text: "Fabrika", fontSize: 8, color: MUTED },
    { text: cover.factoryName, fontSize: 18, bold: true, margin: [0, 1, 0, 14] },
    { text: "Rapor tarihi", fontSize: 8, color: MUTED },
    { text: cover.generatedAtLabel, fontSize: 12, margin: [0, 1, 0, 22] },
  );

  if (cover.orgName !== null) {
    nodes.push(
      { text: "Organizasyon", fontSize: 8, color: MUTED },
      { text: cover.orgName, fontSize: 12, margin: [0, 1, 0, 22] },
    );
  }

  nodes.push({
    table: {
      widths: ["auto", "*"],
      body: cover.facts.map((fact) => [
        { text: fact.label, fontSize: 8, color: MUTED, margin: [0, 3, 12, 3] },
        { text: fact.value, fontSize: 9, margin: [0, 3, 0, 3] },
      ]),
    },
    layout: hairlineLayout(),
  });

  nodes.push({ text: "", pageBreak: "after" });
  return nodes;
}

/* --- Gövde ------------------------------------------------------------------ */

/**
 * Blokları pdfmake düğümlerine çevirir.
 *
 * Bir başlık, kendisinden sonraki blokla birlikte bölünemez bir yığına
 * konur — böylece başlık sayfanın dibinde yalnız kalmaz.
 */
function bodyNodes(blocks: ReportBlock[]): PdfNode[] {
  const nodes: PdfNode[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (block.kind === "heading") {
      const next = blocks[index + 1];
      // Yalnızca küçük bloklar başlıkla birleştirilir. Tablo birleştirilseydi,
      // sayfaya sığmayan bir tablo başlığıyla birlikte tümüyle sonraki
      // sayfaya itilir ve arada koca bir boşluk kalırdı.
      if (next !== undefined && (next.kind === "paragraph" || next.kind === "note")) {
        nodes.push({
          unbreakable: true,
          stack: [headingNode(block), ...renderBlock(next)],
        });
        index += 1;
        continue;
      }
      nodes.push(headingNode(block));
      continue;
    }

    nodes.push(...renderBlock(block));
  }

  return nodes;
}

function headingNode(block: Extract<ReportBlock, { kind: "heading" }>): PdfNode {
  return { text: block.text, style: block.level === 1 ? "h1" : "h2" };
}

function renderBlock(block: ReportBlock): PdfNode[] {
  switch (block.kind) {
    case "heading":
      return [headingNode(block)];

    case "paragraph":
      return [
        {
          text: block.text,
          color: block.muted ? MUTED : INK,
          fontSize: block.muted ? 9 : 10,
          margin: [0, 0, 0, 6],
        },
      ];

    case "note":
      return [noteNode(block)];

    case "kpiGrid":
      return kpiNodes(block.items);

    case "table":
      return tableNodes(block);

    case "bars":
      return barNodes(block);

    case "heatmap":
      return heatmapNodes(block);

    case "signature":
      return signatureNodes(block);

    case "pageBreak":
      return [{ text: "", pageBreak: "after" }];
  }
}

function noteNode(block: Extract<ReportBlock, { kind: "note" }>): PdfNode {
  const color = TONE_COLOR[block.tone ?? "neutral"];
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: block.text,
            fontSize: 8,
            color,
            margin: [8, 6, 8, 6],
          },
        ],
      ],
    },
    layout: {
      // Sol kenarda ince bir şerit: ton rengi tek başına bilgi taşımadığı için
      // metin de zaten durumu söylüyor; şerit yalnızca gözü çeker.
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 2 : 0),
      vLineColor: () => color,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 2, 0, 8],
  };
}

/**
 * KPI kutuları — satır başına üç kutu.
 *
 * Üçten fazlası A4 eninde okunmaz hâle gelir; ikisi ise sayfayı boş bırakır.
 */
function kpiNodes(items: KpiItem[]): PdfNode[] {
  const perRow = 3;
  const rows: PdfNode[] = [];

  for (let start = 0; start < items.length; start += perRow) {
    const slice = items.slice(start, start + perRow);
    const columns: PdfNode[] = slice.map((item) => ({
      width: "*",
      table: {
        widths: ["*"],
        body: [
          [
            {
              stack: [
                { text: item.label, fontSize: 7, color: MUTED },
                {
                  text: item.value,
                  fontSize: 14,
                  bold: true,
                  color: TONE_COLOR[item.tone ?? "neutral"] ?? INK,
                  margin: [0, 2, 0, 0],
                },
                ...(item.hint === undefined
                  ? []
                  : [{ text: item.hint, fontSize: 7, color: MUTED, margin: [0, 2, 0, 0] }]),
              ],
              margin: [8, 7, 8, 7],
            },
          ],
        ],
      },
      layout: boxLayout(),
    }));

    // Eksik kutular boş sütunla doldurulur; yoksa iki kutu sayfayı kaplar.
    while (columns.length < perRow) {
      columns.push({ width: "*", text: "" });
    }

    rows.push({ columns, columnGap: 8, margin: [0, 0, 0, 8] });
  }

  return rows;
}

function tableNodes(block: Extract<ReportBlock, { kind: "table" }>): PdfNode[] {
  const nodes: PdfNode[] = [];

  if (block.caption !== undefined) {
    nodes.push({ text: block.caption, style: "caption" });
  }

  const numeric = new Set(block.numericColumns ?? []);

  const header = block.columns.map((column, index) => ({
    text: column,
    style: "th",
    alignment: numeric.has(index) ? "right" : "left",
  }));

  const body = block.rows.map((row) =>
    row.map((cell, index) => ({
      text: cell,
      fontSize: 8,
      alignment: numeric.has(index) ? "right" : "left",
    })),
  );

  if (body.length === 0) {
    // Boş tablo yerine nedenini yazmak, "veri mi yok, hata mı var?" sorusunu
    // ortadan kaldırır.
    nodes.push(noteNode({ kind: "note", text: "Bu bölümde gösterilecek satır yok." }));
    return nodes;
  }

  nodes.push({
    table: {
      widths: block.widths ?? block.columns.map(() => "auto"),
      // Başlık her sayfada tekrar çizilir; satırlar ortadan bölünmez.
      headerRows: 1,
      dontBreakRows: true,
      body: [header, ...body],
    },
    layout: hairlineLayout(),
    margin: [0, 0, 0, 10],
  });

  return nodes;
}

/**
 * Yatay çubuk grafiği.
 *
 * Recharts bir DOM bileşenidir ve PDF'e alınamaz; ekran görüntüsü almak
 * (html2canvas) hem bulanık çıkar hem de görünmeyen bir öğeyi çizdirmek
 * gerekirdi. Çubuklar bunun yerine doğrudan PDF vektörü olarak çizilir:
 * keskin, küçük ve ekrandan bağımsız.
 */
function barNodes(block: Extract<ReportBlock, { kind: "bars" }>): PdfNode[] {
  const nodes: PdfNode[] = [];
  if (block.caption !== undefined) {
    nodes.push({ text: block.caption, style: "caption" });
  }

  const trackWidth = 300;

  nodes.push({
    table: {
      widths: [110, trackWidth + 4, "auto"],
      dontBreakRows: true,
      body: block.items.map((item: BarItem) => [
        { text: item.label, fontSize: 8, margin: [0, 3, 0, 3] },
        {
          margin: [0, 5, 0, 3],
          canvas: [
            {
              type: "rect",
              x: 0,
              y: 0,
              w: trackWidth,
              h: 7,
              r: 3,
              color: HAIRLINE,
            },
            {
              type: "rect",
              x: 0,
              y: 0,
              // Sıfır genişlikli dikdörtgen çizilmez; en az bir punto bırakmak
              // "ölçüldü ama çok küçük" ile "hiç yok"u ayırır.
              w: Math.max(1, trackWidth * clamp01(item.ratio)),
              h: 7,
              r: 3,
              color: TONE_COLOR[item.tone] ?? BRAND,
            },
          ],
        },
        {
          text: item.display,
          fontSize: 8,
          alignment: "right",
          margin: [0, 3, 0, 3],
        },
      ]),
    },
    layout: "noBorders",
    margin: [0, 0, 0, 10],
  });

  return nodes;
}

/**
 * Isı haritası.
 *
 * Ekrandaki ızgaranın kâğıt karşılığı: her istasyon bir hücre, zemin rengi
 * ısı bandı. Renk **tek başına** bilgi taşımaz — hücrede bandın yazılı adı,
 * skoru ve tutarı da vardır. Renk körü bir okuyucu ya da siyah-beyaz bir
 * çıktı, aynı bilgiyi eksiksiz alır.
 */
function heatmapNodes(block: Extract<ReportBlock, { kind: "heatmap" }>): PdfNode[] {
  const nodes: PdfNode[] = [];
  if (block.caption !== undefined) {
    nodes.push({ text: block.caption, style: "caption" });
  }

  const perRow = 4;
  const rows: PdfNode[][] = [];

  for (let start = 0; start < block.cells.length; start += perRow) {
    const slice = block.cells.slice(start, start + perRow);
    const row: PdfNode[] = slice.map((cell) => ({
      stack: [
        {
          text: cell.stationName + (cell.isBottleneck ? " ◆" : ""),
          fontSize: 8,
          bold: true,
        },
        {
          text: `${BAND_LABEL[cell.band]} · ${Math.round(cell.score)}/100`,
          fontSize: 7,
          color: MUTED,
          margin: [0, 1, 0, 0],
        },
        { text: cell.lossLabel, fontSize: 8, margin: [0, 2, 0, 0] },
      ],
      fillColor: BAND_COLOR[cell.band],
      margin: [6, 6, 6, 6],
    }));

    while (row.length < perRow) {
      row.push({ text: "", border: [false, false, false, false] });
    }
    rows.push(row);
  }

  nodes.push({
    table: { widths: Array(perRow).fill("*"), dontBreakRows: true, body: rows },
    layout: {
      hLineWidth: () => 2,
      vLineWidth: () => 2,
      hLineColor: () => "#FFFFFF",
      vLineColor: () => "#FFFFFF",
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 6],
  });

  nodes.push({
    text: `Bant sırası: ${Object.values(BAND_LABEL).join(" · ")}. ◆ darboğaz istasyonu.${
      block.isRelative
        ? " Skorlar bu koşumdaki en kötü istasyona göre görecelidir."
        : ""
    }`,
    fontSize: 7,
    color: MUTED,
    margin: [0, 0, 0, 10],
  });

  return nodes;
}

/**
 * İmza alanı.
 *
 * Her taraf için önce boşluk, sonra ince bir çizgi, altında rol ve ad.
 * Çizginin üstündeki boşluk elle imza atmaya yeter; daha darı, çıktının
 * altına ikinci bir kâğıt koydururdu.
 */
function signatureNodes(
  block: Extract<ReportBlock, { kind: "signature" }>,
): PdfNode[] {
  const columnWidth = Math.floor(
    (BODY_WIDTH - 24 * (block.parties.length - 1)) / block.parties.length,
  );

  return [
    {
      margin: [0, 26, 0, 0],
      columnGap: 24,
      columns: block.parties.map((party) => ({
        width: "*",
        stack: [
          { text: " ", margin: [0, 0, 0, 30] },
          {
            canvas: [
              {
                type: "line",
                x1: 0,
                y1: 0,
                x2: columnWidth,
                y2: 0,
                lineWidth: 0.7,
                lineColor: MUTED,
              },
            ],
          },
          { text: party.role, fontSize: 7, color: MUTED, margin: [0, 5, 0, 0] },
          { text: party.name, fontSize: 9, bold: true, margin: [0, 1, 0, 0] },
        ],
      })),
    },
  ];
}

/* --- Ortak yerleşimler ------------------------------------------------------ */

function hairlineLayout() {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0,
    hLineColor: () => HAIRLINE,
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: () => 4,
    paddingBottom: () => 4,
  };
}

function boxLayout() {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => HAIRLINE,
    vLineColor: () => HAIRLINE,
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: () => 0,
    paddingBottom: () => 0,
  };
}

/**
 * Alt bilgi: sayfa numarası ve künye.
 *
 * Kapak sayfasında gösterilmez — kapağın altında "Sayfa 1/7" yazması, belgeyi
 * bir sunum değil bir çıktı gibi gösterir.
 */
function footer(document: ReportDocument) {
  return (currentPage: number, pageCount: number): PdfNode | null => {
    if (currentPage === 1) {
      return null;
    }
    return {
      margin: [40, 14, 40, 0],
      columns: [
        {
          text: `${document.cover.factoryName} · ${document.cover.generatedAtLabel}`,
          fontSize: 7,
          color: MUTED,
        },
        {
          text: `Sayfa ${currentPage} / ${pageCount}`,
          fontSize: 7,
          color: MUTED,
          alignment: "right",
        },
      ],
    };
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
