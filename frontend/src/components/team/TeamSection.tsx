/**
 * Ekip bölümü — altı ekranın ortak kabuğu.
 *
 * Bölümün tek karar noktası yetki sorularıdır ve hepsi `can(...)` ile sorulur:
 * bu dosyada hiçbir rol karşılaştırması yazılı değildir. Bir düğmenin neden
 * kapalı olduğunu da izin motoru söyler (`denialReason`), böylece aynı gerekçe
 * altı ekranda birebir aynı cümleyle görünür.
 *
 * Kaynak etiketleri (Hesap / Bu cihaz / Örnek) her sekmede taşınır; ekip
 * verisinin büyük bölümü bu sürümde örnek veridir ve bunu gizlemek, olmayan
 * bir kişiye yetki verildiğini sandırırdı.
 */

import { useMemo, useState } from "react";
import {
  CreditCard,
  History,
  MessageSquare,
  Send,
  Settings2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SimulationConfig } from "../../types/simulationTypes";
import {
  can,
  denialReason,
  type CommentTarget,
} from "../../lib/team";
import { Badge, Card } from "../ui/Primitives";
import { ActivityTimeline } from "./ActivityTimeline";
import { BillingPanel } from "./BillingPanel";
import { CommentBoard } from "./CommentBoard";
import { InvitePanel } from "./InvitePanel";
import { MemberTable } from "./MemberTable";
import { OrgSettingsForm } from "./OrgSettingsForm";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { useTeamWorkspace } from "./useTeamWorkspace";

type Tab = "workspace" | "members" | "invites" | "activity" | "comments" | "billing" | "settings";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "workspace", label: "Çalışma alanı", icon: Users },
  { id: "members", label: "Üyeler", icon: Users },
  { id: "invites", label: "Davetler", icon: Send },
  { id: "activity", label: "Geçmiş", icon: History },
  { id: "comments", label: "Yorumlar", icon: MessageSquare },
  { id: "billing", label: "Abonelik", icon: CreditCard },
  { id: "settings", label: "Ayarlar", icon: Settings2 },
];

interface TeamSectionProps {
  userId: string;
  /** Oturumun e-postası; anonim oturumlarda bilinmez. */
  email: string | null | undefined;
  orgName: string;
  /** Açık fabrika modeli; hiçbir fabrika açık değilse `null`. */
  config: SimulationConfig | null;
  factoryName: string | null;
  /** Sunucudan okunan fabrika sayısı; okunamadıysa `null`. */
  factoryCount: number | null;
  machineCount: number;
  connectorCount: number;
}

export function TeamSection({
  userId,
  email,
  orgName,
  config,
  factoryName,
  factoryCount,
  machineCount,
  connectorCount,
}: TeamSectionProps) {
  const [tab, setTab] = useState<Tab>("workspace");
  const team = useTeamWorkspace({
    userId,
    email: email ?? null,
    orgName,
    factoryCount,
    machineCount,
    connectorCount,
  });

  const role = team.account.role;

  /** Yorum yazılabilecek yerler: açık fabrika ve istasyonları. */
  const targets = useMemo<CommentTarget[]>(
    () => [
      {
        kind: "factory",
        id: "acik-fabrika",
        label: factoryName ?? "Açık fabrika",
      },
      ...(config?.stations ?? []).map((station) => ({
        kind: "station" as const,
        id: station.id,
        label: station.name,
      })),
    ],
    [config, factoryName],
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900">Ekip</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {orgName} · Rolünüz: {role}
            </p>
          </div>
          <Badge tone="warning">Ekip verisinin çoğu örnektir</Badge>
        </div>

        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
          Bu sürümde sunucuda bir üye, davet ya da yorum ucu yok. Gerçek olan tek
          kimlik oturum açmış kullanıcıdır; oluşturduğunuz davetler, yorumlar ve
          ayarlar yalnızca bu tarayıcıda saklanır. Geri kalan kayıtlar ürünün ne
          yaptığını göstermek için konmuş örneklerdir ve her biri "Örnek"
          rozetiyle görünür.
        </p>
      </Card>

      {/*
        Sekme şeridi dar ekranda kendi içinde kayar. Negatif kenar boşluğu
        (`-mx-1`) denendi ve 375 pikselde kapsayıcıyı 8 piksel taşırdığı
        tarayıcıda ölçüldü; kaydırma kutusu kendi sınırları içinde kalmalı.
      */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-1.5 rounded-lg border border-slate-200 bg-white p-1">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-pressed={tab === item.id}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none ${
                  tab === item.id
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "workspace" && (
        <WorkspaceOverview
          stats={team.stats}
          presence={team.presence}
          nowMs={team.nowMs}
        />
      )}

      {tab === "members" && (
        <MemberTable
          members={team.members}
          viewer={team.account}
          nowMs={team.nowMs}
          onChangeRole={team.changeRole}
          onRemove={team.removeMember}
        />
      )}

      {tab === "invites" && (
        <InvitePanel
          invitations={team.invitations}
          nowMs={team.nowMs}
          canInvite={can(role, "canManageMembers")}
          denialReason={denialReason(role, "canManageMembers")}
          appOrigin={window.location.origin}
          onInvite={team.invite}
          onRevoke={team.revoke}
        />
      )}

      {tab === "activity" && (
        <ActivityTimeline events={team.events} nowMs={team.nowMs} />
      )}

      {tab === "comments" && (
        <CommentBoard
          comments={team.comments}
          targets={targets}
          nowMs={team.nowMs}
          canComment={can(role, "canComment")}
          canResolve={can(role, "canResolveComment")}
          denialReason={denialReason(role, "canResolveComment")}
          onAdd={team.addComment}
          onResolve={team.resolveComment}
          onReopen={team.reopenComment}
        />
      )}

      {tab === "billing" && (
        <BillingPanel
          /*
           * Paket bilgisi sunucudan gelmiyor; kota motorunun çalıştığı
           * görülebilsin diye Growth varsayılıyor ve varsayım burada yazılı.
           */
          tier="growth"
          usage={team.usage}
          machineCount={machineCount}
          canManageBilling={can(role, "canManageBilling")}
          denialReason={denialReason(role, "canManageBilling")}
          factoryCountKnown={factoryCount !== null}
        />
      )}

      {tab === "settings" && (
        <OrgSettingsForm
          settings={team.settings}
          canEdit={can(role, "canEditOrgSettings")}
          denialReason={denialReason(role, "canEditOrgSettings")}
          onSave={team.saveSettings}
        />
      )}
    </div>
  );
}
