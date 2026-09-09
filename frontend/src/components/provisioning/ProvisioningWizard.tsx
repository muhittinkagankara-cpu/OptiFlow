/**
 * Cihaz devreye alma sihirbazı.
 *
 *     Uç adresi → Keşif → Etiket seçimi → Eşleme → Test → Kaydet
 *
 * Test kaydetmeden **önce** gelir: kaydedilmiş ama hiç denenmemiş bir bağlantı
 * arayüzde çalışıyormuş gibi durur. Keşif uçtan yanıt alamazsa liste boş kalır
 * ve nedeni yazılır; örnek etiket üretilmez.
 */

import { memo } from "react";
import { Check, Plug, RefreshCw, Search, TriangleAlert, Undo2 } from "lucide-react";
import {
  PROVISIONING_ORDER,
  authLabel,
  canEnter,
  credentialCaption,
  deviceChangeWarning,
  blockedReason,
  discoveryCaption,
  scoreLabel,
  scoreTone,
  stepLabel,
  tagValue,
  unmappedWarning,
  type DiscoveredTag,
  type ProvisioningStep,
  type ScoredSuggestion,
} from "../../lib/provisioning";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { useProvisioning } from "./useProvisioning";

/** Bilinen metrikler; kullanıcı bunlardan birini seçer. */
const METRICS = [
  "production_count",
  "scrap_count",
  "queue_length",
  "cycle_time_seconds",
  "downtime_minutes",
  "throughput_per_hour",
  "status",
];

