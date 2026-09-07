/**
 * pdfmake için asgari tip bildirimi.
 *
 * `@types/pdfmake` paketi belge tanımının tamamını modelliyor ve büyük bir
 * yüzey getiriyor; burada kullanılan üç yöntem için gereğinden fazlası olurdu.
 *
 * Bu yüzden yalnızca **gerçekten kullandığımız** yüzey bildiriliyor. Kullanılan
 * yüzey büyürse buraya eklenir; bildirilmemiş bir şeyi çağırmak derleme
 * hatasıdır ve bu istenen davranıştır.
 */

declare module "pdfmake/build/pdfmake.js" {
  interface CreatedPdf {
    /** Tarayıcıda indirme başlatır. */
    download(fileName?: string): void;
    /** PDF'i ikili veri olarak verir; testler ve önizleme için. */
    getBlob(callback: (blob: Blob) => void): void;
  }

  interface PdfMake {
    createPdf(documentDefinition: Record<string, unknown>): CreatedPdf;
    /** Gömülü yazı tiplerinin sanal dosya sistemi. */
    addVirtualFileSystem(vfs: Record<string, string>): void;
    /** Yazı tipi ailelerini kaydeder (0.2 serisinde varsayılan gelmiyor). */
    addFonts(fonts: Record<string, Record<string, string>>): void;
  }

  const pdfMake: PdfMake;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts.js" {
  const vfs: Record<string, string>;
  export default vfs;
}
