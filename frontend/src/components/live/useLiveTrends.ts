/**
 * KPI eğilimlerini biriktiren kanca.
 *
 * Eğilim serileri store'da tutulmaz: store hattın **anlık** hâlini taşır,
 * geçmiş ise yalnızca bu ekranın sunum ihtiyacıdır. Store'a konsaydı her
 * indirgeyici çağrısı beş diziyi daha kopyalar ve saf mantık katmanı bir
 * grafik ayrıntısıyla kirlenirdi.
 *
 * Örnekleme, olay paketi başına bir kezdir. Sağlayıcı paketleri birleştirdiği
 * için bu, saniyede birkaç örnek demektir — sparkline için fazlasıyla yeterli.
 */

import { useEffect, useRef, useState } from "react";
import {
  liveTotals,
  pushSample,
  type LiveFactoryState,
  type TrendSample,
} from "../../lib/live";

export interface LiveTrends {
  throughput: TrendSample[];
  oee: TrendSample[];
  queue: TrendSample[];
  cycle: TrendSample[];
  alarms: TrendSample[];
}

const EMPTY: LiveTrends = {
  throughput: [],
  oee: [],
  queue: [],
  cycle: [],
  alarms: [],
};

export function useLiveTrends(state: LiveFactoryState): LiveTrends {
  const [trends, setTrends] = useState<LiveTrends>(EMPTY);

  /*
   * Sıfırlama, olay sayacının geri gitmesinden anlaşılır (kayıttan oynatmada
   * geri sarma). Ayrı bir bayrak geçirmek yerine mevcut sayacı okumak,
   * çağıranın bir şeyi bildirmeyi unutma ihtimalini ortadan kaldırır.
   */
  const lastCount = useRef(state.eventCount);

  useEffect(() => {
    const totals = liveTotals(state);
    const at = state.clockMinutes;

    setTrends((current) => {
      const base = state.eventCount < lastCount.current ? EMPTY : current;
      lastCount.current = state.eventCount;

      return {
        throughput: pushSample(base.throughput, {
          atMinutes: at,
          value: totals.throughputPerMinute,
        }),
        oee: pushSample(base.oee, { atMinutes: at, value: totals.oee }),
        queue: pushSample(base.queue, { atMinutes: at, value: totals.totalQueue }),
        cycle: pushSample(base.cycle, {
          atMinutes: at,
          value: totals.avgCycleSeconds,
        }),
        alarms: pushSample(base.alarms, {
          atMinutes: at,
          value: totals.openAlarms,
        }),
      };
    });
  }, [state]);

  return trends;
}
