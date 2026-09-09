/**
 * Gelen yükün incelenmesi ve OptiFlow alanlarına eşlenmesi.
 *
 * Gerçek bir MES ucu ne döndüreceğini kendi bilir: kimi `{"queue": 12}` der,
 * kimi `{"data":{"station":{"q":12}}}`. Bu katman, gelen yükü düzleştirip her
 * yaprağı adresiyle listeler; kullanıcı hangi adresi hangi OptiFlow alanına
 * bağlayacağını **görerek** seçer.
 *
 * Buradaki hiçbir işlev değer uydurmaz. Adres bulunamazsa `null` döner ve
 * arayüz "Doğrulanmadı" yazar; tip uymuyorsa dönüştürme denenir ama
 * başarısızlığı gizlenmez.
 */

import type { OptiFlowField } from "../types";

/** Yükün içindeki tek bir yaprak. */
export interface PayloadEntry {
  /** Nokta ve köşeli parantezle yazılmış adres: `data.stations[0].queue`. */
  path: string;
  /** Ham değer. */
  value: unknown;
  /** JavaScript tipi; arayüzde rozet olarak görünür. */
  type: "number" | "boolean" | "string" | "null" | "object";
  /** Bu adres bir OptiFlow alanına bağlıysa o alan. */
  matchedField: OptiFlowField | null;
}

/** Canlı köprüye akan alanlar. */
export interface LiveFields {
  queue: number | null;
  machineState: string | null;
  cycleCount: number | null;
  fault: boolean | null;
  throughput: number | null;
}

/** Hiçbir alanın okunmadığı boş sonuç. */
export function emptyLiveFields(): LiveFields {
  return {
    queue: null,
    machineState: null,
    cycleCount: null,
    fault: null,
    throughput: null,
  };
}

/** Canlı köprünün beslediği alan adları. */
export type LiveFieldName = keyof LiveFields;

export const LIVE_FIELDS: LiveFieldName[] = [
  "queue",
  "machineState",
  "cycleCount",
  "fault",
  "throughput",
];

export const LIVE_FIELD_LABEL: Record<LiveFieldName, string> = {
  queue: "Kuyruk",
  machineState: "Makine durumu",
  cycleCount: "Çevrim sayacı",
  fault: "Arıza",
  throughput: "Üretim hızı",
};

/** Alan → beklenen tip; eşleme doğrulaması buna bakar. */
export const LIVE_FIELD_TYPE: Record<LiveFieldName, "number" | "boolean" | "string"> = {
  queue: "number",
  machineState: "string",
  cycleCount: "number",
  fault: "boolean",
  throughput: "number",
};

/**
 * Yükü düzleştirir.
 *
 * Diziler indeksle adreslenir (`items[0].queue`) çünkü sahadaki uçlar
 * istasyonları çoğu zaman dizi olarak döndürür ve kullanıcı hangi indeksi
 * istediğini görmek zorundadır.
 *
 * Derinlik sınırlıdır: bir uç kendine referans veren bir yapı döndürürse
 * (ya da yüzlerce seviye derinlikte bir ağaç), ekranın donmaması gerekir.
 */
export function flattenPayload(
  payload: unknown,
  maxDepth = 6,
  maxEntries = 200,
): PayloadEntry[] {
  const entries: PayloadEntry[] = [];

  const walk = (value: unknown, path: string, depth: number): void => {
    if (entries.length >= maxEntries) {
      return;
    }

    if (value === null) {
      entries.push({ path, value: null, type: "null", matchedField: null });
      return;
    }

    if (Array.isArray(value)) {
      if (depth >= maxDepth) {
        entries.push({ path, value, type: "object", matchedField: null });
        return;
      }
      value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }

    if (typeof value === "object") {
      if (depth >= maxDepth) {
        entries.push({ path, value, type: "object", matchedField: null });
        return;
      }
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        walk(item, path === "" ? key : `${path}.${key}`, depth + 1);
      }
      return;
    }

    entries.push({
      path,
      value,
      type:
        typeof value === "number"
          ? "number"
          : typeof value === "boolean"
            ? "boolean"
            : "string",
      matchedField: null,
    });
  };

  walk(payload, "", 0);
  return entries;
}

/**
 * Adresten değer okur.
 *
 * `data.stations[0].queue` gibi adresleri çözer. Yol bulunamazsa `undefined`
 * döner — `null` ile karıştırılmaz, çünkü uç noktanın gerçekten `null`
 * döndürmesi ile adresin bulunamaması farklı iki durumdur.
 */
