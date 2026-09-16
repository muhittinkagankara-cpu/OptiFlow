/**
 * Alarm merkezi.
 *
 * Üç grup: kritik, uyarı, bilgi. Kritik alarmlar **yanıp sönmez**; yalnızca
 * kenarlıkları yavaşça nabız atar. Sekiz saat açık kalan bir ekranda yanıp
 * sönen bir kart, operatörün alarmı görmezden gelmeyi öğrenmesine yol açar —
 * hareket dikkat çekmeli, rahatsız etmemelidir.
 *
 * Giderilmiş alarmlar silinmez, "kapandı" olarak gösterilir ve süresi yazılır:
 * vardiya sonunda sorulacak ilk soru "arıza kaç dakika sürdü?" olur.
 */

import { memo, useMemo } from "react";
import {
  ArrowRight,
  BellOff,
  CircleCheck,
  Info,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import {
  ALARM_LEVEL_LABEL,
  alarmAction,
  formatClock,
  type Alarm,
  type AlarmLevel,
} from "../../lib/live";
import { ALARM_STYLE } from "./liveStyles";

const GROUPS: { level: AlarmLevel; icon: typeof XCircle }[] = [
  { level: "critical", icon: XCircle },
  { level: "warning", icon: TriangleAlert },
  { level: "info", icon: Info },
];

interface AlarmCenterProps {
  alarms: Alarm[];
  clockMinutes: number;
  onSelectStation: (stationId: string) => void;
  /**
   * Alarmın bağlanabildiği ekrana götürür (Sprint 2J).
   *
   * Yalnızca `alarmAction` güvenilir bir hedef bulduğunda çizilir; bugün bu
   * yalnızca kuyruk alarmı için doğru. Arıza ve fire alarmlarında düğme hiç
   * görünmez — çalışmayan bir düğme, olmayan bir yeteneği vaat etmektir.
   */
  onOpenSimulation?: () => void;
}

function AlarmCenterInner({
  alarms,
  clockMinutes,
  onSelectStation,
  onOpenSimulation,
}: AlarmCenterProps) {
  const grouped = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      items: alarms.filter((alarm) => alarm.level === group.level),
    })).filter((group) => group.items.length > 0);
  }, [alarms]);

  if (grouped.length === 0) {
    return (
      <div className="rounded-[var(--of-cc-radius-card)] border border-dashed border-[var(--of-cc-border)] px-4 py-10 text-center">
        <BellOff className="mx-auto mb-3 h-6 w-6 text-[var(--of-cc-ink-label)]" />
        <p className="text-[13px] font-medium text-[var(--of-cc-ink)]">
          Açık alarm yok.
        </p>
        <p className="mt-1 text-[12px] text-[var(--of-cc-ink-muted)]">
          Arıza, uzayan kuyruk ya da yükselen fire burada görünür.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map((group) => (
        <section key={group.level}>
          <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
            <group.icon className="h-3 w-3" />
            {ALARM_LEVEL_LABEL[group.level]}
            <span className="tabular-nums">({group.items.length})</span>
          </h4>
          <ul className="space-y-2.5">
            {group.items.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                clockMinutes={clockMinutes}
                onSelect={onSelectStation}
                onOpenSimulation={onOpenSimulation}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const AlarmCard = memo(function AlarmCard({
  alarm,
  clockMinutes,
  onSelect,
  onOpenSimulation,
}: {
  alarm: Alarm;
  clockMinutes: number;
  onSelect: (stationId: string) => void;
  onOpenSimulation?: () => void;
}) {
  const style = ALARM_STYLE[alarm.level];
  /* Sonraki adım kararı bileşende verilmez; `lib/live/alarmAction` verir. */
  const action = alarmAction(alarm);
  const resolvedAt = alarm.resolvedAtMinutes;
  const isOpen = resolvedAt === null;
  // Açık alarmda süre "şu ana kadar", kapanmışta "ne kadar sürdü" demektir.
  const durationMinutes =
    resolvedAt === null
      ? Math.max(0, clockMinutes - alarm.atMinutes)
      : resolvedAt - alarm.atMinutes;

  return (
    <li
      className={`optiflow-cc-lift rounded-[var(--of-cc-radius-card)] border bg-[var(--of-cc-card)] ${
        isOpen ? style.box : "border-[var(--of-cc-border)] opacity-70"
      } ${isOpen && alarm.level === "critical" ? "optiflow-alarm-pulse" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSelect(alarm.stationId)}
        className="min-h-[44px] w-full px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-semibold text-[var(--of-cc-ink)]">
            {alarm.stationName}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--of-cc-ink-label)] tabular-nums">
            {formatClock(alarm.atMinutes)}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-[var(--of-cc-ink-muted)]">
          {alarm.text}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded border px-1.5 py-px text-[10px] font-semibold ${style.chip}`}
          >
            {ALARM_LEVEL_LABEL[alarm.level]}
          </span>
          <span className="text-[11px] text-[var(--of-cc-ink-label)] tabular-nums">
            {durationMinutes} dk
          </span>
          {!isOpen && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
              <CircleCheck className="h-3 w-3" />
              kapandı
            </span>
          )}
        </div>
      </button>

      {/* Sonraki adım, yalnızca gerçekten bağlanabilen alarmda. Ayrı bir
          düğmedir: kartın kendisi istasyonu açar, bu ise ekran değiştirir —
          iki farklı sonucu tek dokunma hedefinde toplamak karışıklık olurdu. */}
      {action !== null && onOpenSimulation && (
        <button
          type="button"
          onClick={onOpenSimulation}
          className="flex min-h-[44px] w-full items-center gap-1.5 border-t border-[var(--of-cc-border)] px-4 text-left text-[13px] font-medium text-[var(--of-interactive)] transition-colors hover:text-[var(--of-interactive-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          {action.label}
        </button>
      )}
    </li>
  );
});

export const AlarmCenter = memo(AlarmCenterInner);
