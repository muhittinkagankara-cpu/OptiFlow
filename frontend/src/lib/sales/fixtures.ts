/**
 * Örnek satış hattı.
 *
 * Boş bir CRM ekranı, ürünün ne yaptığını anlatmaz: huni boş, grafikler boş,
 * hatırlatıcı yok. Bu yüzden ilk açılışta hattın her durağında kayıt bulunan
 * örnek bir liste yüklenir ve kullanıcı kendi kaydını girdiği an bu liste
 * dokunulmadan yanında durur.
 *
 * Tarihler **göreli** üretilir (`now`'a göre gün çıkarılarak); sabit tarihler
 * yazılsaydı birkaç hafta sonra bütün kayıtlar "42 gündür bekliyor" derdi.
 */

import type { Lead, Meeting } from "./types";

function daysAgo(now: Date, days: number, hours = 0): string {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

function daysAhead(now: Date, days: number, hour: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

/** İlk açılışta yüklenen örnek kayıtlar. */
export function sampleLeads(now: Date): Lead[] {
  return [
    {
      id: "lead-abc-metal",
      company: "ABC Metal",
      sector: "Metal",
      city: "İstanbul",
      contactName: "Mehmet Yılmaz",
      phone: "0532 111 22 33",
      email: "mehmet@abcmetal.com.tr",
      machineCount: 12,
      employeeCount: 40,
      note: "Torna hattında darboğaz olduğunu düşünüyorlar.",
      stage: "demo",
      createdAt: daysAgo(now, 6),
      updatedAt: daysAgo(now, 0, 2),
      demo: {
        at: daysAgo(now, 0, 2),
        durationMinutes: 5,
        screens: ["Canlı Üretim", "Finans", "Factory Intelligence"],
      },
      wonMonthly: null,
    },
    {
      id: "lead-derya-plastik",
      company: "Derya Plastik",
      sector: "Plastik",
      city: "Bursa",
      contactName: "Ayşe Kaya",
      phone: "0533 444 55 66",
      email: "ayse@deryaplastik.com",
      machineCount: 6,
      employeeCount: 18,
      note: "Enjeksiyon hattı; fire oranı yüksek.",
      stage: "proposal",
      createdAt: daysAgo(now, 11),
      updatedAt: daysAgo(now, 4),
      demo: {
        at: daysAgo(now, 5),
        durationMinutes: 7,
        screens: ["Canlı Üretim", "Finans", "Raporlar"],
      },
      wonMonthly: null,
    },
    {
      id: "lead-ege-tekstil",
      company: "Ege Tekstil",
      sector: "Tekstil",
      city: "İzmir",
      contactName: "Serkan Demir",
      phone: "0534 777 88 99",
      email: "serkan@egetekstil.com.tr",
      machineCount: 34,
      employeeCount: 120,
      note: "İki vardiya çalışıyorlar; MES entegrasyonu sordular.",
      stage: "sent",
      createdAt: daysAgo(now, 20),
      updatedAt: daysAgo(now, 9),
      demo: {
        at: daysAgo(now, 14),
        durationMinutes: 12,
        screens: ["Canlı Üretim", "Operatör", "Finans", "Raporlar"],
      },
      wonMonthly: null,
    },
    {
      id: "lead-anadolu-gida",
      company: "Anadolu Gıda",
      sector: "Gıda",
      city: "Konya",
      contactName: "Fatma Şahin",
      phone: "0535 222 33 44",
      email: "fatma@anadolugida.com",
      machineCount: 9,
      employeeCount: 22,
      note: "Paketleme hattında duruşlar var.",
      stage: "new",
      createdAt: daysAgo(now, 1),
      updatedAt: daysAgo(now, 1),
      demo: null,
      wonMonthly: null,
    },
    {
      id: "lead-marmara-kalip",
      company: "Marmara Kalıp",
      sector: "Metal",
      city: "Kocaeli",
      contactName: "Emre Aydın",
      phone: "0536 555 66 77",
      email: "emre@marmarakalip.com",
      machineCount: 15,
      employeeCount: 55,
      note: "Growth paketinde anlaşıldı.",
      stage: "won",
      createdAt: daysAgo(now, 38),
      updatedAt: daysAgo(now, 12),
      demo: {
        at: daysAgo(now, 30),
        durationMinutes: 9,
        screens: ["Canlı Üretim", "Finans", "Factory Intelligence", "Raporlar"],
      },
      wonMonthly: 14_000,
    },
    {
      id: "lead-toros-doküm",
      company: "Toros Döküm",
      sector: "Metal",
      city: "Adana",
      contactName: "Hakan Öz",
      phone: "0537 888 99 00",
      email: "hakan@torosdokum.com",
      machineCount: 22,
      employeeCount: 80,
      note: "Ocak duruşları maliyetli.",
      stage: "won",
      createdAt: daysAgo(now, 70),
      updatedAt: daysAgo(now, 45),
      demo: {
        at: daysAgo(now, 60),
        durationMinutes: 8,
        screens: ["Canlı Üretim", "Finans"],
      },
      wonMonthly: 16_100,
    },
  ];
}

/** Yaklaşan görüşmeler. */
export function sampleMeetings(now: Date): Meeting[] {
  return [
    {
      id: "meet-1",
      leadId: "lead-abc-metal",
      at: daysAhead(now, 0, 15),
      title: "ABC Metal — teklif sunumu",
    },
    {
      id: "meet-2",
      leadId: "lead-anadolu-gida",
      at: daysAhead(now, 1, 10),
      title: "Anadolu Gıda — ilk demo",
    },
    {
      id: "meet-3",
      leadId: "lead-ege-tekstil",
      at: daysAhead(now, 4, 14),
      title: "Ege Tekstil — MES entegrasyon görüşmesi",
    },
    {
      id: "meet-4",
      leadId: "lead-derya-plastik",
      at: daysAhead(now, 11, 11),
      title: "Derya Plastik — sözleşme",
    },
  ];
}
