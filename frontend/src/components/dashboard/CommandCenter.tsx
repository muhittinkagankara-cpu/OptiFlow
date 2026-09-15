/**
 * Sayfa 1 — Factory OS Komuta Merkezi.
 *
 * Ekranın hiyerarşisi kullanıcının sorduğu sırayı izler:
 *
 *   DURUM → KISIT → SONUÇ (ölçümler + hat sağlığı) → KARAR → SIRADAKİ KONULAR
 *   → SONRAKİ ADIM
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
 *
 * Ne değişti (Sprint 2F-C)
 * ------------------------
 * Sayfa "Hat sağlığı" şeridiyle, yani pasif bir ölçüm listesiyle bitiyordu —
 * Yasa 5'in tersi. Şerit ölçümlerin yanına alındı ve sayfa artık karar ya da
 * konular listesiyle, ikisi de bir yere götüren bloklarla bitiyor.
 *
 * Şeritten iki hücre çıkarıldı: "Doğrulama" ve "Tekrar". İkisi de fabrikanın
 * değil koşumun niteliğini anlatıyordu; üstelik "Tekrar" zaten karar
 * bloğundaki koşum satırında yazılıydı. Gösterge mantığı silinmedi, yalnızca
 * nereye yazıldıkları ayrıldı (`lib/commandCenter/health`).
 *
 * Ne değişti (Sprint 2F-E)
 * ------------------------
 * Sayfa konu listesiyle bitiyordu; liste "başka neler var" der, "önce ne
 * yapılacak" demez. Sona tek satırlık bir **kapanış adımı** eklendi: kararın
 * kendi eylemini ikincil düğmeyle tekrar erişilebilir kılar. Konu yoksa hiç
 * çizilmez, çünkü o durumda son blok zaten karar bloğudur.
 *
 * Zaman iki yerde görünür, üç değil: üstte rozetli birincil cümle, kararın
 * yanında sessiz dipnot. `MetricGroup` ve `FactoryHealthStrip` **kasıtlı
 * olarak** tazelik göstermez — ikisinin de her sayısı aynı koşumdan gelir ve
 * sayfa bunu bir kez söyler. Her bölüme aynı damgayı yazmak, üç ayrı ölçüm
 * zamanı varmış izlenimi bırakırdı.
 */

