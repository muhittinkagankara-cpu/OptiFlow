/**
 * Sunucunun sürücü kararını bir kez okur (Sprint 2L).
 *
 * Ekran açılırken tek bir soru sorulur: doğrulanmış ve şu anda bağlı bir cihaz
 * var mı? Yanıt gelene kadar hiçbir şey varsayılmaz — `loaded` false kaldığı
 * sürece çağıran kaynağı değiştirmez. Beklemeden runtime'a geçilseydi, cihaz
 * yokken ekran boş açılır ve boş bir canlı ekran "fabrika duruyor" diye
 * okunurdu.
 *
 * Yoklama yoktur: karar ekran açılışında bir kez okunur. Sürekli yoklamak,
 * kullanıcı ekranı kullanırken kaynağın ayağının altından kaymasına yol
 * açardı; bağlantı koptuğunda bunu zaten sağlayıcının kendi durumu söyler.
 */

import { useEffect, useState } from "react";

import type { RuntimeBridgeClient, RuntimeDriver } from "../../lib/connectors/bridge";
import { unreadableDriver } from "../../lib/connectors/bridge";

export interface RuntimeDriverQuery {
  driver: RuntimeDriver | null;
  /** Yanıt (olumlu ya da olumsuz) geldi mi? */
  loaded: boolean;
}

export function useRuntimeDriver(client: RuntimeBridgeClient): RuntimeDriverQuery {
  const [query, setQuery] = useState<RuntimeDriverQuery>({
    driver: null,
    loaded: false,
  });

  useEffect(() => {
    let alive = true;

    void (async () => {
      const result = await client.driver();
      if (!alive) {
        return;
      }
      /*
       * Hata durumunda da `loaded` true olur ve karar "okunamadı" sürücüsüne
       * düşer. Sonsuza kadar yüklenmemiş kalsaydı, ekran hiçbir zaman bir
       * kaynağa karar veremezdi.
       */
      setQuery({
        driver: result.data ?? unreadableDriver(),
        loaded: true,
      });
    })();

    return () => {
      alive = false;
    };
  }, [client]);

  return query;
}
