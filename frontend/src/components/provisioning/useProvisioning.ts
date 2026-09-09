/**
 * Devreye alma sihirbazının durumu.
 *
 * Kanca yalnızca **taşır ve çağırır**: adım sırası, seçim ve eşleme mantığı
 * `lib/provisioning/wizard` içindeki saf işlevlerdedir.
 *
 * Parola neden durumda tutulur ama gönderilirken temizlenir
 * ---------------------------------------------------------
 * Kullanıcı parolayı forma yazar; istek gövdesinde boş bir kullanıcı adı
 * gönderilmez (bazı uçlarda boş `Authorization` başlığı 400 üretir). Parola
 * hiçbir yanıtta geri dönmez ve hiçbir yere kaydedilmez.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { RuntimeBridgeClient } from "../../lib/connectors";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";
import {
  INITIAL_WIZARD,
  NO_DISCOVERY,
  applicableSuggestions,
  applySuggestions,
  canSave,
  completeStep,
  goToStep,
  mappingList,
  pruneSelection,
  recordTest,
  resetWizard,
  setMapping,
  toggleTag,
  scoreAll,
  suggestedCount,
  suggestionOutcome,
  undoSuggestions,
  unmappedTags,
  unresolvedSuggestions,
  type CredentialTest,
  type DiscoveryResult,
  type ProvisioningStep,
  type WizardState,
} from "../../lib/provisioning";

/** Bağlantı formunun alanları. */
export interface EndpointForm {
  kind: string;
  endpoint: string;
  username: string;
  password: string;
  topics: string;
}

export const EMPTY_FORM: EndpointForm = {
  kind: "rest",
  endpoint: "",
  username: "",
  password: "",
  topics: "",
};

export function useProvisioning() {
  const [form, setForm] = useState<EndpointForm>(EMPTY_FORM);
  const [wizard, setWizard] = useState<WizardState>(INITIAL_WIZARD);
  const [discovery, setDiscovery] = useState<DiscoveryResult>(NO_DISCOVERY);
  const [credential, setCredential] = useState<CredentialTest | null>(null);
  const [busy, setBusy] = useState(false);
  //: Öneri düğmesinin ne yaptığı; hiç basılmadıysa `null`.
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<RuntimeBridgeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RuntimeBridgeClient({
      baseUrl: API_BASE_URL,
      getToken: getAccessToken,
    });
  }

  /** İstek gövdesinin ortak alanları. */
  const payload = useCallback(
    () => ({
      kind: form.kind,
      endpoint: form.endpoint.trim(),
      username: form.username.trim() || null,
      password: form.password || null,
      topics: form.topics
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    }),
    [form],
  );

  const updateForm = useCallback((patch: Partial<EndpointForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  /**
   * Uç adresini onaylar ve keşif adımına geçer.
   *
   * Uç değiştiğinde sihirbaz sıfırlanır: önceki cihazın etiketleri ve
   * eşlemeleri taşınsaydı, başka bir cihazın düğümleri yeni cihaza eşlenmiş
   * olurdu.
   */
  const confirmEndpoint = useCallback(() => {
    if (form.endpoint.trim().length === 0) {
      setError("Uç adresi boş bırakılamaz.");
      return;
    }
    setError(null);
    if (discovery.endpoint !== "" && discovery.endpoint !== form.endpoint.trim()) {
      setDiscovery(NO_DISCOVERY);
      setCredential(null);
      setWizard(completeStep(resetWizard(), "endpoint"));
      return;
    }
    setWizard((current) => completeStep(current, "endpoint"));
  }, [discovery.endpoint, form.endpoint]);

  /** Uçtaki cihaza "nelerin var?" diye sorar. */
  const discover = useCallback(
    async (useCache = true) => {
      const client = clientRef.current;
      if (client === null) return;
      setBusy(true);
      setError(null);
      const result = await client.discover({ ...payload(), useCache });
      setBusy(false);
      if (result.data === null) {
        setError(result.error);
        return;
      }
      const found = result.data;
      setDiscovery(found);
      // Yeni keşifte artık var olmayan adresler seçimden düşer: kaydedilecek
      // yapılandırma cihazda bulunmayan bir düğüme işaret edemez.
      setWizard((current) => {
        const pruned = pruneSelection(current, found.tags);
        return found.ok ? completeStep(pruned, "discovery") : pruned;
      });
    },
    [payload],
  );

  const toggle = useCallback((address: string) => {
    setWizard((current) => toggleTag(current, address));
  }, []);

  const confirmTags = useCallback(() => {
    setWizard((current) => completeStep(current, "tags"));
  }, []);

  const map = useCallback((address: string, machineId: string, metric: string) => {
    setWizard((current) => setMapping(current, address, machineId, metric));
  }, []);

  /**
   * Sunucunun önerilerini boş eşlemelere uygular; elle kurulanı ezmez.
   *
   * Sonuç her zaman yazılır: hiçbir öneri uygulanamadığında sessiz kalmak,
   * düğmenin bozuk olduğu izlenimi verirdi.
   */
  const useSuggestions = useCallback(() => {
    setWizard((current) => {
      const applied = applicableSuggestions(current, discovery.suggestions).length;
      const unresolved = unresolvedSuggestions(current, discovery.suggestions).length;
      setSuggestionNote(suggestionOutcome(applied, unresolved));
      return applySuggestions(current, discovery.suggestions);
    });
  }, [discovery.suggestions]);

  const confirmMapping = useCallback(() => {
    setWizard((current) => completeStep(current, "mapping"));
  }, []);

  /** Kimlik bilgilerini gerçek uçta dener. */
  const test = useCallback(async () => {
    const client = clientRef.current;
    if (client === null) return;
    setBusy(true);
    setError(null);
    const result = await client.testCredentials(payload());
    setBusy(false);
    if (result.data === null) {
      setError(result.error);
      return;
    }
    const outcome = result.data;
    setCredential(outcome);
    setWizard((current) => completeStep(recordTest(current, outcome.ok, outcome.detail), "test"));
  }, [payload]);

  const goTo = useCallback((step: ProvisioningStep) => {
    setWizard((current) => goToStep(current, step));
  }, []);

  const reset = useCallback(() => {
    setWizard(resetWizard());
    setDiscovery(NO_DISCOVERY);
    setCredential(null);
    setError(null);
    setSuggestionNote(null);
  }, []);

  /**
   * Geri alınacak öneri var mı? Yoksa düğme kapalı durur — yapacağı bir şey
   * olmayan bir düğme, kullanıcıya bozuk görünürdü.
   */
  const undoSuggested = useCallback(() => {
    setWizard((current) => undoSuggestions(current));
    setSuggestionNote(null);
  }, []);

  /**
   * Bulunan etiketlerin güven puanları.
   *
   * Makine ve ölçüm sunucudan gelir; buradaki tek ek kanıt, okunan değerin
   * türüyle ölçümün uyumudur.
   */
  const scores = useMemo(
    () => scoreAll(discovery.tags, discovery.suggestions),
    [discovery.tags, discovery.suggestions],
  );

  const mappings = useMemo(() => mappingList(wizard), [wizard]);
  const unmapped = useMemo(() => unmappedTags(wizard), [wizard]);

  return {
    form,
    wizard,
    discovery,
    credential,
    busy,
    error,
    suggestionNote,
    scores,
    suggestedCount: suggestedCount(wizard),
    mappings,
    unmapped,
    canSave: canSave(wizard),
    updateForm,
    confirmEndpoint,
    discover,
    toggle,
    confirmTags,
    map,
    useSuggestions,
    undoSuggested,
    confirmMapping,
    test,
    goTo,
    reset,
  };
}
