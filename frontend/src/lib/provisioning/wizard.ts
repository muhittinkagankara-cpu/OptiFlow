/**
 * Sihirbazın adım mantığı.
 *
 * Bileşen yalnızca render eder; "bu adıma geçilebilir mi?", "kaydedilebilir
 * mi?" sorularının yanıtı burada verilir. Bileşenin içinde olsaydı, kurulum
 * sırasının doğruluğu test edilemezdi.
 *
 * Sıra neden zorunlu
 * ------------------
 * Keşif yapılmadan etiket seçilemez (liste boştur), etiket seçilmeden eşleme
 * kurulamaz (eşlenecek bir şey yoktur), test edilmeden kaydedilemez
 * (kaydedilmiş ama denenmemiş bir bağlantı çalışıyormuş gibi durur).
 */

import {
  INITIAL_WIZARD,
  PROVISIONING_ORDER,
  type DiscoveredTag,
  type ProvisioningStep,
  type TagMapping,
  type TagSuggestion,
  type WizardState,
} from "./types";

/** Adımın sıradaki yeri; tanınmayan adım için -1. */
export function stepIndex(step: ProvisioningStep): number {
  return PROVISIONING_ORDER.indexOf(step);
}

/**
 * Bu adıma geçilebilir mi?
 *
 * Önceki adımların tamamı tamamlanmış olmalıdır. Atlamaya izin verilseydi,
 * kullanıcı hiç keşif yapmadan eşleme ekranına düşer ve boş bir listeyle
 * karşılaşırdı.
 */
export function canEnter(state: WizardState, step: ProvisioningStep): boolean {
  const index = stepIndex(step);
  if (index < 0) return false;
  return PROVISIONING_ORDER.slice(0, index).every((item) =>
    state.completed.includes(item),
  );
}

/**
 * Adımı tamamlanmış işaretler ve sıradakine geçer.
 *
 * Sırası gelmemiş bir adım tamamlanamaz; durum **değişmeden** geri döner.
 * Yeni bir nesne döndürülür: React durumu yerinde değiştirmek, yeniden
 * çizimin atlanmasına yol açardı.
 */
export function completeStep(
  state: WizardState,
  step: ProvisioningStep,
): WizardState {
  if (!canEnter(state, step)) return state;
  const index = stepIndex(step);
  const completed = state.completed.includes(step)
    ? state.completed
    : [...state.completed, step];
  const next =
    index + 1 < PROVISIONING_ORDER.length ? PROVISIONING_ORDER[index + 1] : step;
  return { ...state, completed, step: next };
}

/** Kullanıcı geri döndüğünde adımı değiştirir; ileri atlamaya izin vermez. */
export function goToStep(state: WizardState, step: ProvisioningStep): WizardState {
  return canEnter(state, step) ? { ...state, step } : state;
}

/** Etiket seçimini değiştirir (seçiliyse kaldırır). */
export function toggleTag(state: WizardState, address: string): WizardState {
  const selected = state.selected.includes(address)
    ? state.selected.filter((item) => item !== address)
    : [...state.selected, address];
  // Seçimden çıkan etiketin eşlemesi de düşer: seçili olmayan bir adres için
  // eşleme saklamak, kaydedilecek yapılandırmaya hayalet satır eklerdi.
  const mapping = { ...state.mapping };
  if (!selected.includes(address)) delete mapping[address];
  return { ...state, selected, mapping };
}

/**
 * Bir etiketin eşlemesini kurar.
 *
 * `source` kaydı, geri almanın hangi eşlemeleri kaldıracağını belirler:
 * öneriden gelenler toplu geri alınabilir, elle kurulanlar korunur.
 */
export function setMapping(
  state: WizardState,
  address: string,
  machineId: string,
  metric: string,
  source: "manual" | "suggestion" = "manual",
): WizardState {
  return {
    ...state,
    mapping: { ...state.mapping, [address]: { address, machineId, metric, source } },
  };
}

/**
 * Öneriden gelen bütün eşlemeleri kaldırır; elle kurulanlar kalır.
 *
 * Toplu geri alma, kullanıcının "önerileri uygula" düğmesine yanlışlıkla
 * basmasını tek adımda düzeltir. Elle kurulanların da silinmesi, kullanıcının
 * kendi emeğini kaybetmesi olurdu.
 */
export function undoSuggestions(state: WizardState): WizardState {
  const mapping: Record<string, TagMapping> = {};
  for (const [address, entry] of Object.entries(state.mapping)) {
    if (entry.source !== "suggestion") mapping[address] = entry;
  }
  return { ...state, mapping };
}

/**
 * Öneriden gelen eşleme sayısı.
 *
 * Geri alma düğmesi bu sayı sıfırken kapalı durur: yapacağı bir şey olmayan
 * bir düğme, kullanıcıya bozuk göründü.
 */
export function suggestedCount(state: WizardState): number {
  return Object.values(state.mapping).filter((item) => item.source === "suggestion")
    .length;
}

