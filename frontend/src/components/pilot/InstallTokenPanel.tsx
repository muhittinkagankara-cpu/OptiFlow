/**
 * Kurulum tokenı paneli.
 *
 * Token metni **yalnızca üretildiği anda** görünür ve arayüz onu hiçbir yere
 * kaydetmez; kullanıcı kopyalamadan paneli kapatırsa token kaybolur ve yenisi
 * üretilir. Kaydedilseydi, tarayıcı belleğine düşen bir kurulum anahtarı
 * olurdu.
 *
 * Listede yalnızca özetin ilk sekiz karakteri görünür: iki tokenı ayırt etmeye
 * yeter, kaba kuvvete bir şey vermez.
 */

import { memo, useState } from "react";
import { Ban, Copy, KeyRound } from "lucide-react";
import {
  tokenCaption,
  tokenTone,
  type InstallToken,
  type IssuedToken,
} from "../../lib/commissioning";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";

interface InstallTokenPanelProps {
  tokens: InstallToken[];
  /** Yeni üretilen token; yoksa `null`. */
  issued: IssuedToken | null;
  onIssue: (site: string) => void;
  onRevoke: (tokenId: string, reason: string) => void;
  onDismissIssued: () => void;
  busy?: boolean;
}

function InstallTokenPanelInner({
  tokens,
  issued,
  onIssue,
  onRevoke,
  onDismissIssued,
  busy,
}: InstallTokenPanelProps) {
  const [site, setSite] = useState("");
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    if (issued === null) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      // Pano erişimi engellenmiş olabilir; kullanıcı metni elle seçebilsin
      // diye token ekranda açık durur ve hata yutulmaz.
      setCopied(false);
    }
  }

  return (
    <Card className="p-4">
      <SectionTitle
        title="Kurulum Tokenı"
        description="Saha mühendisi için tek kullanımlık anahtar; kurulum bitince kapanır."
      />

      {issued !== null && (
        <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-[11px] font-semibold text-brand-800">{issued.note}</p>
          <p className="mt-1 break-all rounded border border-brand-200 bg-white px-2 py-1 font-mono text-xs text-slate-800">
            {issued.token}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={Copy} onClick={() => void copyToken()}>
              {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
            <Button variant="secondary" size="sm" onClick={onDismissIssued}>
              Gizle
            </Button>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">
            Tesis / hat
          </span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
            placeholder="Hat 1"
            value={site}
            onChange={(event) => setSite(event.target.value)}
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          icon={KeyRound}
          onClick={() => onIssue(site)}
          busy={busy}
        >
          Token üret
        </Button>
      </div>

      {tokens.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Kurulum tokenı yok"
          description="Sahaya giden mühendis için tek kullanımlık bir token üretin; kurulum tamamlandığında kendiliğinden kapanır."
        />
      ) : (
        <ul className="space-y-2">
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} onRevoke={onRevoke} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function TokenRow({
  token,
  onRevoke,
}: {
  token: InstallToken;
  onRevoke: (tokenId: string, reason: string) => void;
}) {
  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-900">
            {token.site || "Tesis belirtilmedi"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {token.digestPrefix}… · {tokenCaption(token)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tokenTone(token.status)}>{token.statusLabel}</Badge>
          {token.status === "active" && (
            <Button
              variant="secondary"
              size="sm"
              icon={Ban}
              onClick={() => onRevoke(token.id, "Elle iptal edildi")}
            >
              İptal
            </Button>
          )}
        </div>
      </div>

      {token.usageLog.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {token.usageLog.map((entry, index) => (
            <li key={index} className="text-[10px] text-slate-500">
              {entry.action}
              {entry.actor !== null && ` · ${entry.actor}`}
              {entry.detail !== null && ` · ${entry.detail}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export const InstallTokenPanel = memo(InstallTokenPanelInner);