function ProvisioningWizardInner() {
  const wizard = useProvisioning();
  const state = wizard.wizard;
  const changeWarning = deviceChangeWarning(wizard.discovery);
  const unmapped = unmappedWarning(wizard.unmapped);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionTitle
          title="Cihaz Devreye Alma"
          description="Uçtaki cihaza sorulur; bulunamayan bir etiket uydurulmaz."
          action={
            <Button variant="secondary" size="sm" onClick={wizard.reset}>
              Baştan başla
            </Button>
          }
        />

        <ol className="flex flex-wrap gap-2">
          {PROVISIONING_ORDER.map((step) => (
            <StepChip
              key={step}
              step={step}
              current={state.step === step}
              done={state.completed.includes(step)}
              enabled={canEnter(state, step)}
              onSelect={() => wizard.goTo(step)}
            />
          ))}
        </ol>
      </Card>

      {wizard.error !== null && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[11px] text-amber-800">{wizard.error}</p>
        </div>
      )}

      {state.step === "endpoint" && (
        <Card className="p-4">
          <SectionTitle title="Uç adresi" description="Protokol ve adres girin." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Protokol">
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={wizard.form.kind}
                onChange={(event) => wizard.updateForm({ kind: event.target.value })}
              >
                <option value="rest">REST</option>
                <option value="opcua">OPC UA</option>
                <option value="mqtt">MQTT</option>
              </select>
            </Field>
            <Field label="Adres">
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                placeholder="http://10.0.0.5:8080/veri"
                value={wizard.form.endpoint}
                onChange={(event) => wizard.updateForm({ endpoint: event.target.value })}
              />
            </Field>
            <Field label="Kullanıcı adı (isteğe bağlı)">
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={wizard.form.username}
                onChange={(event) => wizard.updateForm({ username: event.target.value })}
              />
            </Field>
            <Field label="Parola (isteğe bağlı)">
              <input
                type="password"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={wizard.form.password}
                onChange={(event) => wizard.updateForm({ password: event.target.value })}
              />
            </Field>
            {wizard.form.kind === "mqtt" && (
              <Field label="Konular (virgülle)">
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                  placeholder="fabrika/hat1/#"
                  value={wizard.form.topics}
                  onChange={(event) => wizard.updateForm({ topics: event.target.value })}
                />
              </Field>
            )}
          </div>
          <div className="mt-3">
            <Button variant="primary" size="sm" icon={Plug} onClick={wizard.confirmEndpoint}>
              Devam
            </Button>
          </div>
        </Card>
      )}

      {state.step === "discovery" && (
        <Card className="p-4">
          <SectionTitle
            title="Keşif"
            description="Cihazın adres uzayı taranır; bulunamayan etiket uydurulmaz."
            action={
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  icon={Search}
                  onClick={() => void wizard.discover(true)}
                  busy={wizard.busy}
                >
                  Keşfet
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  onClick={() => void wizard.discover(false)}
                  busy={wizard.busy}
                  title="Önbelleği atlayarak yeniden tara"
                >
                  Tazele
                </Button>
              </div>
            }
          />

          {changeWarning !== null && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] text-amber-800">{changeWarning}</p>
            </div>
          )}

          <p className="text-xs text-slate-600">{discoveryCaption(wizard.discovery)}</p>
          {wizard.discovery.evidence !== null && (
            <p className="mt-1 text-[11px] text-slate-500">
              Kanıt: {wizard.discovery.evidence}
            </p>
          )}
        </Card>
      )}

      {state.step === "tags" && (
        <Card className="p-4">
          <SectionTitle
            title="Etiket seçimi"
            description={`${wizard.discovery.tagCount} etiket bulundu; izlenecek olanları seçin.`}
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={wizard.confirmTags}
                disabled={state.selected.length === 0}
              >
                Devam
              </Button>
            }
          />
          {wizard.discovery.tags.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Etiket bulunamadı"
              description={wizard.discovery.detail}
            />
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {wizard.discovery.tags.map((tag, index) => (
                <TagRow
                  key={tag.address}
                  tag={tag}
                  score={wizard.scores[index]}
                  selected={state.selected.includes(tag.address)}
                  onToggle={() => wizard.toggle(tag.address)}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      {state.step === "mapping" && (
        <Card className="p-4">
          <SectionTitle
            title="Eşleme"
            description="Her etiketin hangi makinenin hangi ölçümü olduğunu belirtin."
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={wizard.useSuggestions}>
                  Önerileri uygula
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Undo2}
                  onClick={wizard.undoSuggested}
                  disabled={wizard.suggestedCount === 0}
                  title="Öneriden gelen eşlemeleri kaldırır; elle kurulanlar kalır"
                >
                  Önerileri geri al ({wizard.suggestedCount})
                </Button>
                <Button variant="primary" size="sm" onClick={wizard.confirmMapping}>
                  Devam
                </Button>
              </div>
            }
          />
          {wizard.suggestionNote !== null && (
            <p className="mb-2 text-[11px] text-slate-600">{wizard.suggestionNote}</p>
          )}
          {unmapped !== null && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] text-amber-800">{unmapped}</p>
            </div>
          )}
          <ul className="space-y-2">
            {state.selected.map((address) => (
              <MappingRow
                key={address}
                address={address}
                machineId={state.mapping[address]?.machineId ?? ""}
                metric={state.mapping[address]?.metric ?? ""}
                onChange={(machineId, metric) => wizard.map(address, machineId, metric)}
              />
            ))}
          </ul>
        </Card>
      )}

      {state.step === "test" && (
        <Card className="p-4">
          <SectionTitle
            title="Test"
            description="Bağlantı gerçek uçta denenir; başarısız bir test kaydetmeyi engeller."
            action={
              <Button
                variant="primary"
                size="sm"
                icon={Plug}
                onClick={() => void wizard.test()}
                busy={wizard.busy}
              >
                Bağlantıyı dene
              </Button>
            }
          />
          {wizard.credential === null ? (
            <p className="text-xs text-slate-500">Henüz deneme yapılmadı.</p>
          ) : (
            <div className="space-y-1">
              <Badge tone={wizard.credential.ok ? "good" : "bad"}>
                {wizard.credential.ok ? "Bağlantı kuruldu" : "Bağlantı kurulamadı"}
              </Badge>
              <p className="text-xs text-slate-600">{credentialCaption(wizard.credential)}</p>
              <p className="text-[11px] text-slate-500">
                Kimlik: {authLabel(wizard.credential.requiresAuth)}
              </p>
            </div>
          )}
        </Card>
      )}

      {state.step === "save" && (
        <Card className="p-4">
          <SectionTitle
            title="Kaydet"
            description="Testi geçen bağlantı ve eşlemeleri kaydedilir."
          />
          {wizard.canSave ? (
            <div className="space-y-2">
              <Badge tone="good" icon={Check}>
                Test geçildi
              </Badge>
              <ul className="space-y-1 text-xs text-slate-700">
                {wizard.mappings.map((item) => (
                  <li key={item.address} className="break-words">
                    {item.address} → {item.machineId} · {item.metric}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-500">
                Kaydetme, bağlantı ekranındaki "Bağlan" adımıyla tamamlanır.
              </p>
            </div>
          ) : (
            <p className="text-xs text-amber-800">
              Test edilmemiş ya da testi başarısız bir bağlantı kaydedilemez.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

/** Adım rozeti. */
function StepChip({
  step,
  current,
  done,
  enabled,
  onSelect,
}: {
  step: ProvisioningStep;
  current: boolean;
  done: boolean;
  enabled: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={!enabled}
        className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          current
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : done
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-white text-slate-600"
        }`}
      >
        {stepLabel(step)}
      </button>
    </li>
  );
}

/** Bulunan etiket satırı. */
/**
 * Bulunan etiket satırı.
 *
 * Güven puanı **kesir** olarak gösterilir ("2/3 kanıt"); yüzde yazılsaydı bir
 * olasılık gibi okunurdu. Öneri uygulanamıyorsa nedeni satırın altında yazar
 * — sessiz kalmak, kullanıcının neden bir şey olmadığını anlamamasına yol
 * açardı.
 */
function TagRow({
  tag,
  score,
  selected,
  onToggle,
}: {
  tag: DiscoveredTag;
  score: ScoredSuggestion | undefined;
  selected: boolean;
  onToggle: () => void;
}) {
  const blocked = score === undefined ? null : blockedReason(score);
  return (
    <li>
      <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 hover:border-slate-300">
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4" />
        <span className="min-w-0 flex-1 break-words text-xs text-slate-800">{tag.name}</span>
        {score !== undefined && (
          <Badge tone={scoreTone(score.score)}>{scoreLabel(score.score)}</Badge>
        )}
        <Badge tone="neutral">{tag.kindLabel}</Badge>
        <span className="text-[11px] text-slate-500">{tagValue(tag)}</span>
      </label>
      <p className="ml-6 break-all text-[10px] text-slate-400">{tag.address}</p>
      {selected && blocked !== null && (
        <p className="ml-6 text-[10px] text-amber-700">{blocked}</p>
      )}
    </li>
  );
}

/** Bir etiketin eşleme satırı. */
function MappingRow({
  address,
  machineId,
  metric,
  onChange,
}: {
  address: string;
  machineId: string;
  metric: string;
  onChange: (machineId: string, metric: string) => void;
}) {
  return (
    <li className="rounded-lg border border-slate-200 px-2 py-2">
      <p className="break-all text-[11px] text-slate-500">{address}</p>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
          placeholder="Makine (TORNA_01)"
          value={machineId}
          onChange={(event) => onChange(event.target.value, metric)}
        />
        <select
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
          value={metric}
          onChange={(event) => onChange(machineId, event.target.value)}
        >
          <option value="">Ölçüm seçin</option>
          {METRICS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export const ProvisioningWizard = memo(ProvisioningWizardInner);