/** Bir etiketin eşlemesini kaldırır. */
export function clearMapping(state: WizardState, address: string): WizardState {
  const mapping = { ...state.mapping };
  delete mapping[address];
  return { ...state, mapping };
}

/**
 * Uygulanabilecek öneriler: seçili, henüz eşlenmemiş ve iki alanı da dolu.
 *
 * Ayrı bir işlev olması, arayüzün düğmeye basmadan **önce** kaç önerinin
 * uygulanabileceğini bilmesi içindir.
 */
export function applicableSuggestions(
  state: WizardState,
  suggestions: TagSuggestion[],
): TagSuggestion[] {
  return suggestions.filter(
    (suggestion) =>
      state.selected.includes(suggestion.address) &&
      state.mapping[suggestion.address] === undefined &&
      suggestion.machineId !== null &&
      suggestion.metric !== null,
  );
}

/**
 * Seçili ama uygulanamayan öneriler.
 *
 * Adresinde makine kimliği geçmeyen bir etiket (`uretim`) için makine
 * tahmin edilemez. Bunu söylememek, düğmenin bozuk olduğu izlenimi verirdi —
 * tarayıcıda tam olarak böyle göründü.
 */
export function unresolvedSuggestions(
  state: WizardState,
  suggestions: TagSuggestion[],
): TagSuggestion[] {
  return suggestions.filter(
    (suggestion) =>
      state.selected.includes(suggestion.address) &&
      state.mapping[suggestion.address] === undefined &&
      (suggestion.machineId === null || suggestion.metric === null),
  );
}

/**
 * Önerileri eşleme olarak uygular.
 *
 * Yalnızca **seçili** ve iki alanı da dolu olan öneriler uygulanır. Eksik bir
 * öneriyi yarım uygulamak, makinesi belirsiz bir metrik yazmak olurdu. Var
 * olan eşlemeler korunur: kullanıcının elle kurduğu bir eşlemeyi öneri
 * ezmemelidir.
 */
export function applySuggestions(
  state: WizardState,
  suggestions: TagSuggestion[],
): WizardState {
  const mapping = { ...state.mapping };
  for (const suggestion of suggestions) {
    if (!state.selected.includes(suggestion.address)) continue;
    if (mapping[suggestion.address]) continue;
    if (suggestion.machineId === null || suggestion.metric === null) continue;
    mapping[suggestion.address] = {
      address: suggestion.address,
      machineId: suggestion.machineId,
      metric: suggestion.metric,
      source: "suggestion",
    };
  }
  return { ...state, mapping };
}

/** Test sonucunu kaydeder. */
export function recordTest(
  state: WizardState,
  ok: boolean,
  detail: string,
): WizardState {
  return { ...state, testOk: ok, testDetail: detail };
}

/**
 * Kaydedilebilir mi?
 *
 * Testin **başarılı** olması ve test adımının tamamlanmış olması gerekir.
 * Başarısız bir testten sonra kaydetmeye izin vermek, çalışmayan bir
 * bağlantıyı listeye "kurulu" diye eklemek olurdu.
 */
export function canSave(state: WizardState): boolean {
  return state.testOk === true && state.completed.includes("test");
}

/**
 * Eşlemesi eksik olan seçili etiketler.
 *
 * Eşlemesiz bir etiket kaydedilebilir ama verisi hiçbir makineye yazılmaz;
 * kullanıcı bunu kaydetmeden önce görmelidir.
 */
export function unmappedTags(state: WizardState): string[] {
  return state.selected.filter((address) => !state.mapping[address]);
}

/** Kurulan eşlemeler, adres sırasına göre. */
export function mappingList(state: WizardState): TagMapping[] {
  return Object.values(state.mapping).sort((left, right) =>
    left.address.localeCompare(right.address, "tr"),
  );
}

/**
 * Seçili etiketlerin listeden çıkarılmış hâli.
 *
 * Yeni bir keşifte artık var olmayan bir adres seçili kalırsa, kaydedilecek
 * yapılandırma cihazda bulunmayan bir düğüme işaret ederdi.
 */
export function pruneSelection(
  state: WizardState,
  tags: DiscoveredTag[],
): WizardState {
  const addresses = new Set(tags.map((tag) => tag.address));
  const selected = state.selected.filter((item) => addresses.has(item));
  if (selected.length === state.selected.length) return state;
  const mapping = { ...state.mapping };
  for (const address of Object.keys(mapping)) {
    if (!addresses.has(address)) delete mapping[address];
  }
  return { ...state, selected, mapping };
}

/**
 * Yeni bir uç seçildiğinde sihirbazı sıfırlar.
 *
 * Önceki uçun etiketleri ve eşlemeleri taşınsaydı, kullanıcı başka bir
 * cihazın düğümlerini yeni cihaza eşlemiş olurdu.
 */
export function resetWizard(): WizardState {
  return { ...INITIAL_WIZARD, completed: [], selected: [], mapping: {} };
}
