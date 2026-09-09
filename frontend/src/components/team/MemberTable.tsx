/**
 * Üye yönetimi.
 *
 * Ekranda hiçbir rol karşılaştırması yoktur: "bu düğme açık mı?" sorusunu
 * `canChangeRole` ve `canRemoveMember` yanıtlar, gerekçesini de kendileri
 * yazar. Kural bileşende dursaydı, aynı kural izin motorunda ve ekranda
 * ayrı ayrı yaşar ve zamanla ayrışırdı.
 *
 * Her satır kaydın kaynağını taşır: örnek bir kişiye rol vermek mümkündür ama
 * bunun kimseye ulaşmadığı satırda yazar.
 */

import { useState } from "react";
import { Search, Trash2 } from "lucide-react";
import {
  EMPTY_MEMBER_FILTER,
  MEMBER_STATUS_LABEL,
  ORIGIN_LABEL,
  ROLE_LABEL,
  ROLE_ORDER,
  canRemoveMember,
  canChangeRole,
  countByOrigin,
  filterMembers,
  lastActiveLabel,
  sortMembers,
  type Member,
  type MemberFilter,
  type Role,
} from "../../lib/team";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import {
  MEMBER_STATUS_TONE,
  ORIGIN_TONE,
  ROLE_ICON,
  ROLE_TONE,
  UNVERIFIED_TEXT,
} from "./teamStyles";

interface MemberTableProps {
  members: Member[];
  /** Oturumdaki kullanıcı; yetki soruları onun rolüyle sorulur. */
  viewer: Member;
  nowMs: number;
  onChangeRole: (id: string, role: Role) => void;
  onRemove: (id: string) => void;
}

export function MemberTable({
  members,
  viewer,
  nowMs,
  onChangeRole,
  onRemove,
}: MemberTableProps) {
  const [filter, setFilter] = useState<MemberFilter>(EMPTY_MEMBER_FILTER);
  const visible = sortMembers(filterMembers(members, filter));
  const origins = countByOrigin(members);

  return (
    <div>
      <SectionTitle
        title="Üyeler"
        description={`${origins.account + origins.local} gerçek kayıt, ${origins.fixture} örnek kayıt.`}
      />

      <Card className="p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filter.query}
              onChange={(event) =>
                setFilter({ ...filter, query: event.target.value })
              }
              placeholder="Ad ya da e-posta ara"
              aria-label="Üye ara"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-brand-400 focus:outline-none"
            />
          </label>

          <select
            value={filter.role}
            onChange={(event) =>
              setFilter({ ...filter, role: event.target.value as Role | "all" })
            }
            aria-label="Role göre süz"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
          >
            <option value="all">Tüm roller</option>
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Eşleşen üye yok"
            description="Arama ya da rol süzgecini değiştirin; ekipte bu ölçütlere uyan kimse görünmüyor."
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((member) => {
              const RoleIcon = ROLE_ICON[member.role];
              const roleDecision = canChangeRole(viewer, member, member.role);
              const removal = canRemoveMember(viewer, member);
              const seen = lastActiveLabel(member, nowMs);

              return (
                <li
                  key={member.id}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="break-words">{member.name}</span>
                        <Badge tone={ORIGIN_TONE[member.origin]}>
                          {ORIGIN_LABEL[member.origin]}
                        </Badge>
                        <Badge tone={MEMBER_STATUS_TONE[member.status]}>
                          {MEMBER_STATUS_LABEL[member.status]}
                        </Badge>
                      </p>
                      <p className="mt-0.5 break-all text-xs text-slate-500">
                        {member.email === "" ? "E-posta bilinmiyor" : member.email}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Son etkinlik: {seen ?? UNVERIFIED_TEXT}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={ROLE_TONE[member.role]} icon={RoleIcon}>
                        {ROLE_LABEL[member.role]}
                      </Badge>

                      <select
                        value={member.role}
                        disabled={!roleDecision.allowed}
                        title={roleDecision.reason ?? "Rolü değiştir"}
                        aria-label={`${member.name} rolü`}
                        onChange={(event) =>
                          onChangeRole(member.id, event.target.value as Role)
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {ROLE_ORDER.map((role) => (
                          <option
                            key={role}
                            value={role}
                            /*
                             * Her seçenek ayrı ayrı sorulur: bir yönetici
                             * başka bir üyenin rolünü değiştirebilir ama onu
                             * sahip yapamaz. Tek bir "değiştirilebilir mi?"
                             * sorusu bu ayrımı kaçırırdı.
                             */
                            disabled={!canChangeRole(viewer, member, role).allowed}
                          >
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>

                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        disabled={!removal.allowed}
                        title={removal.reason ?? "Üyeyi çıkar"}
                        ariaLabel={`${member.name} üyeliğini kaldır`}
                        onClick={() => onRemove(member.id)}
                      >
                        <span className="sr-only">Çıkar</span>
                      </Button>
                    </div>
                  </div>

                  {roleDecision.reason !== null && (
                    <p className="mt-2 text-xs text-slate-500">
                      {roleDecision.reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
