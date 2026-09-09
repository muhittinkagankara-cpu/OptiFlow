/**
 * Davet paneli — e-posta **gönderilmez**.
 *
 * Ekran bunu üç yerde söyler: formun altında, her bekleyen davetin notunda ve
 * bağlantının yanındaki rozette. Tek bir yerde yazsaydı, gözden kaçan bir
 * kullanıcı davetin ulaştığını sanar ve günlerce beklerdi.
 */

import { useState } from "react";
import { Copy, Link2, Mail, Send, XCircle } from "lucide-react";
import {
  INVITATION_STATUS_LABEL,
  ORIGIN_LABEL,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  ROLE_ORDER,
  invitationLink,
  invitationNote,
  statusAt,
  type Invitation,
  type Role,
} from "../../lib/team";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { INVITATION_TONE, ORIGIN_TONE } from "./teamStyles";

interface InvitePanelProps {
  invitations: Invitation[];
  nowMs: number;
  /** Davet oluşturma yetkisi; yoksa form kapalıdır ve nedeni yazar. */
  canInvite: boolean;
  denialReason: string;
  /** Bağlantının kökü; uygulamanın kendi adresi. */
  appOrigin: string;
  onInvite: (email: string, role: Role) => { error: string | null };
  onRevoke: (id: string) => void;
}

export function InvitePanel({
  invitations,
  nowMs,
  canInvite,
  denialReason,
  appOrigin,
  onInvite,
  onRevoke,
}: InvitePanelProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("engineer");
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function submit() {
    const result = onInvite(email, role);
    setError(result.error);
    if (result.error === null) {
      setEmail("");
    }
  }

  function copy(invitation: Invitation) {
    void navigator.clipboard
      ?.writeText(invitationLink(invitation, appOrigin))
      .then(() => setCopiedId(invitation.id))
      .catch(() => setCopiedId(null));
  }

  return (
    <div>
      <SectionTitle
        title="Davetler"
        description="Bağlantı üretilir; iletmek size kalır."
        action={<Badge tone="warning">E-posta gönderilmiyor</Badge>}
      />

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            disabled={!canInvite}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="kisi@firma.com"
            aria-label="Davet edilecek e-posta"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
          />
          <select
            value={role}
            disabled={!canInvite}
            onChange={(event) => setRole(event.target.value as Role)}
            aria-label="Davet rolü"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
          >
            {ROLE_ORDER.map((item) => (
              <option key={item} value={item}>
                {ROLE_LABEL[item]}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            icon={Send}
            disabled={!canInvite}
            title={canInvite ? "Davet bağlantısı oluştur" : denialReason}
            onClick={submit}
          >
            Bağlantı oluştur
          </Button>
        </div>

        <p className="mt-2 text-xs text-slate-500">{ROLE_DESCRIPTION[role]}</p>

        {!canInvite && (
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            {denialReason}
          </p>
        )}

        {error !== null && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
            {error}
          </p>
        )}

        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Davet e-postası gönderilmez: bu sürümde e-posta altyapısı yok. Oluşan
          bağlantıyı kopyalayıp kişiye kendiniz iletmeniz gerekir. Bağlantıyı
          karşılayan bir uç da henüz yok; akış benzetimdir.
        </p>
      </Card>

      <div className="mt-3">
        {invitations.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="Henüz davet yok"
            description="Bir e-posta girip bağlantı oluşturun; bağlantıyı kopyalayıp ekip arkadaşınıza iletebilirsiniz."
          />
        ) : (
          <ul className="space-y-2">
            {invitations.map((invitation) => {
              const status = statusAt(invitation, nowMs);
              return (
                <li key={invitation.id}>
                  <Card className="p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                          <span className="break-all">{invitation.email}</span>
                          <Badge tone={INVITATION_TONE[status]}>
                            {INVITATION_STATUS_LABEL[status]}
                          </Badge>
                          <Badge tone={ORIGIN_TONE[invitation.origin]}>
                            {ORIGIN_LABEL[invitation.origin]}
                          </Badge>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {ROLE_LABEL[invitation.role]} ·{" "}
                          {invitationNote(invitation, nowMs)}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          icon={Copy}
                          onClick={() => copy(invitation)}
                          title="Davet bağlantısını kopyala"
                        >
                          {copiedId === invitation.id ? "Kopyalandı" : "Kopyala"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={XCircle}
                          disabled={status !== "pending"}
                          onClick={() => onRevoke(invitation.id)}
                          title="Daveti iptal et"
                        >
                          İptal
                        </Button>
                      </div>
                    </div>

                    <p className="mt-2 flex items-center gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-600">
                      <Link2 className="h-3 w-3 shrink-0" />
                      <span className="whitespace-nowrap">
                        {invitationLink(invitation, appOrigin)}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-amber-700">
                      Benzetim: bu bağlantıyı karşılayan bir kabul akışı henüz yok.
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
