/**
 * Lisans paneli.
 *
 * Süresi dolan bir lisans ekranı karartmaz; panel bunu açıkça yazar: izleme
 * sürer, engellenen şey yeni kayıttır. Yalnızca "lisans doldu" demek,
 * kullanıcının ekranı kapanacak sanmasına yol açardı.
 */

import { memo, useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import {
  UNLIMITED,
  blockedLabel,
  licenseCaption,
  licenseWarning,
  limitTone,
  limitValue,
  type LicenseView,
  type LimitCheck,
} from "../../lib/licensing";
import { Badge, Button, Card, ProgressBar, SectionTitle } from "../ui/Primitives";

interface LicensePanelProps {
  view: LicenseView;
  onStartTrial: (customer: string) => void;
  busy?: boolean;
}

function LicensePanelInner({ view, onStartTrial, busy }: LicensePanelProps) {
  const [customer, setCustomer] = useState("");
  const warning = licenseWarning(view);

  return (
    <Card className="p-4">
      <SectionTitle
        title="Lisans"
        description={licenseCaption(view)}
        action={
          <Badge tone={view.healthy ? "good" : "warning"}>{view.statusLabel}</Badge>
        }
      />

      {warning !== null && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[11px] text-amber-800">{warning}</p>
        </div>
      )}

      {view.license === null ? (
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">
              Müşteri adı
            </span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
              placeholder="Pilot Fabrika A.Ş."
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
            />
          </label>
          <Button
            variant="primary"
            size="sm"
            icon={KeyRound}
            onClick={() => onStartTrial(customer)}
            busy={busy}
          >
            14 günlük deneme başlat
          </Button>
          <p className="text-[11px] text-slate-500">
            Deneme, Başlangıç planıyla aynı sınırlara sahiptir; kurulum deneme
            sırasında tamamlanabilir.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row label="Plan" value={view.license.tierLabel} />
            <Row label="Müşteri" value={view.license.customer || "—"} />
          </dl>

          <ul className="space-y-2">
            {view.limits.map((check) => (
              <LimitRow key={check.resource} check={check} />
            ))}
          </ul>

          <p className="text-[11px] text-slate-500">{blockedLabel(view.blocked)}</p>
        </div>
      )}
    </Card>
  );
}

/**
 * Tek bir sınır satırı.
 *
 * Sınırsız kaynakta çubuk çizilmez: dolmayacak bir çubuk, kullanıcıya
 * yanlışlıkla bir doluluk okutur.
 */
function LimitRow({ check }: { check: LimitCheck }) {
  const value = limitValue(check);
  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-700">{check.label}</span>
        <Badge tone={limitTone(check)}>{value}</Badge>
      </div>
      {value !== UNLIMITED && check.ratio !== null && (
        <div className="mt-1.5">
          <ProgressBar value={check.ratio} tone={limitTone(check)} />
        </div>
      )}
      {check.reason !== null && (
        <p className="mt-1 text-[11px] text-slate-500">{check.reason}</p>
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export const LicensePanel = memo(LicensePanelInner);
