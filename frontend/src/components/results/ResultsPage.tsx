/**
 * Sayfa 6 — Sonuç görselleştirme.
 *
 * Üç bölümü birleştirir: özet kartları (A), istasyon tablosu ve kullanım
 * grafiği (B), doğrulama paneli (C). Sıralama, kullanıcının sorularının doğal
 * sırasını izler: "ne kadar üretiyorum?" → "nerede tıkanıyorum?" → "bu bana ne
 * kadara mal oluyor?" → "bu sayılara neden güveneyim?".
 *
 * `ResultsPlaceholder.tsx` bu bileşenle tamamen değiştirilmiştir.
 *
 * ## Sprint 2G-A — köken ve gauge
 *
 * İki denetim bulgusu kapatıldı. Sayfa artık kökenini söylüyor ("Benzetim ·
 * Son koşum …") ve OEE ibreli gösterge yerine okunur bir ölçüm olarak
 * yazılıyor. Hesap katmanına dokunulmadı: `line_oee`, istasyon ölçümleri,
 * darboğaz, finans ve doğrulama aynen duruyor.
 *
 * ## Sprint 2G-B — açılış cümlesi
 *
 * Sayfa artık bir etiketle ("Simülasyon sonucu") değil, bir sonuçla açılıyor.
 * Cümle `SimulationRunResponse.headline` alanından gelir — motorun kendi
 * yazdığı ve bugüne kadar hiç çizilmemiş cümle. Yoksa sayfanın zaten
 * kullandığı kısıt cümlesine düşülür. Yeni cümle üretilmez.
 */

import { useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { SimulationConfig, SimulationRunResponse } from "../../types/simulationTypes";
import { formatDecimal, formatUnits } from "../../lib/resultsFormatting";
import { summarizeFactory } from "../../lib/factoryOverview";
/*
 * Köken ve tazelik Sprint 2F-A'da kurulmuş altyapıdan gelir. İkinci bir zaman
 * kaynağı ya da ikinci bir göreli-zaman uygulaması yazılmaz: tek yetkili damga
 * `RunHistoryEntry.ranAt` ve onu okuyan işlevler bunlardır.
 */
import {
  freshnessLine,
  railStations,
  runFreshness,
  runProvenance,
} from "../../lib/commandCenter";
import { OriginBadge } from "../ui/OriginBadge";
import { Statement } from "../ui/Statement";
import { ConstraintRail } from "../ui/ConstraintRail";
import { MetricGroup } from "../ui/MetricGroup";
import { resultsStatement } from "../../lib/results/statement";
import { resultsMetrics } from "../../lib/results/metrics";
import { ArrowLeftIcon, ArrowRightIcon } from "../shared/icons";
import { FactoryAnimation } from "./FactoryAnimation";
import { FactoryOverview } from "./FactoryOverview";
import { FinancialImpactPanel } from "./FinancialImpactPanel";
import { FlowSankey } from "./FlowSankey";
import { StationMetricsTable } from "./StationMetricsTable";
import { ValidationPanel } from "./ValidationPanel";
import { UtilizationBarChart } from "./charts/UtilizationBarChart";

interface ResultsPageProps {
  result: SimulationRunResponse;
  config: SimulationConfig;
  onBackToEditor: () => void;
  onStartOver: () => void;
  /** Bu senaryoyu karşılaştırma referansı yapıp editöre döner. */
  onCompareFromHere: () => void;
  /** Referans senaryo varsa karşılaştırma görünümünü açar. */
  onOpenComparison?: () => void;
  /** Bu koşumun yorumlandığı Factory Intelligence ekranını açar. */
  onOpenIntelligence: () => void;
  /** Karşılaştırma için saklanmış referans senaryonun etiketi. */
  baselineLabel?: string | null;
  /**
   * Bu koşumun alındığı an (ISO 8601) — `RunHistoryEntry.ranAt`.
   *
   * Command Center ile **aynı** yoldan gelir (`runRanAt`). Eşleşen bir kayıt
   * yoksa `null` olur ve ekranda tazelik hiç gösterilmez; uydurulmuş bir saat,
   * eski sonucu taze göstermekten kötüdür.
   */
  ranAt?: string | null;
}

export function ResultsPage({
  result,
  config,
  onBackToEditor,
  onStartOver,
  onCompareFromHere,
  onOpenComparison,
  onOpenIntelligence,
  baselineLabel,
  ranAt = null,
}: ResultsPageProps) {
  const { results } = result;
  /* Köken burada uydurulmaz: koşum varsa "Benzetim"dir. Aynı işlev Command
     Center'da da bu kararı veriyor, iki ekran ayrışamaz. */
  const provenance = runProvenance(results, ranAt);
  const freshness = freshnessLine(runFreshness(provenance.ranAt));
  const bottleneck = results.station_metrics.find((station) => station.is_bottleneck);
  /* Açılış cümlesi seçilir, üretilmez: önce motorun kendi cümlesi, o yoksa
     sayfanın zaten kullandığı kısıt cümlesi (bkz. lib/results/statement). */
  const statement = resultsStatement(result.headline, bottleneck?.station_name);
  /* Şerit ve ölçümler Command Center'ın **aynı** bileşenleriyle çizilir
     (`components/ui/`). `railStations` da orada zaten var: istasyon
     genişliği ölçülmüş doluluktan gelir, kısıt `bottleneck_station_id`
     üzerinden işaretlenir. Yeni kısıt hesabı ya da yeni pay metriği yok. */
  const stations = railStations(results);
  const metrics = resultsMetrics(results);

  const summary = useMemo(
    () =>
      summarizeFactory(
        results.station_metrics,
        config,
        results.bottleneck_station_id,
      ),
    [results.station_metrics, config, results.bottleneck_station_id],
  );

  /** Hat kartıyla seçilen hat; `null` ise tüm istasyonlar gösterilir. */
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const stationsRef = useRef<HTMLElement | null>(null);

  /**
   * Kart tıklanınca tabloyu filtreler ve oraya kaydırır.
   *
   * Kaydırma olmadan, 20 istasyonluk bir sayfada kullanıcı kartlara tıklar ama
   * hiçbir şey değişmiş gibi görünür: değişen tablo ekranın çok altındadır.
   */
  const handleSelectLine = (lineName: string | null) => {
    setSelectedLine(lineName);
    if (lineName) {
      stationsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        {/*
          Sayfanın en büyük yazısı artık bir etiket değil, bir sonuç.

          Eskiden burada "Simülasyon sonucu" yazıyordu — TopBar'ın zaten
          gösterdiği sayfa adının kopyası, sıfır bilgi taşıyan bir başlık
          (ANTI-PATTERNS #21). Yerine motorun kendi cümlesi geçti; o da yoksa
          sayfanın zaten yazdığı kısıt cümlesi. `Statement` Command Center'da
          kurulmuş bileşendir, ikinci bir kopya yazılmadı: kutu, gradient,
          dekoratif ikon içermez.

          Köken rozeti (Sprint 2G-A) cümlenin üstünde, `meta` yuvasında durur —
          kullanıcı sayıları okumadan önce neye baktığını bilmelidir. Tazelik
          mantığı değişmedi.
        */}
        <Statement
          className="min-w-0 flex-1"
          headline={statement?.headline ?? "Simülasyon sonucu"}
          detail={`${config.stations.length} istasyon · ${results.num_replications} kez tekrarlandı · ${formatDecimal(result.duration_seconds, 1)} saniyede tamamlandı`}
          meta={<OriginBadge origin={provenance.origin} detail={freshness} />}
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Sonuç sayfası "ne oldu?" sorusunu yanıtlar; asıl merak edilen
              "şimdi ne yapmalıyım?" sorusudur. Bu yüzden Intelligence bağlantısı
              birincil eylem olarak, sayfanın en üstünde durur. */}
          <button
            type="button"
            onClick={onOpenIntelligence}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <Sparkles className="h-4 w-4" />
            Ne yapmalıyım?
          </button>
          <button
            type="button"
            onClick={onBackToEditor}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Modeli düzenle
          </button>
        </div>
      </header>

      {/*
        Kısıt şeridi: hangi istasyonun hattı sınırladığı, cümleden hemen sonra
        ve geometriyle. Command Center'daki bileşenin aynısı — iki ekranda iki
        farklı kısıt dili olsaydı tasarım sistemi ikiye bölünürdü.

        Darboğaz yoksa hiçbir segment kısıt işaretlenmez; bir istasyon o role
        zorlanmaz.
      */}
      <ConstraintRail stations={stations} className="mb-4" />

      {/*
        Ölçüm şeridi, eski dört yuvarlak karttın yerini alır. Aynı dört değer,
        aynı kaynaklardan; değişen yalnızca sunum ve iki değerin artık
        sonucunu taşıması (güven aralığı ve kısıt).
      */}
      <MetricGroup items={metrics} className="mb-4" />

      {/* Fabrika geneli özet: tablodan önce gelir çünkü kullanıcının ilk
          sorusu "nereye bakmalıyım?" sorusudur. */}
      <FactoryOverview
        summary={summary}
        selectedLine={selectedLine}
        onSelectLine={handleSelectLine}
      />

      {/* Tek cümlelik yorum: sayıları okumadan önce ne anlama geldiklerini
          söyler. Darboğaz bilgisi kullanıcının en çok işine yarayan tek şeydir. */}
      {bottleneck && (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm leading-relaxed text-slate-700">
          {/* Bu cümle başlığa yükseldiyse burada ikinci kez yazılmaz; geri
              kalan açıklama yerinde kalır. */}
          {statement?.source !== "bottleneck" && (
            <>
              Hattınızın çıktısını{" "}
              <strong className="font-semibold text-slate-900">
                {bottleneck.station_name}
              </strong>{" "}
              belirliyor.{" "}
            </>
          )}
          Bu istasyon zamanının %
          {Math.round(bottleneck.utilization * 100)}'ini işlem yaparak geçiriyor.
          Üretimi artırmak için önce buraya kapasite eklemelisiniz — diğer
          istasyonları hızlandırmak toplam çıktıyı değiştirmez.
        </p>
      )}

      {/* --- Bölüm B --- */}
      <section ref={stationsRef} className="mt-8 scroll-mt-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">İstasyonlar</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Her istasyonun ne kadar dolu olduğu ve nerede beklemeler oluştuğu.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Doluluk karşılaştırması
          </h3>
          <UtilizationBarChart stations={results.station_metrics} />
        </div>

        <StationMetricsTable
          stations={results.station_metrics}
          bottleneckStationId={results.bottleneck_station_id}
          summary={summary}
          selectedLine={selectedLine}
        />

        {/* Akis ve kayip analizi: tablo her istasyonun sayisini verir ama
            "giren isin ne kadari sona ulasiyor" sorusuna Sankey cevap verir. */}
        <FlowSankey stations={results.station_metrics} config={config} />

        {/* Finansal etki, akis analizinin hemen ardindan gelir: kullanici once
            isin nerede kayboldugunu gorur, sonra bunun ne kadara mal oldugunu.
            Varsayilan olarak kapali durur cunku maliyet oranlari girilmeden
            gosterilecek bir rakam yoktur. */}
        <FinancialImpactPanel result={result} config={config} />

        {/* Animasyon tablonun altinda ve varsayilan olarak kapali durur: izi
            uretmek sunucuda simulasyonu yeniden calistirmayi gerektirir ve
            sayfa yuklenirken bu maliyeti odemek gereksizdir. */}
        <FactoryAnimation
          simulationId={result.simulation_id}
          config={config}
          bottleneckStationId={results.bottleneck_station_id}
        />
      </section>

      {/* --- Bölüm C --- */}
      <section className="mt-8">
        <ValidationPanel
          simulationId={result.simulation_id}
          warnings={result.warnings}
        />
      </section>

      {/* --- Bölüm D'ye giriş --- */}
      <section className="mt-8 rounded-xl border border-brand-200 bg-brand-50 px-5 py-5">
        {baselineLabel && onOpenComparison ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand-950">
                Karşılaştırmaya hazır
              </p>
              <p className="mt-0.5 text-sm text-brand-900">
                “{baselineLabel}” senaryosu referans olarak saklandı. İki senaryoyu
                yan yana görebilirsiniz.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenComparison}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Senaryoları Karşılaştır
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand-950">
                Bir değişikliğin işe yarayıp yaramadığını ölçün
              </p>
              <p className="mt-0.5 max-w-xl text-sm text-brand-900">
                Bu senaryoyu referans olarak saklayın, modelde bir değişiklik yapıp
                tekrar çalıştırın. Aradaki farkın gerçek mi yoksa rastgelelik mi
                olduğunu size söyleyeceğiz.
              </p>
            </div>
            <button
              type="button"
              onClick={onCompareFromHere}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Bu Senaryoyu Kopyala ve Karşılaştır
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-slate-500">
        Beklenen üretim {formatUnits(results.total_throughput)} birim ·{" "}
        <button
          type="button"
          onClick={onStartOver}
          className="font-medium text-slate-500 underline-offset-4 transition-colors hover:text-brand-700 hover:underline"
        >
          Yeni bir model kur
        </button>
      </p>
    </div>
  );
}
