/**
 * Alttaki gerçek zamanlı olay çizgisi.
 *
 * Yeni olaylar üstten girer ve eskiler aşağı kayar. En fazla `FEED_LIMIT`
 * (100) kayıt tutulur; sınır indirgeyicide uygulanır, burada değil — iki yerde
 * ayrı sınır olsaydı biri ötekini sessizce eziyordu.
 *
 * Her satır `React.memo` ile sarılıdır ve kimliği içeriğinden türer. Böylece
 * yeni bir olay geldiğinde yalnızca eklenen satır render edilir; alttaki
 * doksan dokuz satıra dokunulmaz.
 */

import { memo } from "react";
import { Radio } from "lucide-react";
import { formatClock, type FeedEntry } from "../../lib/live";
import { ALARM_STYLE } from "./liveStyles";

interface EventTimelineProps {
  feed: FeedEntry[];
  onSelectStation: (stationId: string) => void;
}

function EventTimelineInner({ feed, onSelectStation }: EventTimelineProps) {
  if (feed.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
        <Radio className="h-3.5 w-3.5" />
        Akış bekleniyor — bir kaynağa bağlanın.
      </div>
    );
  }

  return (
    <ol className="flex h-full gap-2 overflow-x-auto px-3 py-2.5 lg:flex-col lg:gap-1.5 lg:overflow-x-hidden lg:overflow-y-auto">
      {feed.map((entry) => (
        <TimelineRow key={entry.id} entry={entry} onSelect={onSelectStation} />
      ))}
    </ol>
  );
}

const TimelineRow = memo(function TimelineRow({
  entry,
  onSelect,
}: {
  entry: FeedEntry;
  onSelect: (stationId: string) => void;
}) {
  const style = ALARM_STYLE[entry.level];

  return (
    <li className="optiflow-feed-in shrink-0 lg:shrink">
      <button
        type="button"
        disabled={entry.stationId === null}
        onClick={() => entry.stationId && onSelect(entry.stationId)}
        className={`flex w-56 items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors duration-200 focus:outline-none lg:w-full ${style.box} ${
          entry.stationId ? "hover:border-slate-300" : "cursor-default"
        }`}
      >
        <span className="shrink-0 pt-px text-[10px] font-semibold text-slate-500 tabular-nums">
          {formatClock(entry.atMinutes)}
        </span>
        <span className="min-w-0 flex-1 text-[11px] leading-snug text-slate-700">
          {entry.text}
        </span>
      </button>
    </li>
  );
});

export const EventTimeline = memo(EventTimelineInner);
