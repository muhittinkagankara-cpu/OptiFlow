/**
 * Doğrulama motoru — eşlemenin ve ayarların sahaya çıkmadan önce sınanması.
 *
 * Yanlış bir eşleme sessizce çalışır: kuyruk alanına çevrim süresi bağlanırsa
 * ekran hiçbir hata vermez, yalnızca yanlış sayılar gösterir. Bu yüzden
 * doğrulama, bağlantı kurulmadan **önce** yapılır ve her bulgu ne yapılması
 * gerektiğini söyler.
 *
 * Önem sırası bilinçlidir: `error` bağlantının çalışmasına engeldir, `warning`
 * çalışır ama eksik veri getirir, `info` yalnızca farkındalık içindir. Hepsi
 * kırmızı gösterilseydi, gerçek engeller gürültünün içinde kaybolurdu.
 */

import { fieldsOf } from "./fields";
import { isTypeCompatible } from "./mapping";
import {
  CONNECTOR_LABEL,
  FIELD_LABEL,
  FIELD_ORDER,
  FIELD_TYPE,
  type ConnectorConfig,
  type ConnectorKind,
  type ConnectorSettings,
  type FieldMapping,
  type IssueSeverity,
  type SourceNode,
  type ValidationIssue,
} from "./types";

/** Bağlanması bir alan eksikse uyarı; hiç alan bağlı değilse hata. */
export const REQUIRED_FIELDS = FIELD_ORDER;

/* -------------------------------------------------------------------------- */
/* Ayar doğrulaması                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Bir bağlantının ayarlarını sınar.
 *
 * Zorunlu alanın boşluğu, port aralığı ve adres biçimi burada bakılır. Bu
 * kontroller "bağlantı testi"nin yerine geçmez; testin gereksiz yere ağa
 * çıkmasını önler: yanlış yazılmış bir portu anlamak için sokete bağlanmaya
 * gerek yoktur.
 */
export function validateSettings(
  kind: ConnectorKind,
  settings: ConnectorSettings,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of fieldsOf(kind)) {
    const value = settings[field.key] ?? null;
    const isEmpty =
      value === null || (typeof value === "string" && value.trim() === "");

    if (field.required && isEmpty && field.type !== "boolean") {
      issues.push({
        id: `empty:${kind}:${field.key}`,
        severity: "error",
        code: "empty_field",
        text: `${CONNECTOR_LABEL[kind]} bağlantısında "${field.label}" boş; bu alan olmadan bağlanılamaz.`,
        mappingId: null,
        stationId: null,
        field: null,
      });
      continue;
    }

    if (isEmpty) {
      continue;
    }

    if (field.type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        issues.push(
          invalidValue(kind, field.label, "sayı olmalı", field.key),
        );
        continue;
      }
      if (field.min !== undefined && numeric < field.min) {
        issues.push(
          invalidValue(
            kind,
            field.label,
            `en az ${field.min} olmalı`,
            field.key,
          ),
        );
      }
      if (field.max !== undefined && numeric > field.max) {
        issues.push(
          invalidValue(
            kind,
            field.label,
            `en fazla ${field.max} olabilir`,
            field.key,
          ),
        );
      }
    }

    if (field.type === "select" && field.options !== undefined) {
      const allowed = field.options.map((option) => option.value);
      if (!allowed.includes(String(value))) {
        issues.push(
          invalidValue(
            kind,
            field.label,
            `şu değerlerden biri olmalı: ${allowed.join(", ")}`,
            field.key,
          ),
        );
      }
    }
  }

  issues.push(...protocolIssues(kind, settings));
  return issues;
}

/**
 * Protokole özgü kontroller.
 *
 * Adres biçimi her protokolde farklıdır ve yanlış şema (`http://` yazılmış bir
 * OPC UA adresi gibi) en sık yapılan hatadır. Bunu bağlantı zaman aşımıyla
 * öğrenmek dakikalar alır; burada anında söylenir.
 */
