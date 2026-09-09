/**
 * Abonelik hazırlığı — ödeme **alınmaz**.
 *
 * Fiyatlar satış katmanının `monthlyFor` işleviyle hesaplanır; ekran hiçbir
 * çarpım yapmaz. İkinci bir hesap yapılsaydı, müşterinin teklifte gördüğü
 * rakamla üründe gördüğü rakam ayrışabilirdi.
 *
 * "Yükselt" düğmesi bir ödeme akışı başlatmaz ve bunu kendi üzerinde yazar.
 */

import { CreditCard, Info } from "lucide-react";
import {
  BILLING_NOTE,
  limitRows,
  planCards,
  upgradeAvailability,
  type PlanCard,
  type UsageSnapshot,
} from "../../lib/team";
import type { PlanId } from "../../lib/sales";
import { Badge, Button, Card, ProgressBar, SectionTitle } from "../ui/Primitives";
import {
  LIMIT_LABEL,
  LIMIT_TONE,
  UNVERIFIED_TEXT,
  showMoney,
} from "./teamStyles";

interface BillingPanelProps {
  tier: PlanId;
  usage: UsageSnapshot;
  machineCount: number;
  canManageBilling: boolean;
  denialReason: string;
  /** Fabrika sayısı okunamadıysa limit satırı bunu söyler. */
  factoryCountKnown: boolean;
}

export function BillingPanel({
  tier,
  usage,
  machineCount,
  canManageBilling,
  denialReason,
  factoryCountKnown,
}: BillingPanelProps) {
  const rows = limitRows(tier, usage);
  const cards = planCards(tier, usage, machineCount);
  const upgrade = upgradeAvailability();

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle
          title="Kullanım ve limitler"
          description="Mevcut paketin sınırlarına göre nerede olduğunuz."
        />

        <Card className="p-4">
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.key}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-slate-700">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-slate-900">
                      {row.key === "factories" && !factoryCountKnown
                        ? UNVERIFIED_TEXT
                        : row.note}
                    </span>
                    <Badge tone={LIMIT_TONE[row.status]}>
                      {LIMIT_LABEL[row.status]}
                    </Badge>
                  </span>
                </div>
                {row.ratio !== null && (
                  <ProgressBar
                    value={row.ratio}
                    tone={LIMIT_TONE[row.status]}
                    className="mt-1.5"
                  />
                )}
              </li>
            ))}
          </ul>

          {!factoryCountKnown && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              Fabrika sayısı sunucudan okunamadı; bu satır ölçülmüş bir değer
              değildir ve limit karşılaştırması yapılmamıştır.
            </p>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle
          title="Paketler"
          description={`Aylık ücretler ${machineCount} makine için hesaplandı.`}
        />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {cards.map((card: PlanCard, index) => (
            <Card
              key={card.id}
              index={index}
              className={`p-4 ${
                card.isCurrent ? "border-brand-300 ring-1 ring-brand-200" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{card.label}</p>
                {card.isCurrent && <Badge tone="info">Mevcut paket</Badge>}
                {card.isRecommended && <Badge tone="good">Önerilen</Badge>}
                {!card.fitsUsage && <Badge tone="bad">Kullanımı taşımıyor</Badge>}
              </div>

              <p className="mt-2 text-xl font-semibold text-slate-900">
                {showMoney(card.monthly)}
                <span className="text-xs font-normal text-slate-500"> /ay</span>
              </p>
              <p className="text-xs text-slate-500">
                Kurulum: {showMoney(card.setupFee)}
              </p>

              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                <li>
                  Kullanıcı: {card.limits.users === null ? "Sınırsız" : card.limits.users}
                </li>
                <li>
                  Fabrika:{" "}
                  {card.limits.factories === null ? "Sınırsız" : card.limits.factories}
                </li>
                <li>
                  Veri kaynağı:{" "}
                  {card.limits.connectors === null ? "Sınırsız" : card.limits.connectors}
                </li>
              </ul>

              <ul className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs text-slate-500">
                {card.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <Button
                className="mt-3 w-full"
                variant="secondary"
                icon={CreditCard}
                disabled
                title={canManageBilling ? upgrade.reason : denialReason}
              >
                Yükseltme kapalı
              </Button>
            </Card>
          ))}
        </div>

        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {BILLING_NOTE}
          {canManageBilling ? "" : ` ${denialReason}`}
        </p>
      </div>
    </div>
  );
}
