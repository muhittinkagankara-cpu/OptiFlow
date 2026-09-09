/**
 * Besleme rozeti: ekrandaki veri nereden geliyor?
 *
 * Üç durum vardır ve kullanıcı için üç farklı anlam taşır:
 *
 * * **Gerçek Veri** — cihazdan gerçekten ölçüm geldi. Bunun için akışın açık
 *   olması yetmez; en az bir ölçüm alınmış olmalıdır. Açık bir soket, akan
 *   veri demek değildir.
 * * **Bağlantı Bekleniyor** — akış açık ama hiç ölçüm gelmedi. Cihaz tarafında
 *   bir sorun vardır ve ekran bunu söylemelidir.
 * * **Demo** — veri benzetimden geliyor. Bu satırın gerçek bir arıza gibi
 *   görünmesi, bu ürünün kaçınmaya çalıştığı tek şeydir.
 *
 * Karar burada verilir, bileşende değil: aynı kararın iki ekranda farklı
 * verilmesi, birinde "Gerçek Veri" ötekinde "Demo" yazmasına yol açardı.
 */

import { FEED_BADGE_LABEL, type FeedBadgeId, type StreamStats } from "./types";

export interface FeedVerdict {
  id: FeedBadgeId;
  label: string;
  /** Kullanıcıya gösterilen gerekçe. */
  reason: string;
}

export interface FeedInput {
  /** Ekranın seçili kaynağı gerçek runtime mı? */
  usingRuntime: boolean;
  /** Akıştan en az bir ölçüm alındı mı? */
  hasDeviceData: boolean;
  /** Kaç akış çalışıyor? */
  runningStreams: number;
  /** Akış motorunun özeti; okunmadıysa `null`. */
  stats: StreamStats | null;
}

export function feedVerdict(input: FeedInput): FeedVerdict {
  if (!input.usingRuntime) {
    return {
      id: "demo",
      label: FEED_BADGE_LABEL.demo,
      reason:
        "Ekranda benzetim verisi var. Gerçek cihaz verisi için runtime kaynağını seçin.",
    };
  }

  if (input.hasDeviceData) {
    return {
      id: "real",
      label: FEED_BADGE_LABEL.real,
      reason: "Cihazdan ölçüm alındı; ekrandaki sayılar gerçek veriden geliyor.",
    };
  }

  if (input.runningStreams > 0) {
    return {
      id: "waiting",
      label: FEED_BADGE_LABEL.waiting,
      reason:
        "Akış açık ama cihazdan henüz ölçüm gelmedi. Açık bir bağlantı, akan veri demek değildir.",
    };
  }

  return {
    id: "waiting",
    label: FEED_BADGE_LABEL.waiting,
    reason: "Çalışan bir akış yok. Bir bağlantı doğrulayıp aboneliği başlatın.",
  };
}

/** Kart üstündeki kısa ölçüm satırı; ölçülemeyen değer "—" olur. */
export function describeThroughput(stats: StreamStats | null): string {
  if (stats === null || stats.dispatcher.eventsPerSecond === null) {
    return "Olay hızı ölçülmedi";
  }
  return `${stats.dispatcher.eventsPerSecond.toFixed(1)} olay/sn`;
}

export function describePollRate(stats: StreamStats | null): string {
  if (stats === null || stats.pollRateHz === null) {
    return "Yoklama yok";
  }
  return `${stats.pollRateHz.toFixed(2)} Hz`;
}

export function describeQueue(stats: StreamStats | null): string {
  if (stats === null) return "—";
  const queue = stats.dispatcher.queue;
  return `${queue.depth}/${queue.capacity}`;
}

/**
 * Kuyruk baskısı uyarısı; baskı yoksa `null`.
 *
 * Düşürülen olay sessizce kaybolursa ekrandaki üretim gerçeğin altında kalır
 * ve kimse nedenini bilemez; bu yüzden kayıp görünür kılınır.
 */
export function pressureWarning(stats: StreamStats | null): string | null {
  if (stats === null) return null;
  const queue = stats.dispatcher.queue;
  if (queue.dropped > 0) {
    return `${queue.dropped} ölçüm kuyruk dolduğu için düşürüldü.`;
  }
  if (queue.underPressure) {
    return "Kuyruk dolmak üzere; ölçümler düşürülmeye başlayabilir.";
  }
  return null;
}
