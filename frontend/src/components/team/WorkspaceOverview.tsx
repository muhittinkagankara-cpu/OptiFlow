/**
 * Ekip çalışma alanının özeti.
 *
 * Kartların değerleri `workspaceStats` içinde hesaplanır; burada yalnızca
 * çizilir. Okunamayan bir ölçü sıfır olarak değil "Doğrulanmadı" olarak görünür
 * ve nedeni kartın altında yazar — bir yöneticinin ölçülmemiş bir sayıyı
 * gerçek sanması, bu ekranda yapılabilecek en pahalı hatadır.
 */

import { CircleHelp, Users } from "lucide-react";
import {
  ORIGIN_LABEL,
  PRESENCE_NOTE,
  presenceLine,
  relativeTime,
  unverifiedCount,
  type PresenceEntry,
  type WorkspaceStat,
} from "../../lib/team";
import { Badge, Card, SectionTitle } from "../ui/Primitives";
import { ORIGIN_TONE, UNVERIFIED_TEXT } from "./teamStyles";

interface WorkspaceOverviewProps {
  stats: WorkspaceStat[];
  presence: PresenceEntry[];
  nowMs: number;
}

export function WorkspaceOverview({ stats, presence, nowMs }: WorkspaceOverviewProps) {
  const unverified = unverifiedCount(stats);

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle
          title="Çalışma alanı"
          description="Her ölçünün yanında nereden geldiği yazar."
          action={
            unverified > 0 ? (
              <Badge tone="warning" icon={CircleHelp}>
                {unverified} ölçü doğrulanmadı
              </Badge>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map((stat, index) => (
            <Card key={stat.label} className="p-4" index={index}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                {stat.origin !== null && (
                  <Badge tone={ORIGIN_TONE[stat.origin]}>
                    {ORIGIN_LABEL[stat.origin]}
                  </Badge>
                )}
              </div>
              <p
                className={`mt-2 break-words text-lg font-semibold ${
                  stat.value === null ? "text-amber-700" : "text-slate-900"
                }`}
              >
                {stat.value ?? UNVERIFIED_TEXT}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{stat.note}</p>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle
          title="Kimler çalışıyor"
          description="Örnek kayıtlar; canlı bir bağlantıdan gelmiyor."
          action={<Badge tone="warning">Canlı değil</Badge>}
        />

        <Card className="p-4">
          <ul className="space-y-2">
            {presence.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 text-sm last:border-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-2 text-slate-700">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {entry.name.slice(0, 2)}
                  </span>
                  <span className="min-w-0 break-words">{presenceLine(entry)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-slate-400">
                    {relativeTime(entry.atMs, nowMs)}
                  </span>
                  <Badge tone={ORIGIN_TONE[entry.origin]}>
                    {ORIGIN_LABEL[entry.origin]}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {PRESENCE_NOTE}
          </p>
        </Card>
      </div>
    </div>
  );
}
