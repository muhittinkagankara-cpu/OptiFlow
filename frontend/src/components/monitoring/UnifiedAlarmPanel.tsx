/**
 * Birleşik alarm paneli.
 *
 * Üç ekranın (Live Factory, Alarm Merkezi, Runtime panosu) tek alarm gerçeği
 * budur. Her satır kaynağını taşır: benzetimden gelen bir uyarı "Benzetim"
 * rozetiyle çıkar ve hiçbir koşulda gerçek bir arıza gibi görünmez.
 *
 * Kritik alarmlar **yanıp sönmez**. Sekiz saat açık kalan bir ekranda yanıp
 * sönen bir kart, operatörün alarmı görmezden gelmeyi öğrenmesine yol açar.
 *
 * Susturulmuş alarm listeden düşmez
 * ---------------------------------
 * `SILENCED` bir alarmın nedeni sürüyordur; yalnızca bildirimi kesilmiştir.
 * Listeden düşseydi, bakım sırasında ortaya çıkan gerçek bir arıza da
 * görünmez olurdu. Bunun yerine "Susturuldu" rozetiyle ve susturmanın ne
 * zaman biteceğiyle birlikte durur.
 */

import { memo, useMemo } from "react";
import {
  BellOff,
  BellRing,
  CircleCheck,
  Info,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import {
  ALARM_SEVERITY_ORDER,
  ESCALATION_CHAIN_LABEL,
  formatClock,
  formatDuration,
  type UnifiedAlarm,
  type UnifiedAlarmSeverity,
} from "../../lib/monitoring";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";
import { ORIGIN_TONE, SEVERITY_TONE, STATE_TONE } from "./monitoringStyles";

const SEVERITY_ICON: Record<UnifiedAlarmSeverity, typeof XCircle> = {
  critical: XCircle,
  warning: TriangleAlert,
  info: Info,
};

interface UnifiedAlarmPanelProps {
  alarms: UnifiedAlarm[];
  history: UnifiedAlarm[];
  /** Alarmı görüldü işaretler; verilmezse düğme çizilmez. */
  onAcknowledge?: (alarmId: string) => void;
  /** Alarmın bildirimini geçici olarak keser; verilmezse düğme çizilmez. */
  onSilence?: (alarmId: string) => void;
  /** Susturmayı kaldırır; verilmezse düğme çizilmez. */
  onUnsilence?: (alarmId: string) => void;
  /** Sunucudan hiç yanıt alınmadıysa boş durum metni değişir. */
  loaded?: boolean;
}

function AlarmRow({
  alarm,
  onAcknowledge,
  onSilence,
  onUnsilence,
}: {
  alarm: UnifiedAlarm;
  onAcknowledge?: (alarmId: string) => void;
  onSilence?: (alarmId: string) => void;
  onUnsilence?: (alarmId: string) => void;
}) {
  const Icon = SEVERITY_ICON[alarm.severity];
  // Görülmüş ve kapanmış alarmlar susturulmaz: biri zaten müdahale ediyor,
  // ötekinin kesilecek bildirimi yok.
  const canSilence = alarm.state === "OPEN" || alarm.state === "ESCALATED";

  return (
    <li className="rounded-lg border border-slate-200 bg-white/70 p-2.5">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-900">{alarm.message}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge tone={SEVERITY_TONE[alarm.severity]}>{alarm.severityLabel}</Badge>
            <Badge tone={STATE_TONE[alarm.state]}>{alarm.stateLabel}</Badge>
            <Badge tone={ORIGIN_TONE[alarm.origin]}>{alarm.originLabel}</Badge>
            <span className="text-[10px] text-slate-500">{alarm.ruleLabel}</span>
          </div>

          <p className="mt-1 text-[10px] text-slate-500">
            {formatClock(alarm.raisedAtMs)} · {formatDuration(alarm.durationMs)}
            {alarm.acknowledgedBy !== null && ` · ${alarm.acknowledgedBy} gördü`}
          </p>

          {alarm.state === "SILENCED" && (
            <p className="mt-1 text-[10px] text-slate-500">
              {alarm.silenceReason ?? "Susturuldu"}
              {alarm.silencedBy !== null && ` · ${alarm.silencedBy}`}
              {alarm.silencedUntilMs !== null &&
                ` · ${formatClock(alarm.silencedUntilMs)}'a kadar`}
            </p>
          )}

          {alarm.escalationLevel > 0 && (
            <p className="mt-1 text-[10px] text-amber-700">
              {ESCALATION_CHAIN_LABEL[alarm.escalationLevel] ?? `${alarm.escalationLevel}. kademe`}
              {" kademesine yükseltildi"}
              {alarm.repeatCount > 0 && ` · ${alarm.repeatCount} yineleme`}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          {onAcknowledge !== undefined &&
            (alarm.state === "OPEN" || alarm.state === "ESCALATED") && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onAcknowledge(alarm.id)}
              >
                Gördüm
              </Button>
            )}

          {onSilence !== undefined && canSilence && (
            <Button
              variant="secondary"
              size="sm"
              icon={BellOff}
              onClick={() => onSilence(alarm.id)}
              title="Bildirimi geçici olarak kes; alarm kapanmaz"
            >
              Sustur
            </Button>
          )}

          {onUnsilence !== undefined && alarm.state === "SILENCED" && (
            <Button
              variant="secondary"
              size="sm"
              icon={BellRing}
              onClick={() => onUnsilence(alarm.id)}
            >
              Geri al
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function UnifiedAlarmPanelInner({
  alarms,
  history,
  onAcknowledge,
  onSilence,
  onUnsilence,
  loaded = true,
}: UnifiedAlarmPanelProps) {
  const grouped = useMemo(
    () =>
      ALARM_SEVERITY_ORDER.map((severity) => ({
        severity,
        items: alarms.filter((item) => item.severity === severity),
      })).filter((group) => group.items.length > 0),
    [alarms],
  );

  const recent = useMemo(() => history.slice(0, 5), [history]);

  return (
    <Card>
      <SectionTitle
        title="Alarm Merkezi"
        description="Live Factory, bu panel ve runtime panosu aynı listeyi okur."
      />

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/40 px-4 py-8 text-center">
          <BellOff className="mx-auto mb-2 h-6 w-6 text-slate-400" />
          <p className="text-xs font-medium text-slate-800">
            {loaded ? "Açık alarm yok." : "Veri okunmadı."}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {loaded
              ? "Duruş, uzayan kuyruk, susan cihaz ya da kopan bağlantı burada görünür."
              : "Sunucudan henüz yanıt alınmadı; ölçüm olmadan alarm da üretilmez."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <section key={group.severity}>
              <h3 className="mb-1 text-[11px] font-semibold text-slate-500">
                {group.items[0].severityLabel}
                <span className="ml-1 font-normal text-slate-400">
                  · {group.items.length}
                </span>
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((alarm) => (
                  <AlarmRow
                    key={alarm.id}
                    alarm={alarm}
                    onAcknowledge={onAcknowledge}
                    onSilence={onSilence}
                    onUnsilence={onUnsilence}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-4 border-t border-slate-200 pt-3">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <CircleCheck className="h-3 w-3" />
            Kapanan alarmlar
          </h3>
          <ul className="space-y-1">
            {recent.map((alarm) => (
              <li
                key={`${alarm.id}-${alarm.resolvedAtMs ?? 0}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50/70 px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">
                  {alarm.message}
                </span>
                <span className="text-[10px] tabular-nums text-slate-500">
                  {formatDuration(alarm.durationMs)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}

export const UnifiedAlarmPanel = memo(UnifiedAlarmPanelInner);
