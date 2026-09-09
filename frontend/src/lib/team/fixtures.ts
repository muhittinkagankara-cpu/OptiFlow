/**
 * Örnek ekip verisi.
 *
 * Buradaki her kayıt `origin: "fixture"` taşır ve arayüzde "Örnek" rozetiyle
 * görünür. Amaç, tek kişilik bir hesapta ekran boş kalmasın diye ürünün ne
 * yaptığını göstermektir — gerçek bir ekip varmış izlenimi vermek değil.
 */

import type {
  ActivityEvent,
  Comment,
  Invitation,
  Member,
  PresenceEntry,
} from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Örnek ekip arkadaşları. */
export function sampleMembers(nowMs: number): Member[] {
  return [
    {
      id: "fix-kaan",
      name: "Kaan Demir",
      email: "kaan@ornek-fabrika.com",
      role: "engineer",
      status: "active",
      lastActiveAtMs: nowMs - 8 * MINUTE,
      origin: "fixture",
    },
    {
      id: "fix-ayse",
      name: "Ayşe Yıldız",
      email: "ayse@ornek-fabrika.com",
      role: "operator",
      status: "active",
      lastActiveAtMs: nowMs - 45 * MINUTE,
      origin: "fixture",
    },
    {
      id: "fix-mehmet",
      name: "Mehmet Koç",
      email: "mehmet@ornek-fabrika.com",
      role: "viewer",
      status: "active",
      lastActiveAtMs: nowMs - 3 * HOUR,
      origin: "fixture",
    },
    {
      id: "fix-selin",
      name: "Selin Arslan",
      email: "selin@ornek-fabrika.com",
      role: "admin",
      status: "invited",
      // Henüz katılmamış bir üye için son etkinlik bilinmez.
      lastActiveAtMs: null,
      origin: "fixture",
    },
  ];
}

/** Örnek aktivite geçmişi. */
export function sampleActivity(nowMs: number): ActivityEvent[] {
  return [
    {
      id: "fix-evt-1",
      kind: "simulation_run",
      atMs: nowMs - 20 * MINUTE,
      actorName: "Kaan Demir",
      subject: "Kuzey Hat 1",
      detail: "30 tekrarlı standart koşum",
      origin: "fixture",
    },
    {
      id: "fix-evt-2",
      kind: "validation_saved",
      atMs: nowMs - 2 * HOUR,
      actorName: "Ayşe Yıldız",
      subject: "Torna",
      detail: "Vardiya ölçümü girildi",
      origin: "fixture",
    },
    {
      id: "fix-evt-3",
      kind: "report_downloaded",
      atMs: nowMs - 5 * HOUR,
      actorName: "Mehmet Koç",
      subject: "Yönetici raporu",
      detail: null,
      origin: "fixture",
    },
    {
      id: "fix-evt-4",
      kind: "role_changed",
      atMs: nowMs - 26 * HOUR,
      actorName: "Selin Arslan",
      subject: "Kaan Demir",
      detail: "Operatör → Mühendis",
      origin: "fixture",
    },
    {
      id: "fix-evt-5",
      kind: "factory_created",
      atMs: nowMs - 50 * HOUR,
      actorName: "Selin Arslan",
      subject: "Kuzey Hat 1",
      detail: null,
      origin: "fixture",
    },
  ];
}

/** Örnek yorumlar. */
export function sampleComments(nowMs: number): Comment[] {
  return [
    {
      id: "fix-cmt-1",
      target: { kind: "station", id: "torna", label: "Torna" },
      authorName: "Kaan Demir",
      text: "@Ayşe bu istasyonda çevrim süresi modelden uzun görünüyor, vardiyada bir ölçüm alır mısın?",
      createdAtMs: nowMs - 90 * MINUTE,
      mentions: ["Ayşe Yıldız"],
      resolved: false,
      resolvedBy: null,
      resolvedAtMs: null,
      origin: "fixture",
    },
    {
      id: "fix-cmt-2",
      target: { kind: "factory", id: "kuzey-hat-1", label: "Kuzey Hat 1" },
      authorName: "Selin Arslan",
      text: "İkinci vardiya için kapasite planını güncelledim.",
      createdAtMs: nowMs - 6 * HOUR,
      mentions: [],
      resolved: true,
      resolvedBy: "Kaan Demir",
      resolvedAtMs: nowMs - 4 * HOUR,
      origin: "fixture",
    },
  ];
}

/**
 * Örnek eşzamanlı çalışma kayıtları.
 *
 * `isLive: false` — bu kayıtlar bir sunucudan gelmiyor ve arayüz her listede
 * "Canlı değil" yazıyor.
 */
export function samplePresence(nowMs: number): PresenceEntry[] {
  return [
    {
      id: "fix-pre-1",
      name: "Kaan",
      screen: "Süreç Editörü",
      activity: "editing",
      atMs: nowMs - 2 * MINUTE,
      isLive: false,
      origin: "fixture",
    },
    {
      id: "fix-pre-2",
      name: "Ayşe",
      screen: "Operatör",
      activity: "viewing",
      atMs: nowMs - 4 * MINUTE,
      isLive: false,
      origin: "fixture",
    },
    {
      id: "fix-pre-3",
      name: "Mehmet",
      screen: "Finans",
      activity: "viewing",
      atMs: nowMs - 9 * MINUTE,
      isLive: false,
      origin: "fixture",
    },
  ];
}

/** Örnek davet; bekleyen bir kayıt listenin nasıl göründüğünü gösterir. */
export function sampleInvitations(nowMs: number): Invitation[] {
  return [
    {
      id: "fix-inv-1",
      email: "yeni.muhendis@ornek-fabrika.com",
      role: "engineer",
      token: "ornekdavetbelirteci01",
      createdAtMs: nowMs - 26 * HOUR,
      expiresAtMs: nowMs + 5 * 24 * HOUR,
      status: "pending",
      emailSent: false,
      origin: "fixture",
    },
  ];
}
