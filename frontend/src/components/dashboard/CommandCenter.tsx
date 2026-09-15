/**
 * Sayfa 1 — Factory OS Komuta Merkezi.
 *
 * Ekranın hiyerarşisi kullanıcının sorduğu sırayı izler:
 *
 *   DURUM → KISIT → SONUÇ → KARAR → SIRADAKİ KONULAR → HAT SAĞLIĞI
 *
 * Yani: fabrikada ne oluyor, neyin yüzünden oluyor, bunun operasyonel ve
 * parasal karşılığı ne, şimdi ne yapmalı.
 *
 * Ne değişti (Sprint 2D)
 * ----------------------
 * Önceki hâl bir KPI panosuydu: selamlamayla açılıyor, dört gradient kartla
 * devam ediyor, aynı kural motorunu iki ayrı blokta ("AI Morning Brief" ve
 * "Bugün Yapılacaklar") tekrarlıyor ve boşken bile ekranın yarısını kaplayan
 * bir bölüm bırakıyordu. Ölçüldü: 43 kenarlıklı yüzey, 5 gradient, 5 renkli
 * ikon kutusu, telefonda 3,7 ekran boyu kaydırma.
 *
 * Hesap katmanı **değişmedi**. `dashboardMetrics`, `actionItems` ve
 * `factoryHealth` aynı işlevlerle, aynı eşiklerle çağrılır; bu dosya yalnızca
 * onların çıktısını çizer. Seçim ve cümle kurma mantığı
 * `lib/commandCenter` içinde, sınanabilir saf işlevlerdedir.
 *
 * Veri kökeni
 * -----------
 * Ekrandaki her sayı **son simülasyon koşumundan** gelir; hattın o anki
 * hâlinden değil. Canlı akış bu ekrana bağlı değildir ve bağlıymış gibi
 * gösterilmez — köken rozeti bunu açıkça söyler (KURAL 1).
 *
 * Hesaplanamayan hiçbir gösterge uydurulmaz: değeri "—" olur, nedeni yazılır
 * ve ölçümü tamamlayacak adıma götürür (Yasa 4).
 */

import { ArrowRight } from "lucide-react";
import { ClipboardList } from "lucide-react";
import type {
  FinancialReport,
  InventoryAnalysis,
  SimulationResults,
} from "../../types/simulationTypes";
import {
  capacityShare,
  bottleneckSummary,
  dailyThroughput,
  monthlyLoss,
  monthlyRecoverable,
} from "../../lib/dashboardMetrics";
import {
  buildActionItems,
  type ActionItem,
  type ActionPriority,
  type ActionTarget,
} from "../../lib/actionItems";
import { buildHealthIndicators } from "../../lib/factoryHealth";
import type { ChecklistItem } from "../../lib/onboarding-enterprise";
import { formatMoney } from "../../lib/financeFormatting";
import { formatUnits } from "../../lib/resultsFormatting";
import {
  confidenceLine,
  factoryStatement,
  leadDecision,
  railStations,
  remainingTopics,
  runProvenance,
} from "../../lib/commandCenter";
import type { MeasuredState } from "../../lib/ui";
import { Button, EmptyState } from "../ui/Primitives";
import { ConstraintRail } from "../ui/ConstraintRail";
import { DecisionBlock } from "../ui/DecisionBlock";
import { MetricGroup, type MetricItem } from "../ui/MetricGroup";
import { OriginBadge } from "../ui/OriginBadge";
import { Statement } from "../ui/Statement";
import { CriticalTopics } from "./CriticalTopics";
import { FactoryHealthStrip } from "./FactoryHealthStrip";
import { SetupProgressStrip } from "./SetupProgressStrip";

/** Eylem önceliği, ölçülmüş durum sözlüğüne çevrilir; yeni renk üretilmez. */
const PRIORITY_STATE: Record<ActionPriority, MeasuredState> = {
  critical: "fault",
  warning: "warn",
  info: "unknown",
};

const PRIORITY_LABEL: Record<ActionPriority, string> = {
  critical: "Acil konu",
  warning: "Uyarı",
  info: "Bilgi",
};

interface CommandCenterProps {
  results: SimulationResults | null;
  report: FinancialReport | null;
  analyses: InventoryAnalysis[] | null;
  factoryCount: number;
  /** Kurulum adımları; şerit yalnızca eksik adım varsa çizilir. */
  setupItems: ChecklistItem[];
  onNavigate: (target: ActionTarget) => void;
  /** Kurulum şeridinin hedefi bir görünüm adıdır, bölüm değil. */
  onNavigateView: (view: string) => void;
}