export function readPath(payload: unknown, path: string): unknown {
  if (path.trim() === "") {
    return undefined;
  }

  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((part) => part !== "");

  let current: unknown = payload;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Bir alanın hangi adresten besleneceği. */
export interface LiveMapping {
  field: LiveFieldName;
  path: string;
}

/**
 * Değeri alanın tipine çevirir.
 *
 * Sahada sayılar metin olarak gelir ("12"), arıza bilgisi 0/1 ya da
 * "true"/"false" olabilir. Dönüştürme denenir; başarısızsa `null` döner ve
 * çağıran bunu "okunamadı" olarak gösterir — sıfır yazmak, dolu bir kuyruğu
 * boş göstermek olurdu.
 */
export function coerce(
  value: unknown,
  type: "number" | "boolean" | "string",
): number | boolean | string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (type === "number") {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (typeof value === "string") {
      const numeric = Number(value.replace(",", "."));
      return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
  }

  if (type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (["true", "1", "yes", "evet", "fault", "arıza"].includes(text)) {
        return true;
      }
      if (["false", "0", "no", "hayır", "ok", "normal"].includes(text)) {
        return false;
      }
      return null;
    }
    return null;
  }

  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** Eşlemeleri uygulayıp canlı alanları üretir. */
export function mapPayload(
  payload: unknown,
  mappings: LiveMapping[],
): LiveFields {
  const fields = emptyLiveFields();

  for (const mapping of mappings) {
    const raw = readPath(payload, mapping.path);
    const value = coerce(raw, LIVE_FIELD_TYPE[mapping.field]);
    if (value === null) {
      continue;
    }
    if (mapping.field === "fault") {
      fields.fault = value as boolean;
    } else if (mapping.field === "machineState") {
      fields.machineState = value as string;
    } else {
      fields[mapping.field] = value as number;
    }
  }

  return fields;
}

/** Yükü, eşleşen alanlar işaretlenmiş hâlde listeler. */
export function inspectPayload(
  payload: unknown,
  mappings: LiveMapping[],
): PayloadEntry[] {
  const byPath = new Map(mappings.map((mapping) => [mapping.path, mapping.field]));
  return flattenPayload(payload).map((entry) => ({
    ...entry,
    matchedField: (byPath.get(entry.path) as OptiFlowField | undefined) ?? null,
  }));
}

/**
 * Adres adından alan tahmini.
 *
 * Yalnızca **öneri**dir: kullanıcı onaylamadan hiçbir eşleme kurulmaz. Otomatik
 * kurulan bir eşleme, yanlış olduğunda fark edilmesi en zor hatadır.
 */
export function suggestField(path: string): LiveFieldName | null {
  const text = path.toLowerCase();
  if (text.includes("queue") || text.includes("kuyruk")) {
    return "queue";
  }
  if (text.includes("state") || text.includes("status") || text.includes("durum")) {
    return "machineState";
  }
  if (text.includes("cycle") || text.includes("count") || text.includes("sayac")) {
    return "cycleCount";
  }
  if (text.includes("fault") || text.includes("alarm") || text.includes("ariza")) {
    return "fault";
  }
  if (text.includes("throughput") || text.includes("rate") || text.includes("uretim")) {
    return "throughput";
  }
  return null;
}

/** Eşlemeyi ekler ya da değiştirir; bir alan tek adresten beslenir. */
export function setMapping(
  mappings: LiveMapping[],
  field: LiveFieldName,
  path: string,
): LiveMapping[] {
  const next = mappings.filter((mapping) => mapping.field !== field);
  if (path.trim() !== "") {
    next.push({ field, path });
  }
  return next.sort(
    (a, b) => LIVE_FIELDS.indexOf(a.field) - LIVE_FIELDS.indexOf(b.field),
  );
}

/**
 * Eşlemenin sorunları.
 *
 * Adres yükte yoksa ya da değer alana çevrilemiyorsa uyarılır. Canlı önizleme
 * açılmadan önce bunları görmek, sahada "veri geliyor ama ekran boş"
 * şikâyetinin önünü keser.
 */
export interface MappingIssue {
  field: LiveFieldName;
  text: string;
}

export function validateMapping(
  payload: unknown,
  mappings: LiveMapping[],
): MappingIssue[] {
  const issues: MappingIssue[] = [];

  for (const mapping of mappings) {
    const raw = readPath(payload, mapping.path);
    if (raw === undefined) {
      issues.push({
        field: mapping.field,
        text: `${LIVE_FIELD_LABEL[mapping.field]}: "${mapping.path}" adresi gelen yükte bulunamadı.`,
      });
      continue;
    }
    if (coerce(raw, LIVE_FIELD_TYPE[mapping.field]) === null) {
      issues.push({
        field: mapping.field,
        text: `${LIVE_FIELD_LABEL[mapping.field]}: "${mapping.path}" değeri ${LIVE_FIELD_TYPE[mapping.field]} tipine çevrilemedi.`,
      });
    }
  }

  return issues;
}

/** Kaç alan gerçekten okunabildi. */
export function mappedFieldCount(fields: LiveFields): number {
  return LIVE_FIELDS.filter((field) => fields[field] !== null).length;
}
