/**
 * Keşif yanıtlarının çözümlenmesi.
 *
 * Sunucu bir uçtan yanıt alamadıysa `ok=false` ve boş bir etiket listesi
 * gelir. Ayrıştırıcı bu boşluğu **doldurmaz**: örnek etiket üretmek,
 * kullanıcının olmayan bir düğümü eşlemesine yol açardı.
 */

import { numberOr, numberOrNull, record, stringOr, stringOrNull } from "../monitoring/parse";
import {
  NO_DISCOVERY,
  TAG_KIND_LABEL,
  type CredentialTest,
  type DeviceFingerprint,
  type DiscoveredTag,
  type DiscoveryResult,
  type ProvisioningStep,
  type TagKind,
  type TagSuggestion,
} from "./types";

const KINDS: TagKind[] = ["counter", "gauge", "boolean", "text", "unknown"];

const STEPS: ProvisioningStep[] = [
  "endpoint",
  "discovery",
  "tags",
  "mapping",
  "test",
  "save",
];

/** Tanınmayan tür "bilinmiyor" olur; sayaç ya da ölçüm varsayılmaz. */
export function parseTagKind(value: unknown): TagKind {
  return KINDS.includes(value as TagKind) ? (value as TagKind) : "unknown";
}

export function parseStep(value: unknown): ProvisioningStep | null {
  return STEPS.includes(value as ProvisioningStep) ? (value as ProvisioningStep) : null;
}

/**
 * Etiketin okunan değeri.
 *
 * Sayı, metin ve mantıksal değer korunur; başka her şey `null` olur. Bir
 * nesneyi metne çevirmek, kullanıcıya `[object Object]` göstermek olurdu.
 */
export function parseTagValue(value: unknown): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  return null;
}

export function parseTag(value: unknown): DiscoveredTag {
  const row = record(value);
  const kind = parseTagKind(row.kind);
  const address = stringOr(row.address, "");
  return {
    address,
    // Ad türetilemediyse adresin kendisi gösterilir: boş bir ad, kullanıcının
    // hangi düğümü seçtiğini görmesini engellerdi.
    name: stringOr(row.name, address),
    kind,
    kindLabel: stringOr(row.kind_label, TAG_KIND_LABEL[kind]),
    value: parseTagValue(row.value),
    unit: stringOrNull(row.unit),
    dataType: stringOrNull(row.data_type),
  };
}

export function parseTags(value: unknown): DiscoveredTag[] {
  return Array.isArray(value)
    ? value.map(parseTag).filter((tag) => tag.address.length > 0)
    : [];
}

export function parseSuggestions(value: unknown): TagSuggestion[] {
  return Array.isArray(value)
    ? value.map((item) => {
        const row = record(item);
        return {
          address: stringOr(row.address, ""),
          // Anlaşılamayan öneri `null` kalır ve kullanıcı kendisi seçer.
          machineId: stringOrNull(row.machine_id),
          metric: stringOrNull(row.metric),
        };
      })
    : [];
}

export function parseFingerprint(value: unknown): DeviceFingerprint | null {
  const row = record(value);
  if (Object.keys(row).length === 0) return null;
  const digest = stringOr(row.digest, "");
  if (digest.length === 0) return null;
  return {
    endpoint: stringOr(row.endpoint, ""),
    kind: stringOr(row.kind, "unknown"),
    digest,
    tagCount: numberOr(row.tag_count, 0),
  };
}

/**
 * Cihaz değişimi bayrağı.
 *
 * Yalnızca gerçek bir `true`/`false` kabul edilir; eksik alan `null` kalır ve
 * arayüz "ilk kez görülüyor" der.
 */
export function parseChanged(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** `/api/runtime/provisioning/discover` yanıtı. */
export function parseDiscovery(value: unknown): DiscoveryResult {
  const row = record(value);
  if (Object.keys(row).length === 0) return NO_DISCOVERY;
  const tags = parseTags(row.tags);
  return {
    ok: row.ok === true,
    kind: stringOr(row.kind, "unknown"),
    endpoint: stringOr(row.endpoint, ""),
    tags,
    tagCount: numberOr(row.tag_count, tags.length),
    detail: stringOr(row.detail, "Sunucu ayrıntı bildirmedi"),
    evidence: stringOrNull(row.evidence),
    unreadable: Array.isArray(row.unreadable)
      ? row.unreadable.map((item) => stringOr(item, "")).filter((item) => item.length > 0)
      : [],
    latencyMs: numberOrNull(row.latency_ms),
    atMs: numberOrNull(row.at_ms),
    cached: row.cached === true,
    cacheAgeMs: numberOrNull(row.cache_age_ms),
    fingerprint: parseFingerprint(row.fingerprint),
    deviceChanged: parseChanged(row.device_changed),
    suggestions: parseSuggestions(row.suggestions),
  };
}

/** `/api/runtime/provisioning/test` yanıtı. */
export function parseCredentialTest(value: unknown): CredentialTest {
  const row = record(value);
  return {
    ok: row.ok === true,
    detail: stringOr(row.detail, "Sunucu ayrıntı bildirmedi"),
    username: stringOrNull(row.username),
    // Kimlik doğrulamanın gerekip gerekmediği bilinmiyorsa `null` kalır;
    // `false` demek "gerekmiyor" iddiasında bulunmak olurdu.
    requiresAuth: typeof row.requires_auth === "boolean" ? row.requires_auth : null,
    latencyMs: numberOrNull(row.latency_ms),
  };
}
