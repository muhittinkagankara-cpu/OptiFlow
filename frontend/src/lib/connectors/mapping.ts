/**
 * Düğüm eşleme — kaynaktaki adresin OptiFlow alanına bağlanması.
 *
 * Bu, bağlayıcı platformunun asıl işidir. Bir PLC'de kuyruk uzunluğu
 * `ns=2;s=Line1.St3.Q` olabilir, bir MQTT kurulumunda `hat1/torna/kuyruk`,
 * bir MES ucunda `stations[2].queue`. Üçü de aynı OptiFlow alanını besler ve
 * uygulamanın geri kalanı hangisinin konuştuğunu bilmez.
 *
 * Buradaki işlevlerin tamamı saftır ve **yeni bir durum döndürür**; hiçbiri
 * girdisini değiştirmez. Eşleme ekranı sürükle-bırakla çalışıyor ve geri alma
 * ihtimali yüksek: yerinde değiştirilen bir dizi, önceki hâli geri getirmeyi
 * imkânsız kılardı.
 */

import {
  FIELD_LABEL,
  FIELD_ORDER,
  FIELD_TYPE,
  type FieldMapping,
  type OptiFlowField,
  type SourceNode,
  type ValueType,
} from "./types";

/** Eşlemenin kimliği; aynı istasyon-alan çifti için kararlıdır. */
export function mappingId(stationId: string, field: OptiFlowField): string {
  return `${stationId}:${field}`;
}

/**
 * Bir kaynağı bir istasyonun alanına bağlar.
 *
 * Aynı istasyon-alan çiftinin ikinci bir eşlemesi **oluşmaz**, mevcut olan
 * değiştirilir: bir alanın iki kaynaktan beslenmesi, hangisinin kazandığı
 * belirsiz bir yarış demektir. Kullanıcı yeni kaynağı bıraktığında niyeti
 * eskisinin yerine geçmesidir.
 */
export function assignMapping(
  mappings: FieldMapping[],
  sourceId: string,
  stationId: string,
  field: OptiFlowField,
): FieldMapping[] {
  const id = mappingId(stationId, field);
  const next = mappings.filter((item) => item.id !== id);
  next.push({ id, sourceId, stationId, field });
  return sortMappings(next);
}

/** Eşlemeyi kaldırır. */
export function removeMapping(
  mappings: FieldMapping[],
  id: string,
): FieldMapping[] {
  return mappings.filter((item) => item.id !== id);
}

/** Bir kaynağın tüm eşlemelerini kaldırır (bağlantı silindiğinde). */
export function removeMappingsOfSources(
  mappings: FieldMapping[],
  sourceIds: string[],
): FieldMapping[] {
  const dropped = new Set(sourceIds);
  return mappings.filter((item) => !dropped.has(item.sourceId));
}

/** Bir istasyon-alan çiftinin eşlemesi; yoksa `null`. */
export function mappingFor(
  mappings: FieldMapping[],
  stationId: string,
  field: OptiFlowField,
): FieldMapping | null {
  return (
    mappings.find(
      (item) => item.stationId === stationId && item.field === field,
    ) ?? null
  );
}

/** Bu kaynak herhangi bir alana bağlı mı? */
export function isSourceUsed(
  mappings: FieldMapping[],
  sourceId: string,
): boolean {
  return mappings.some((item) => item.sourceId === sourceId);
}

/** Bir kaynağın bağlandığı tüm alanlar. */
export function fieldsOfSource(
  mappings: FieldMapping[],
  sourceId: string,
): FieldMapping[] {
  return mappings.filter((item) => item.sourceId === sourceId);
}

/**
 * Kapsama oranı: kaç alan bağlandı / bağlanması gereken kaç alan var.
 *
 * İstasyon yoksa oran `null`'dır — sıfır değil. Sıfır "hiçbir şey bağlanmadı"
 * demektir; istasyon yokken bağlanacak bir şey de yoktur ve bu ikisi farklı
 * durumlardır.
 */
export function mappingCoverage(
  mappings: FieldMapping[],
  stationIds: string[],
): number | null {
  const required = stationIds.length * FIELD_ORDER.length;
  if (required === 0) {
    return null;
  }
  const stations = new Set(stationIds);
  const filled = mappings.filter((item) => stations.has(item.stationId)).length;
  return Math.min(1, filled / required);
}

/** Bir istasyonda kaç alan bağlandı. */
export function stationCoverage(
  mappings: FieldMapping[],
  stationId: string,
): number {
  return mappings.filter((item) => item.stationId === stationId).length;
}

/**
 * Kaynağın veri tipi alana uygun mu?
 *
 * `enum` alanına metin bağlanabilir (makine durumu "RUNNING" gibi gelir), ama
 * sayısal bir alana metin bağlamak sessizce `NaN` üretirdi. Boolean bir düğüm
 * sayısal alana bağlanabilir: sahada "çalışıyor" bilgisi çoğu zaman tek bitlik
 * gelir ve 0/1 olarak okunur.
 */
export function isTypeCompatible(
  sourceType: ValueType,
  field: OptiFlowField,
): boolean {
  const target = FIELD_TYPE[field];
  if (target === "number") {
    return sourceType === "number" || sourceType === "boolean";
  }
  if (target === "enum") {
    return sourceType === "enum" || sourceType === "string" || sourceType === "boolean";
  }
  return sourceType === target;
}

/** Bir alana bağlanabilecek kaynaklar. */
export function compatibleSources(
  sources: SourceNode[],
  field: OptiFlowField,
): SourceNode[] {
  return sources.filter((source) => isTypeCompatible(source.dataType, field));
}

/** Kaynakları bağlantıya göre gruplar; ekranın sol sütunu bunu çizer. */
export function sourcesByConnector(
  sources: SourceNode[],
): { connectorId: string; sources: SourceNode[] }[] {
  const groups = new Map<string, SourceNode[]>();
  for (const source of sources) {
    const bucket = groups.get(source.connectorId);
    if (bucket) {
      bucket.push(source);
    } else {
      groups.set(source.connectorId, [source]);
    }
  }
  return [...groups.entries()].map(([connectorId, items]) => ({
    connectorId,
    sources: items,
  }));
}

/** Eşlemeleri istasyon, sonra alan sırasına göre dizer. */
export function sortMappings(mappings: FieldMapping[]): FieldMapping[] {
  return [...mappings].sort((a, b) => {
    if (a.stationId !== b.stationId) {
      return a.stationId.localeCompare(b.stationId);
    }
    return FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field);
  });
}

/** "Torna · Kuyruk" gibi okunur eşleme başlığı. */
export function describeMapping(
  mapping: FieldMapping,
  stationName: string,
): string {
  return `${stationName} · ${FIELD_LABEL[mapping.field]}`;
}

/**
 * Bir kaynağın örnek değerini alanın birimiyle gösterir.
 *
 * Örnek okunmadıysa uydurulmaz: "—" yazılır. Sahte bir örnek değer, eşlemenin
 * doğru olduğu izlenimini verir ve yanlış bağlanmış bir düğüm ancak üretimde
 * fark edilirdi.
 */
export function sampleLabel(source: SourceNode): string {
  if (source.sample === null) {
    return "—";
  }
  return source.unit === null
    ? source.sample
    : `${source.sample} ${source.unit}`;
}