function protocolIssues(
  kind: ConnectorKind,
  settings: ConnectorSettings,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const text = (key: string): string =>
    typeof settings[key] === "string" ? (settings[key] as string).trim() : "";

  if (kind === "opcua") {
    const endpoint = text("endpoint");
    if (endpoint !== "" && !endpoint.startsWith("opc.tcp://")) {
      issues.push(
        invalidValue("opcua", "Endpoint", "opc.tcp:// ile başlamalı", "endpoint"),
      );
    }
    if (
      settings.securityPolicy === "None" &&
      text("username") === "" &&
      endpoint !== ""
    ) {
      issues.push({
        id: "invalid:opcua:security",
        severity: "warning",
        code: "invalid_value",
        text: "Güvenlik politikası None ve kimlik doğrulama yok; üretim hattında bu bağlantı herkese açıktır.",
        mappingId: null,
        stationId: null,
        field: null,
      });
    }
  }

  if (kind === "mqtt") {
    const broker = text("broker");
    if (broker !== "" && !/^mqtts?:\/\//.test(broker)) {
      issues.push(
        invalidValue("mqtt", "Broker", "mqtt:// ya da mqtts:// ile başlamalı", "broker"),
      );
    }
    if (settings.tls === true && Number(settings.port) === 1883) {
      issues.push({
        id: "invalid:mqtt:tls-port",
        severity: "warning",
        code: "invalid_value",
        text: "TLS açık ama port 1883; şifreli bağlantı genellikle 8883 portunu kullanır.",
        mappingId: null,
        stationId: null,
        field: null,
      });
    }
  }

  if (kind === "rest" || kind === "erp") {
    const url = text("baseUrl");
    if (url !== "" && !/^https?:\/\//.test(url)) {
      issues.push(
        invalidValue(kind, "Temel adres", "http:// ya da https:// ile başlamalı", "baseUrl"),
      );
    }
    if (url.startsWith("http://")) {
      issues.push({
        id: `invalid:${kind}:http`,
        severity: "warning",
        code: "invalid_value",
        text: "Adres şifresiz (http); API anahtarı ağda açık gider.",
        mappingId: null,
        stationId: null,
        field: null,
      });
    }
  }

  if (kind === "rest" && settings.apiKey === null && settings.bearer === null) {
    issues.push({
      id: "invalid:rest:auth",
      severity: "warning",
      code: "invalid_value",
      text: "Ne API anahtarı ne de bearer token girildi; uç kimlik doğrulama istiyorsa bağlantı reddedilir.",
      mappingId: null,
      stationId: null,
      field: null,
    });
  }

  return issues;
}

