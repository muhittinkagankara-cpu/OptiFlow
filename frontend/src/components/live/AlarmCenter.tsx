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
import { BellOff, CircleCheck, Info, TriangleAlert, XCircle } from "lucide-react";
import {
  ALARM_LEVEL_LABEL,
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
}

function AlarmCenterInner({
  alarms,
  clockMinutes,
  onSelectStation,
}: AlarmCenterProps) {
  const grouped = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      items: alarms.filter((alarm) => alarm.level === group.level),
    })).filter((group) => group.items.length > 0);
  }, [alarms]);

  if (grouped.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/40 px-4 py-8 text-center">
        <BellOff className="mx-auto mb-2 h-6 w-6 text-slate-400" />
        <p className="text-xs font-medium text-slate-800">Açık alarm yok.</p>
        <p className="mt-0.5 text-[10px] text-slate-500">
          Arıza, uzayan kuyruk ya da yükselen fire burada görünür.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {grouped.map((group) => (
        <section key={group.level}>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            <group.icon className="h-3 w-3" />
            {ALARM_LEVEL_LABEL[group.level]}
            <span className="tabular-nums">({group.items.length})</span>
          </h4>
          <ul className="space-y-1.5">
            {group.items.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                clockMinutes={clockMinutes}
                onSelect={onSelectStation}
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
}: {
  alarm: Alarm;
  clockMinutes: number;
  onSelect: (stationId: string) => void;
}) {
  const style = ALARM_STYLE[alarm.level];
  const resolvedAt = alarm.resolvedAtMinutes;
  const isOpen = resolvedAt === null;
  // Açık alarmda süre "şu ana kadar", kapanmışta "ne kadar sürdü" demektir.
  const durationMinutes =
    resolvedAt === null
      ? Math.max(0, clockMinutes - alarm.atMinutes)
      : resolvedAt - alarm.atMinutes;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(alarm.stationId)}
        className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors duration-200 focus:outline-none ${
          isOpen ? style.box : "border-slate-200 bg-slate-100/40"
        } ${isOpen && alarm.level === "critical" ? "optiflow-alarm-pulse" : ""}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-semibold text-slate-900">
            {alarm.stationName}
          </span>
          <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">
            {formatClock(alarm.atMinutes)}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
          {alarm.text}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded border px-1 py-px text-[9px] font-semibold ${style.chip}`}
          >
            {ALARM_LEVEL_LABEL[alarm.level]}
          </span>
          <span className="text-[10px] text-slate-500 tabular-nums">
            {durationMinutes} dk
          </span>
          {!isOpen && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700">
              <CircleCheck className="h-2.5 w-2.5" />
              kapandı
            </span>
          )}
        </div>
      </button>
    </li>
  );
});

export const AlarmCenter = memo(AlarmCenterInner);
