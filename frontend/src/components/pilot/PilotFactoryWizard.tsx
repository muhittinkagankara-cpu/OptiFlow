/**
 * Pilot Fabrika sihirbazı — gerçek bir uca bağlanmanın altı adımı.
 *
 * Sihirbazın tek amacı, bir bağlantının **gerçekten çalışıp çalışmadığını**
 * göstermektir. Bu yüzden:
 *
 * - HTTP isteği yalnızca kullanıcı "Bağlantıyı test et" dediğinde atılır.
 * - Gerçek istemcisi olmayan protokoller (OPC UA, MQTT, CSV, ERP) test
 *   edildiğinde "Doğrulanmadı" döner; sahte bir başarı üretilmez.
 * - Canlı önizleme yalnızca gerçekten gelen yükten beslenir; veri yoksa
 *   "Veri bekleniyor" yazar.
 *
 * Karar mantığının tamamı `lib/connectors/runtime` içindedir; bu dosya durum
 * taşır ve çizer.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  Link2,
  Play,
  RefreshCw,
  Square,
  Zap,
} from "lucide-react";
import {
  CONNECTOR_DESCRIPTION,
  CONNECTOR_LABEL,
  CONNECTOR_ORDER,
  LIVE_FIELDS,
  LIVE_FIELD_LABEL,
  RestRuntime,
  asPollingRuntime,
  buildDiagnostics,
  defaultSettings,
  emptyLiveFields,
  fieldsOf,
  mapPayload,
  mappedFieldCount,
  runtimeFor,
  setMapping,
  suggestField,
  validateMapping,
  type ConnectorKind,
  type ConnectorSettings,
  type Diagnostics,
  type LiveFields,
  type LiveMapping,
  type RuntimeProbe,
  type SettingValue,
} from "../../lib/connectors";
import { Button, Card } from "../ui/Primitives";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { PayloadInspector } from "./PayloadInspector";
import { STATUS_STYLE, showMeasured } from "./pilotStyles";

type StepId = "kind" | "settings" | "test" | "payload" | "mapping" | "live";

const STEPS: { id: StepId; label: string }[] = [
  { id: "kind", label: "Bağlantı türü" },
  { id: "settings", label: "Ayarlar" },
  { id: "test", label: "Test" },
  { id: "payload", label: "Yük incelemesi" },
  { id: "mapping", label: "Alan eşleme" },
  { id: "live", label: "Canlı önizleme" },
];

export function PilotFactoryWizard() {
  const [step, setStep] = useState<StepId>("kind");
  const [kind, setKind] = useState<ConnectorKind>("rest");
  const [settings, setSettings] = useState<ConnectorSettings>(() =>
    defaultSettings("rest"),
  );
  const [probe, setProbe] = useState<RuntimeProbe | null>(null);
  const [probes, setProbes] = useState<RuntimeProbe[]>([]);
  const [mappings, setMappings] = useState<LiveMapping[]>([]);
  const [live, setLive] = useState<LiveFields>(() => emptyLiveFields());
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  /* Yoklayan runtime bir kez kurulur; durdurma referansı burada tutulur. */
  const pollerRef = useRef<RestRuntime | null>(null);

  const runtime = useMemo(() => runtimeFor(kind), [kind]);
  const diagnostics: Diagnostics = useMemo(() => buildDiagnostics(probes), [probes]);
  const index = STEPS.findIndex((item) => item.id === step);

  const record = useCallback((next: RuntimeProbe) => {
    setProbe(next);
    setProbes((current) => [...current, next].slice(-50));
    setNowMs(Date.now());
  }, []);

  const runTest = useCallback(async () => {
    setBusy(true);
    try {
      record(await runtime.test(settings, Date.now()));
    } finally {
      setBusy(false);
    }
  }, [record, runtime, settings]);

  const toggleStream = useCallback(() => {
    if (streaming) {
      pollerRef.current?.stop();
      pollerRef.current = null;
      setStreaming(false);
      return;
    }

    const poller = asPollingRuntime(runtime);
    if (poller === null) {
      return;
    }
    pollerRef.current = poller as RestRuntime;
    poller.start(settings, (next) => {
      record(next);
      if (next.ok) {
        setLive(mapPayload(next.payload, mappings));
      }
    });
    setStreaming(true);
  }, [mappings, record, runtime, settings, streaming]);

  const patch = (key: string, value: SettingValue): void =>
    setSettings((current) => ({ ...current, [key]: value }));

  const issues = useMemo(
    () => (probe?.payload === undefined ? [] : validateMapping(probe?.payload, mappings)),
    [probe, mappings],
  );

  const status = probe?.status ?? "idle";
  const style = STATUS_STYLE[status];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pilot Fabrika Bağlantısı
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Gerçek bir uç noktaya bağlanın; doğrulanamayan hiçbir şey "bağlandı"
            olarak gösterilmez.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>

      {/* --- Adım şeridi --- */}
      <nav className="mb-4 flex flex-wrap gap-1.5">
        {STEPS.map((item, position) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            aria-current={step === item.id ? "step" : undefined}
            className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-200 ${
              step === item.id
                ? "border-brand-400 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            <span className="hidden sm:inline">{position + 1}. </span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* --- 1. Bağlantı türü --- */}
      {step === "kind" && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Bağlantı türü</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Bu sürümde yalnızca REST için gerçek bir istemci var. Diğerlerinin
            sözleşmesi hazır ama bağlantı kurulamıyor.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {CONNECTOR_ORDER.map((item) => {
              const client = runtimeFor(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setKind(item);
                    setSettings(defaultSettings(item));
                    setProbe(null);
                    setProbes([]);
                  }}
                  className={`optiflow-lift rounded-xl border p-3 text-left transition-colors duration-200 ${
                    kind === item
                      ? "border-brand-400 bg-brand-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {CONNECTOR_LABEL[item]}
                    </span>
                    <span
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
                        client.isImplemented
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-slate-200 bg-slate-100 text-slate-500"
                      }`}
                    >
                      {client.isImplemented ? "Gerçek istemci" : "Doğrulanmadı"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {CONNECTOR_DESCRIPTION[item]}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{client.description}</p>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* --- 2. Ayarlar --- */}
      {step === "settings" && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">
            {CONNECTOR_LABEL[kind]} ayarları
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Ayarlar yalnızca bu tarayıcıda tutulur; istek siz test edene kadar
            gönderilmez.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {fieldsOf(kind).map((field) => (
              <label key={field.key} className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {field.label}
                  {field.required && <span className="ml-1 text-red-500">*</span>}
                </span>
                {field.type === "boolean" ? (
                  <button
                    type="button"
                    onClick={() => patch(field.key, settings[field.key] !== true)}
                    className={`mt-1 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors duration-200 ${
                      settings[field.key] === true
                        ? "border-brand-400 bg-brand-50 text-brand-700"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {settings[field.key] === true ? "Açık" : "Kapalı"}
                  </button>
                ) : field.type === "select" ? (
                  <select
                    value={String(settings[field.key] ?? "")}
                    onChange={(event) => patch(field.key, event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Seçilmedi</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === "password" ? "password" : field.type}
                    value={String(settings[field.key] ?? "")}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      patch(
                        field.key,
                        event.target.value === ""
                          ? null
                          : field.type === "number"
                            ? Number(event.target.value)
                            : event.target.value,
                      )
                    }
                    className={inputClass}
                  />
                )}
                {field.hint !== undefined && (
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {field.hint}
                  </span>
                )}
              </label>
            ))}
          </div>
        </Card>
      )}

      {/* --- 3. Test --- */}
      {step === "test" && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Bağlantı testi</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {runtime.isImplemented
                    ? "Gerçek bir HTTP isteği gönderilir."
                    : "Bu protokol için gerçek istemci yok; test sonucu 'Doğrulanmadı' olacaktır."}
                </p>
              </div>
              <Button variant="primary" icon={Zap} busy={busy} onClick={() => void runTest()}>
                Bağlantıyı test et
              </Button>
            </div>

            {probe !== null && (
              <div className="mt-3 space-y-2">
                <p
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    probe.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : probe.attempted
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-slate-200 bg-slate-100 text-slate-600"
                  }`}
                >
                  {probe.detail}
                </p>

                <dl className="grid gap-2 sm:grid-cols-3">
                  <Metric
                    label="HTTP kodu"
                    value={probe.httpStatus === null ? "Doğrulanmadı" : String(probe.httpStatus)}
                  />
                  <Metric label="Gecikme" value={showMeasured(probe.latencyMs, "ms")} />
                  <Metric label="İçerik boyutu" value={showMeasured(probe.sizeBytes, "bayt")} />
                </dl>
              </div>
            )}
          </Card>

          <DiagnosticsPanel diagnostics={diagnostics} nowMs={nowMs} />
        </div>
      )}

      {/* --- 4. Yük incelemesi --- */}
      {step === "payload" && (
        <PayloadInspector
          payload={probe?.ok === true ? probe.payload : undefined}
          mappings={mappings}
          receivedAtMs={probe?.ok === true ? probe.atMs : null}
          source={`${CONNECTOR_LABEL[kind]} · ${String(settings.baseUrl ?? "")}`}
          onPick={(entry) => {
            const suggestion = suggestField(entry.path);
            if (suggestion !== null) {
              setMappings((current) => setMapping(current, suggestion, entry.path));
              setStep("mapping");
            }
          }}
        />
      )}

      {/* --- 5. Alan eşleme --- */}
      {step === "mapping" && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Alan eşleme</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Gelen yükteki adresi OptiFlow alanına bağlayın. Adres yükte yoksa
            uyarı çıkar; eşleme sessizce çalışmaz.
          </p>

          <ul className="mt-3 space-y-2">
            {LIVE_FIELDS.map((field) => {
              const current = mappings.find((item) => item.field === field);
              return (
                <li
                  key={field}
                  className="rounded-xl border border-slate-200 bg-white p-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {LIVE_FIELD_LABEL[field]}
                    </span>
                    <input
                      type="text"
                      value={current?.path ?? ""}
                      placeholder="örn. data.stations[0].queue"
                      onChange={(event) =>
                        setMappings((list) => setMapping(list, field, event.target.value))
                      }
                      className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {issues.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {issues.map((issue) => (
                <li
                  key={issue.field}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800"
                >
                  {issue.text}
                </li>
              ))}
            </ul>
          )}

          {probe?.ok !== true && (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              Eşlemeyi doğrulamak için önce başarılı bir test gerekiyor; şu an
              karşılaştırılacak bir yük yok.
            </p>
          )}
        </Card>
      )}

      {/* --- 6. Canlı önizleme --- */}
      {step === "live" && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Canlı önizleme</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {runtime.isImplemented
                    ? "Yoklama açıldığında değerler gerçekten gelen yükten okunur."
                    : "Bu protokolde gerçek istemci olmadığı için canlı akış açılamaz."}
                </p>
              </div>
              <Button
                variant={streaming ? "secondary" : "primary"}
                icon={streaming ? Square : Play}
                disabled={!runtime.isImplemented}
                onClick={toggleStream}
              >
                {streaming ? "Yoklamayı durdur" : "Yoklamayı başlat"}
              </Button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {LIVE_FIELDS.map((field) => (
                <div
                  key={field}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {LIVE_FIELD_LABEL[field]}
                  </p>
                  <p
                    className={`mt-1 text-lg font-semibold tabular-nums ${
                      live[field] === null ? "text-slate-400" : "text-slate-900"
                    }`}
                  >
                    {live[field] === null ? "Veri bekleniyor" : String(live[field])}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              {mappedFieldCount(live)} / {LIVE_FIELDS.length} alan gerçek veriden
              okundu.
            </p>
          </Card>

          <DiagnosticsPanel diagnostics={diagnostics} nowMs={nowMs} />
        </div>
      )}

      {/* --- Gezinme --- */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button
          icon={ArrowLeft}
          disabled={index === 0}
          onClick={() => setStep(STEPS[Math.max(0, index - 1)].id)}
        >
          Geri
        </Button>

        <div className="flex gap-2">
          {step === "test" && (
            <Button icon={RefreshCw} onClick={() => setProbes([])}>
              Tanılamayı sıfırla
            </Button>
          )}
          <Button
            variant="primary"
            icon={index === STEPS.length - 1 ? Link2 : ArrowRight}
            disabled={index === STEPS.length - 1}
            onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)].id)}
          >
            {index === STEPS.length - 1 ? "Son adım" : "Sonraki adım"}
          </Button>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        <Cable className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        Bu ekran gerçek bir uç noktaya gider. Tarayıcıdan yapılan isteklerde
        hedef sunucunun CORS izni gerekir; izin yoksa istek engellenir ve neden
        engellendiği test sonucunda yazar.
      </p>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm font-medium tabular-nums ${
          value === "Doğrulanmadı" ? "text-slate-400" : "text-slate-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