import { ArrowRight } from "lucide-react";
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
  closingStep,
  confidenceLine,
  factoryStatement,
  freshnessLine,
  leadDecision,
  operationalHealth,
  railStations,
  remainingTopics,
  runFreshness,
  runProvenance,
  runQualityLine,
} from "../../lib/commandCenter";
import type { MeasuredState } from "../../lib/ui";
import { Button } from "../ui/Primitives";
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
  /**
   * Ekrandaki koşumun alındığı an (ISO 8601) — `RunHistoryEntry.ranAt`.
   *
   * Eşleşen bir kayıt yoksa `null`; o zaman tazelik hiç gösterilmez.
   */
  ranAt: string | null;
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
  ranAt,
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
  const provenance = runProvenance(results, ranAt);
  const freshness = runFreshness(provenance.ranAt);
  const decision = leadDecision(actions);
  const topics = remainingTopics(actions);
  const confidence = confidenceLine(provenance);
  /* Şeritte yalnızca fabrikaya ait göstergeler kalır; koşuma ait olanlar
     kararın yanındaki tek satıra iner. Hesap değişmedi, yalnızca hangi
     sayının nereye yazıldığı değişti. */
  const operational = operationalHealth(health);
  /* Zaman iki yerde görünür ve ikisi aynı ağırlıkta değildir: üstte rozetli
     birincil cümle, kararın yanında 11 piksellik sessiz dipnot. Üçüncü bir
     yere yazılmaz (bkz. aşağıdaki MetricGroup/FactoryHealthStrip notu). */
  const runLine = runQualityLine(health, confidence, freshness);
  const closing = closingStep(decision, topics);

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
        /* Köken ve tazelik tek rozette birleşir. Ayrı bir "Son simülasyon
           koşumu" satırı artık yazılmıyor: "Benzetim" sözcüğü kaynağı zaten
           söylüyordu, ikisi birlikte aynı şeyi iki kez anlatıyordu. Zaman
           damgası yoksa kaynak açıklaması geri gelir — o durumda söylenecek
           tek şey odur. */
        meta={
          freshness === null ? (
            <>
              <OriginBadge origin={provenance.origin} />
              <span className="text-[12px] text-[var(--of-ink-3)]">
                {provenance.source}
              </span>
            </>
          ) : (
            <OriginBadge
              origin={provenance.origin}
              detail={freshnessLine(freshness)}
            />
          )
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

      {/* Hat sağlığı bir sonuç ölçümüdür, karar sonrası bir ek değil: kararın
          hangi tabloya bakılarak verildiğini anlatır. Bu yüzden ölçümlerin
          hemen ardında durur. */}
      <FactoryHealthStrip indicators={operational} />

      {decision === null ? (
        /*
         * Eşik aşımı yokken de ekran bir karar yüzeyidir. Önceki hâl genel bir
         * boş durum kartıydı: 313,6 piksel, ortalanmış, ikonlu ve kenarlıklı —
         * yani "burada bir şey yok" demek için sayfanın en büyük kutusunu
         * ayırıyordu (ANTI-PATTERNS #18). Artık karar bloğunun kendisi
         * kullanılıyor; şekil aynı kalır, durum "ok" olur ve birincil eylem
         * yerinde durur.
         *
         * Dil kasıtlı olarak yalın: kutlama yok, "harika/tebrikler" yok, yapay
         * zekâ dili yok. Yalnızca ölçülen durum ve sıradaki adım.
         */
        <DecisionBlock
          state="ok"
          stateLabel="Eşik aşımı yok"
          situation="Şu anda eşiği aşan bir konu yok."
          why="Doluluk, fire ve tampon oranlarının hepsi tanımlı eşiklerin içinde. Yeni bir senaryo denemek için simülasyonu açabilirsiniz."
          provenanceLine={runLine}
          action={
            <Button
              variant="primary"
              icon={ArrowRight}
              onClick={() => onNavigate("simulation")}
            >
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
          provenanceLine={runLine}
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

      {/* Yasa 5: sayfa eylemle biter. Konular varsa her satır bir yere
          götürür; yoksa son görünen blok karar bloğudur ve onun son öğesi
          birincil eylemdir. Pasif bir ölçüm şeridiyle bitmez. */}
      <CriticalTopics
        items={topics}
        onSelect={(item: ActionItem) => onNavigate(item.target)}
      />

      {/*
        Kapanış adımı. Konu listesi "başka neler var" der; bu satır "önce ne
        yapılacak" der ve kararın eylemini sayfanın sonunda tekrar erişilebilir
        kılar — liste uzunsa karar bloğu epey yukarıda kalıyordu.

        Eylem **ikincil** çizilir: birincil eylem karar bloğundadır ve bir
        ekranda iki birincil düğme yarışmaz. Hedef de kararın kendi hedefidir;
        yeni bir gezinme hedefi üretilmez.

        Konu yoksa `closingStep` null döner ve bu bölüm hiç çizilmez.
      */}
      {closing !== null && (
        <section className="flex flex-col gap-[var(--of-spacing-12)] border-t border-[var(--of-surface-hairline)] pt-[var(--of-spacing-16)] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-[11px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase">
              Sonraki adım
            </h3>
            <p className="mt-[var(--of-spacing-4)] text-[13px] leading-5 text-[var(--of-ink-2)]">
              {closing.text}
            </p>
          </div>
          <Button
            icon={ArrowRight}
            className="shrink-0"
            onClick={() => onNavigate(closing.target)}
          >
            {closing.actionLabel}
          </Button>
        </section>
      )}
    </div>
  );
}
