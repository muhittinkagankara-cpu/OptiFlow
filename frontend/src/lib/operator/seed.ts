/**
 * Örnek vardiya verisi.
 *
 * Bu sürümde gerçek bir MES bağlantısı yoktur; görevler burada üretilir.
 * Üretim **deterministiktir**: aynı istasyon listesi her zaman aynı görevleri
 * verir. Rastgele üretilseydi her açılışta farklı sayılar görünür ve operatör
 * uygulamanın gerçek veri gösterdiğini sanabilirdi.
 *
 * Açık bir fabrika varsa görevler onun istasyon adlarını kullanır; böylece
 * ekran, kullanıcının kendi modelinden tanıdığı adları gösterir. Fabrika
 * yoksa dört adımlık genel bir hat kullanılır.
 */

import type { OperatorTask, TaskPriority } from "./types";

/** Fabrika açık değilken kullanılan genel hat. */
export const FALLBACK_STATIONS = ["Kesim", "Torna", "Kaynak", "Montaj"];

/** Görev başına sabit şablon; sıra istasyon listesine göre eşleşir. */
const TEMPLATE: {
  priority: TaskPriority;
  target: number;
  cycleSeconds: number;
  machineSuffix: string;
}[] = [
  { priority: "urgent", target: 120, cycleSeconds: 45, machineSuffix: "M-01" },
  { priority: "high", target: 80, cycleSeconds: 90, machineSuffix: "M-02" },
  { priority: "normal", target: 200, cycleSeconds: 30, machineSuffix: "M-03" },
  { priority: "normal", target: 60, cycleSeconds: 150, machineSuffix: "M-04" },
];

/**
 * İstasyon adlarından bir vardiyalık görev listesi kurar.
 *
 * En fazla dört görev üretilir: telefon ekranında tek elle taranabilecek
 * uzunluk budur. Yirmi istasyonluk bir modelde yirmi kart göstermek, listeyi
 * operatörün asla sonuna kadar kaydırmayacağı bir yığına çevirirdi.
 */
export function buildDemoTasks(
  stationNames: string[],
  operatorName: string,
): OperatorTask[] {
  const names =
    stationNames.length > 0 ? stationNames.slice(0, 4) : FALLBACK_STATIONS;

  return names.map((stationName, index) => {
    const template = TEMPLATE[index % TEMPLATE.length];
    return {
      id: `task-${index + 1}`,
      workOrder: `İE-${(2400 + index + 1).toString()}`,
      stationId: `station-${index + 1}`,
      stationName,
      machineName: `${stationName} ${template.machineSuffix}`,
      operatorName,
      priority: template.priority,
      status: "pending",
      targetQuantity: template.target,
      completedQuantity: 0,
      cycleSeconds: template.cycleSeconds,
      estimatedMinutes: Math.round((template.target * template.cycleSeconds) / 60),
      startedAt: null,
      finishedAt: null,
      workedSeconds: 0,
      scrap: [],
    };
  });
}

/**
 * QR kodundan gelen metni bir göreve çevirir.
 *
 * Kamera bu sürümde kullanılmıyor; tarama simüle ediliyor. Yine de çözümleme
 * burada, saf bir işlevde durur: gerçek kamera eklendiğinde değişen tek şey
 * metnin nereden geldiği olacak, hangi göreve karşılık geldiği değil.
 *
 * İş emri numarası ya da istasyon adı eşleşirse o görev döner; hiçbiri
 * tutmazsa `null` döner ve arayüz "bu kod tanınmadı" der.
 */
export function taskFromCode(
  tasks: OperatorTask[],
  code: string,
): OperatorTask | null {
  const needle = code.trim().toLocaleLowerCase("tr-TR");
  if (needle.length === 0) {
    return null;
  }
  return (
    tasks.find(
      (task) =>
        task.workOrder.toLocaleLowerCase("tr-TR") === needle ||
        task.id.toLocaleLowerCase("tr-TR") === needle ||
        task.stationName.toLocaleLowerCase("tr-TR") === needle,
    ) ?? null
  );
}