export function CommandCenter({
  results,
  report,
  analyses,
  factoryCount,
  setupItems,
  onNavigate,
  onNavigateView,
}: CommandCenterProps) {
  /* --- Hesap katmanı: hepsi mevcut iş kuralları, değiştirilmedi --- */
  const daily = dailyThroughput(results);
  const capacity = capacityShare(results);
  const bottleneck = bottleneckSummary(results);
  const monthly = monthlyLoss(report);
  const recoverable = monthlyRecoverable(report);
  const actions = buildActionItems({ results, report, analyses, factoryCount });
  const health = buildHealthIndicators(results);

  /* --- Sunum katmanı: seçim ve cümle --- */
  const statement = factoryStatement(results);
  const stations = railStations(results);
  const provenance = runProvenance(results);
  const decision = leadDecision(actions);
  const topics = remainingTopics(actions);
  const confidence = confidenceLine(provenance);

  const metrics: MetricItem[] = [
    {
      id: "throughput",
      label: "Günlük üretim",
      value: daily === null ? null : `${formatUnits(daily)} birim`,
      consequence:
        capacity === null
          ? null
          : `Teorik kapasitenin %${Math.round(capacity * 100)}'i`,
      emptyReason: "Koşum yok",
      action: (
        <Button size="sm" onClick={() => onNavigate("simulation")}>
          Simülasyona git
        </Button>
      ),
    },
    {
      id: "oee",
      label: "Hat OEE",
      value: results === null ? null : `%${Math.round(results.line_oee * 100)}`,
      consequence:
        bottleneck === null
          ? null
          : `Kısıt ${bottleneck.name} · %${Math.round(bottleneck.utilization * 100)} dolu`,
      emptyReason: "Koşum yok",
      action: (
        <Button size="sm" onClick={() => onNavigate("simulation")}>
          Simülasyona git
        </Button>
      ),
    },
    {
      id: "loss",
      label: "Aylık kayıp",
      value: monthly === null ? null : formatMoney(monthly),
      consequence: "22 iş günü üzerinden ölçeklendi",
      emptyReason: "Maliyet oranları girilmedi",
      isMoney: true,
      action: (
        <Button size="sm" onClick={() => onNavigate("finance")}>
          Finans'a git
        </Button>
      ),
    },
    {
      id: "recoverable",
      label: "Geri kazanılabilir",
      value: recoverable === null ? null : formatMoney(recoverable),
      consequence: "Bilinen bir eylemin hedefleyebileceği tutar",
      emptyReason: "Maliyet oranları girilmedi",
      isMoney: true,
      action: (
        <Button size="sm" onClick={() => onNavigate("finance")}>
          Finans'a git
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-[var(--of-spacing-24)] px-4 py-6 sm:px-6">
      <SetupProgressStrip items={setupItems} onNavigate={onNavigateView} />

      <Statement
        headline={statement.headline}
        detail={statement.detail}
        meta={
          <>
            <OriginBadge origin={provenance.origin} />
            <span className="text-[12px] text-[var(--of-ink-3)]">
              {provenance.source}
            </span>
          </>
        }
        action={
          statement.action && (
            <Button
              variant="primary"
              icon={ArrowRight}
              onClick={() => onNavigate(statement.action!.target)}
            >
              {statement.action.label}
            </Button>
          )
        }
      />

      <ConstraintRail stations={stations} />

      <MetricGroup items={metrics} />

      {decision === null ? (
        <EmptyState
          icon={ClipboardList}
          title="Eşiği aşan bir konu yok"
          description="Doluluk, fire ve tampon oranlarının hepsi tanımlı eşiklerin içinde. Yeni bir senaryo denemek için simülasyonu açabilirsiniz."
          action={
            <Button variant="primary" onClick={() => onNavigate("simulation")}>
              Simülasyonu aç
            </Button>
          }
        />
      ) : (
        <DecisionBlock
          state={PRIORITY_STATE[decision.priority]}
          stateLabel={PRIORITY_LABEL[decision.priority]}
          situation={decision.title}
          why={decision.detail}
          /* Karara özel parasal karşılık veride yok: `monthlyLoss` ve
             `monthlyRecoverable` hat düzeyindedir. Bu tutarları tek bir eyleme
             yazmak, ölçülmemiş bir atıf olurdu; para bu yüzden ölçüm şeridinde,
             doğru etiketiyle duruyor. */
          provenanceLine={confidence}
          action={
            <Button
              variant="primary"
              icon={ArrowRight}
              onClick={() => onNavigate(decision.target)}
            >
              {decision.actionLabel}
            </Button>
          }
        />
      )}

      <CriticalTopics
        items={topics}
        onSelect={(item: ActionItem) => onNavigate(item.target)}
      />

      <FactoryHealthStrip indicators={health} />
    </div>
  );
}
