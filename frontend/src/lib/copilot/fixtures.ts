/**
 * Testlerin ve ekranın paylaştığı örnek bağlam.
 *
 * Gerçek bir fabrikada bazı katmanlar dolu, bazıları boştur. Örnek bağlam da
 * böyle kurulur: envanter ve satış verisi bilinçli olarak yoktur, böylece
 * "veri yok" davranışı örnekte de görünür.
 */

import type {
  ContextFact,
  ContextSection,
  ContextSource,
  Conversation,
  FactoryContext,
} from "./types";

/** Önerilen sorular; ekran bunları kart olarak gösterir. */
export const SUGGESTED_QUESTIONS = [
  "Bugünkü darboğazı açıkla.",
  "Neden kayıp oluşuyor?",
  "Hangi istasyona yatırım yapmalıyım?",
  "Fire neden arttı?",
  "Model gerçek üretimle ne kadar uyumlu?",
  "Veri bağlantılarının durumu nedir?",
];

function fact(
  key: string,
  label: string,
  display: string,
  numeric: number | null,
  source: ContextSource,
): ContextFact {
  return { key, label, display, numeric, source, provenance: "measured" };
}

function section(
  source: ContextSource,
  facts: ContextFact[],
): ContextSection {
  return { source, available: true, missingReason: null, facts };
}

function empty(source: ContextSource, reason: string): ContextSection {
  return { source, available: false, missingReason: reason, facts: [] };
}

/** Dört katmanı dolu, üçü boş örnek bağlam. */
export function sampleContext(nowMs = 1_700_000_000_000): FactoryContext {
  return {
    factoryName: "Kuzey Metal Hattı",
    generatedAtMs: nowMs,
    sections: [
      section("simulation", [
        fact("throughput_per_minute", "Çıktı hızı", "0,30 parça/dk", 0.3, "simulation"),
        fact("line_oee", "Hat OEE", "%79", 0.79, "simulation"),
        fact("avg_flow_time", "Ortalama akış süresi", "19,8 dk", 19.8, "simulation"),
        fact("station_count", "İstasyon sayısı", "4", 4, "simulation"),
        fact("is_stable", "Hat kararlı mı", "evet", null, "simulation"),
        fact("bottleneck_name", "Darboğaz istasyonu", "Kaynak", null, "simulation"),
        fact("bottleneck_utilization", "Darboğaz doluluğu", "%92", 0.92, "simulation"),
        fact("worst_scrap_station", "En yüksek fireli istasyon", "Torna", null, "simulation"),
        fact("worst_scrap_ratio", "O istasyonun fire oranı", "%3,4", 0.034, "simulation"),
      ]),
      section("finance", [
        fact("total_loss", "Pencere içi toplam kayıp", "₺84.200", 84_200, "finance"),
        fact("recoverable_loss", "Kurtarılabilir kayıp", "₺31.400", 31_400, "finance"),
        fact("data_completeness", "Veri doluluğu", "%80", 0.8, "finance"),
        fact("finance_confidence", "Finans güveni", "%76", 0.76, "finance"),
        fact("monthly_loss", "Aylık kayıp projeksiyonu", "₺178.772", 178_772, "finance"),
        fact("dominant_loss_label", "En büyük kayıp kalemi", "Bekleme kaybı", null, "finance"),
        fact("dominant_loss_amount", "O kalemin tutarı", "₺39.800", 39_800, "finance"),
        fact("top_loss_station", "En çok kaybettiren istasyon", "Kaynak", null, "finance"),
        fact("top_loss_amount", "O istasyonun kaybı", "₺41.900", 41_900, "finance"),
        fact(
          "top_suggestion_action",
          "Finans katmanının önerisi",
          "Kaynak istasyonuna ikinci vardiya ekleyin.",
          null,
          "finance",
        ),
        fact("top_suggestion_amount", "Önerinin kurtaracağı tutar", "₺22.600", 22_600, "finance"),
      ]),
      section("heatmap", [
        fact("hottest_station", "En sıcak istasyon", "Kaynak", null, "heatmap"),
        fact("hottest_score", "Isı skoru", "88", 88, "heatmap"),
        fact("hottest_band", "Isı bandı", "red", null, "heatmap"),
        fact("hottest_loss", "O istasyonun kaybı", "₺41.900", 41_900, "heatmap"),
        fact("red_station_count", "Kırmızı bantta istasyon", "1", 1, "heatmap"),
        fact("hottest_driver", "Isıyı en çok büyüten bileşen", "Bekleme süresi", null, "heatmap"),
      ]),
      section("validation", [
        fact("model_accuracy", "Model doğruluğu", "%90", 0.9, "validation"),
        fact("measured_stations", "Ölçülen istasyon", "3/4", 3, "validation"),
        fact("validation_confidence", "Doğrulama güven skoru", "%83", 0.83, "validation"),
        fact("worst_accuracy_station", "Modelden en çok sapan istasyon", "Torna", null, "validation"),
        fact("biggest_gap", "En büyük sapma", "%42", 0.42, "validation"),
      ]),
      section("connectors", [
        fact("connector_connected", "Bağlı kaynak", "3/5", 3, "connectors"),
        fact("connector_failed", "Kopuk kaynak", "1", 1, "connectors"),
        fact("connector_sync_errors", "Senkron hatası", "4", 4, "connectors"),
        fact("connector_latency", "Ortalama gecikme", "107 ms", 107, "connectors"),
      ]),
      empty("live", "Canlı üretim akışı açık değil."),
      empty("inventory", "Envanter analizi yapılmadı."),
      empty("crm", "Satış hattında kayıt yok."),
    ],
  };
}

/** Hiçbir katmanı olmayan bağlam; "veri yok" davranışının sınanması için. */
export function emptyContext(nowMs = 1_700_000_000_000): FactoryContext {
  const sources: ContextSource[] = [
    "simulation",
    "finance",
    "heatmap",
    "validation",
    "live",
    "inventory",
    "crm",
    "connectors",
  ];
  return {
    factoryName: null,
    generatedAtMs: nowMs,
    sections: sources.map((source) =>
      empty(source, "Bu katmandan henüz veri alınmadı."),
    ),
  };
}

/** İki mesajlık örnek konuşma. */
export function sampleConversation(nowMs = 1_700_000_000_000): Conversation {
  return {
    id: "conv-ornek",
    title: "Bugünkü darboğazı açıkla.",
    startedAtMs: nowMs - 60_000,
    updatedAtMs: nowMs,
    messages: [
      {
        id: "m1",
        role: "user",
        text: "Bugünkü darboğazı açıkla.",
        atMs: nowMs - 60_000,
        confidence: null,
        reasons: [],
        actions: [],
        sources: [],
      },
      {
        id: "m2",
        role: "assistant",
        text: "Hattın darboğazı Kaynak istasyonu; doluluğu %92.",
        atMs: nowMs - 59_000,
        confidence: "high",
        reasons: ["Simülasyon sonucunda darboğaz olarak Kaynak işaretlendi."],
        actions: [
          {
            id: "action-finance",
            label: "Finans'a git",
            view: "finance",
            reason: "Kayıp kalemlerinin dökümü için.",
          },
        ],
        sources: ["simulation", "finance"],
      },
    ],
  };
}