function invalidValue(
  kind: ConnectorKind,
  label: string,
  requirement: string,
  key: string,
): ValidationIssue {
  return {
    id: `invalid:${kind}:${key}`,
    severity: "error",
    code: "invalid_value",
    text: `${CONNECTOR_LABEL[kind]} bağlantısında "${label}" ${requirement}.`,
    mappingId: null,
    stationId: null,
    field: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Eşleme doğrulaması                                                          */
/* -------------------------------------------------------------------------- */

export interface MappingValidationInput {
  sources: SourceNode[];
  mappings: FieldMapping[];
  stations: { id: string; name: string }[];
}

/**
 * Eşlemeyi sınar.
 *
 * Dört sorun aranır:
 *
 * 1. **Eksik düğüm** — bir istasyonun alanı hiç bağlanmamış.
 * 2. **Çakışan eşleme** — bir kaynak aynı istasyonda birden çok alana bağlı.
 * 3. **Tip uyumsuzluğu** — metin bir düğüm sayısal bir alana bağlanmış.
 * 4. **Kayıp kaynak** — eşleme var ama işaret ettiği düğüm artık yok.
 *
 * Kullanılmayan kaynaklar `info` olarak listelenir: hata değildir, ama sahada
 * "veri geliyor ama ekranda yok" şikâyetinin en sık nedeni budur.
 */
export function validateMappings(
  input: MappingValidationInput,
): ValidationIssue[] {
  const { sources, mappings, stations } = input;
  const issues: ValidationIssue[] = [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  /* --- 4. Kayıp kaynak ve 3. tip uyumsuzluğu --- */
  for (const mapping of mappings) {
    const source = sourceById.get(mapping.sourceId) ?? null;
    const station = stations.find((item) => item.id === mapping.stationId);
    const stationName = station?.name ?? mapping.stationId;

    if (source === null) {
      issues.push({
        id: `missing_node:${mapping.id}`,
        severity: "error",
        code: "missing_node",
        text: `${stationName} · ${FIELD_LABEL[mapping.field]} alanı artık var olmayan bir düğüme bağlı; bağlantı silinmiş ya da adres değişmiş olabilir.`,
        mappingId: mapping.id,
        stationId: mapping.stationId,
        field: mapping.field,
      });
      continue;
    }

    if (!isTypeCompatible(source.dataType, mapping.field)) {
      issues.push({
        id: `type_mismatch:${mapping.id}`,
        severity: "error",
        code: "type_mismatch",
        text: `${stationName} · ${FIELD_LABEL[mapping.field]} alanı ${FIELD_TYPE[mapping.field]} bekliyor ama "${source.label}" ${source.dataType} tipinde.`,
        mappingId: mapping.id,
        stationId: mapping.stationId,
        field: mapping.field,
      });
    }
  }

  /* --- 2. Çakışan eşleme --- */
  const perStationSource = new Map<string, FieldMapping[]>();
  for (const mapping of mappings) {
    const key = `${mapping.stationId}|${mapping.sourceId}`;
    const bucket = perStationSource.get(key);
    if (bucket) {
      bucket.push(mapping);
    } else {
      perStationSource.set(key, [mapping]);
    }
  }
  for (const [key, group] of perStationSource) {
    if (group.length < 2) {
      continue;
    }
    const [stationId] = key.split("|");
    const station = stations.find((item) => item.id === stationId);
    issues.push({
      id: `conflicting_mapping:${key}`,
      severity: "warning",
      code: "conflicting_mapping",
      text: `${station?.name ?? stationId} istasyonunda tek bir düğüm ${group
        .map((item) => FIELD_LABEL[item.field])
        .join(", ")} alanlarının hepsini besliyor; bu alanların aynı değeri göstermesi beklenir.`,
      mappingId: group[0].id,
      stationId,
      field: null,
    });
  }

  /* --- 1. Eksik düğüm --- */
  for (const station of stations) {
    for (const field of REQUIRED_FIELDS) {
      const exists = mappings.some(
        (item) => item.stationId === station.id && item.field === field,
      );
      if (!exists) {
        issues.push({
          id: `missing:${station.id}:${field}`,
          severity: "warning",
          code: "missing_node",
          text: `${station.name} · ${FIELD_LABEL[field]} alanına henüz bir düğüm bağlanmadı.`,
          mappingId: null,
          stationId: station.id,
          field,
        });
      }
    }
  }

  /* --- Kullanılmayan kaynak --- */
  for (const source of sources) {
    const used = mappings.some((item) => item.sourceId === source.id);
    if (!used) {
      issues.push({
        id: `unused:${source.id}`,
        severity: "info",
        code: "unused_source",
        text: `"${source.label}" düğümü hiçbir alana bağlı değil; gelen verisi kullanılmıyor.`,
        mappingId: null,
        stationId: null,
        field: null,
      });
    }
  }

  return sortIssues(issues);
}

/** Bulguları önem sırasına dizer; aynı önemdekiler eklendiği sırada kalır. */
export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const weight: Record<IssueSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...issues].sort(
    (a, b) => weight[a.severity] - weight[b.severity],
  );
}

/** Bağlantı kurmaya engel bir sorun var mı? */
export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

/** Önem seviyesine göre sayım; pano rozetleri bunu okur. */
export function countBySeverity(
  issues: ValidationIssue[],
): Record<IssueSeverity, number> {
  return {
    error: issues.filter((issue) => issue.severity === "error").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length,
  };
}

/** Bir bağlantının hem ayar hem eşleme bulguları. */
export function validateConnector(
  config: ConnectorConfig,
  input: MappingValidationInput,
): ValidationIssue[] {
  const sources = input.sources.filter(
    (source) => source.connectorId === config.id,
  );
  const sourceIds = new Set(sources.map((source) => source.id));
  return sortIssues([
    ...validateSettings(config.kind, config.settings),
    ...validateMappings({
      ...input,
      sources,
      mappings: input.mappings.filter((item) => sourceIds.has(item.sourceId)),
      // Eksik alan uyarısı bağlantı bazında anlamsızdır: bir istasyonun kuyruk
      // alanını başka bir bağlantı besliyor olabilir. Bu yüzden istasyon listesi
      // boş geçilir ve yalnızca bu bağlantının kendi eşlemeleri sınanır.
      stations: [],
    }),
  ]);
}
