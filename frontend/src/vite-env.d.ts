/// <reference types="vite/client" />

/**
 * Projenin kullandığı ortam değişkenleri.
 *
 * Tip olarak tanımlanmaları, adı yanlış yazılmış bir değişkenin derleme
 * zamanında yakalanmasını sağlar. Aksi hâlde `import.meta.env.VITE_API_URL`
 * gibi bir yazım hatası `undefined` döner ve hata ancak yayına alındıktan
 * sonra, istekler yanlış adrese gittiğinde fark edilirdi.
 */
interface ImportMetaEnv {
  /**
   * Backend API'sinin kök adresi, örneğin
   * `https://optiflow-backend.up.railway.app`. Tanımlı değilse arayüz
   * `http://127.0.0.1:8000` adresine bağlanır.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
