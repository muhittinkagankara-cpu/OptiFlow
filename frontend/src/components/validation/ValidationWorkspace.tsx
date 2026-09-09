/**
 * Doğrulama çalışma alanı — üç panel.
 *
 * Sol panel modelin söylediğini, sağ panel sahanın söylediğini, ortadaki panel
 * ikisinin farkını gösterir. Karşılaştırma **canlıdır**: sağdaki bir kutuya
 * yazılan değer, ortadaki doğruluk oranını aynı anda değiştirir. "Hesapla"
 * düğmesi bilinçli olarak yoktur; kullanıcı bir sayıyı düzelttiğinde etkisini
 * görmeden önce bir düğmeye basmak zorunda kalırsa, denemekten vazgeçer.
 *
 * Bileşen hiçbir formül taşımaz. Doğruluk, güven, bulgular, rapor ve Excel
 * içeriği `lib/validation` içinde saf işlevlerle üretilir; burada yalnızca
 * durum tutulur ve indirme tetiklenir.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Save,
  Sparkles,
} from "lucide-react";
import type {
  SimulationConfig,
  SimulationRunResponse,
} from "../../types/simulationTypes";
import { downloadPdf, downloadWorkbook, readLogo } from "../../lib/reports";
import {
  METRIC_LABEL,
  accuracyHeadline,
  appendSnapshot,
  blankRealData,
  buildConfidence,
  buildFindings,
  buildValidation,
  buildValidationReport,
  buildValidationWorkbook,
  emptyFindingMessage,
  emptyMeasurement,
  forFactory,
  recallTimeline,
  rememberTimeline,
  sampleRealData,
  simulatedStations,
  snapshotFrom,
  validationWorkbookFileName,
  type RealDataSet,
  type ValidationSnapshot,
} from "../../lib/validation";
import { Button, Card, EmptyState } from "../ui/Primitives";
import { CauseAnalysis } from "./CauseAnalysis";
import { ComparisonTable } from "./ComparisonTable";
import { RealDataPanel } from "./RealDataPanel";
import { ValidationDashboard } from "./ValidationDashboard";
import { ValidationTimelinePanel } from "./ValidationTimelinePanel";
import { showNumber, showPercent } from "./validationStyles";

type Job = "pdf" | "excel" | null;

interface ValidationWorkspaceProps {
  config: SimulationConfig | null;
  result: SimulationRunResponse | null;
  factoryId: string | null;
  factoryName: string | null;
  orgName: string;
  onStartSimulation: () => void;
}

export function ValidationWorkspace({
  config,
  result,
  factoryId,
  factoryName,
  orgName,
  onStartSimulation,
}: ValidationWorkspaceProps) {
  const stations = useMemo(
    () => config?.stations.map((item) => ({ id: item.id, name: item.name })) ?? [],
    [config],
  );

  const [data, setData] = useState<RealDataSet>(() =>
    blankRealData(stations, new Date()),
  );
  const [history, setHistory] = useState<ValidationSnapshot[]>(() =>
    recallTimeline(),
  );
  const [busy, setBusy] = useState<Job>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /*
   * Model değiştiğinde form yeniden kurulur: başka bir fabrikanın istasyon
   * adlarıyla dolu bir formda girilen ölçümler, yanlış istasyona yazılırdı.
   *
   * Sıfırlama bir efektle değil, **render sırasında** yapılır. Efektle
   * yapılsaydı ekran bir kare boyunca eski istasyonların formunu çizer, hemen
   * ardından ikinci bir render'la onu atardı; React'in props değişiminde durum
   * ayarlama önerisi de budur.
   */
  const stationsKey = useMemo(
    () => stations.map((station) => station.id).join("|"),
    [stations],
  );
  const [formKey, setFormKey] = useState(stationsKey);
  if (formKey !== stationsKey) {
    setFormKey(stationsKey);
    setData(blankRealData(stations, new Date()));
    setSavedAt(null);
  }

  const summary = useMemo(
    () => buildValidation(config, result?.results ?? null, data),
    [config, result, data],
  );
  const confidence = useMemo(() => buildConfidence(summary), [summary]);
  const findings = useMemo(() => buildFindings(summary), [summary]);
  const headline = useMemo(() => accuracyHeadline(summary), [summary]);

  const factoryHistory = useMemo(
    () => forFactory(history, factoryId),
    [history, factoryId],
  );

  const modelStations = useMemo(
    () => simulatedStations(config, result?.results ?? null),
    [config, result],
  );

  /**
   * Örnek ölçümleri forma doldurur.
   *
   * Örnek veri kendi istasyon adlarını taşır; doğrudan yazılsaydı açık modelin
   * istasyonlarıyla eşleşmez ve hiçbir satır hesaba girmezdi. Bu yüzden değerler
   * **açık modelin** istasyonlarına sırayla yazılır: amaç ekranın ne yaptığını
   * göstermektir, bir ölçüm iddiasında bulunmak değil.
   */
  const fillWithSample = useCallback(() => {
    const sample = sampleRealData(new Date());
    setData({
      shiftMinutes: sample.shiftMinutes,
      measuredAt: sample.measuredAt,
      stations: stations.map((station, index) => {
        const source = sample.stations[index];
        return source === undefined
          ? emptyMeasurement(station.id, station.name)
          : { ...source, stationId: station.id, stationName: station.name };
      }),
    });
    setSavedAt(null);
  }, [stations]);

  const saveSnapshot = useCallback(() => {
    const measuredAt = new Date();
    const snapshot = snapshotFrom(summary, confidence, {
      id: `val-${measuredAt.getTime().toString(36)}`,
      factoryId,
      factoryName,
      measuredAt,
    });
    const next = appendSnapshot(history, snapshot);
    setHistory(next);
    rememberTimeline(next);
    setSavedAt(measuredAt.toISOString());
  }, [summary, confidence, factoryId, factoryName, history]);

  const download = useCallback(
    async (job: Exclude<Job, null>) => {
      setBusy(job);
      setFailure(null);
      try {
        const generatedAt = new Date();
        if (job === "pdf") {
          const input = {
            factoryName,
            orgName,
            generatedAt,
            summary,
            confidence,
            findings,
            history: factoryHistory,
          };
          // Dosya adı belgenin kendisinde taşınır (`fileName`); çizici onu
          // kullanır, burada ikinci kez üretilmez.
          await downloadPdf(buildValidationReport(input), readLogo());
        } else {
          const input = {
            factoryName,
            generatedAt,
            summary,
            confidence,
            findings,
            history: factoryHistory,
          };
          await downloadWorkbook(
            buildValidationWorkbook(input),
            validationWorkbookFileName(input),
          );
        }
      } catch (error) {
        // Sessiz başarısızlıkta kullanıcı düğmeye basıp hiçbir şey olmadığını
        // görür ve ürünün bozuk olduğunu düşünür.
        setFailure(
          error instanceof Error
            ? `Dosya üretilemedi: ${error.message}`
            : "Dosya üretilemedi.",
        );
      } finally {
        setBusy(null);
      }
    },
    [confidence, factoryHistory, factoryName, findings, orgName, summary],
  );

  if (config === null || result === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={FlaskConical}
          title="Karşılaştırılacak bir koşum yok"
          description="Doğrulama, simülasyon sonuçlarını sahadan ölçülen değerlerle karşılaştırır. Önce bir simülasyon çalıştırın, sonra bu ekranda gerçek üretim verinizi girin."
          action={
            <Button variant="primary" icon={FlaskConical} onClick={onStartSimulation}>
              Simülasyona git
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Gerçek Fabrika Doğrulaması
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Sahadan ölçtüğünüz değerleri girin; model ile farkı anında görün.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={Sparkles}
            onClick={fillWithSample}
            title="Örnek bir vardiyanın ölçümlerini forma doldurur"
          >
            Örnek veri
          </Button>
          <Button size="sm" icon={Save} onClick={saveSnapshot}>
            Ölçümü kaydet
          </Button>
          <Button
            size="sm"
            icon={FileText}
            busy={busy === "pdf"}
            onClick={() => void download("pdf")}
          >
            PDF
          </Button>
          <Button
            size="sm"
            icon={FileSpreadsheet}
            busy={busy === "excel"}
            onClick={() => void download("excel")}
          >
            Excel
          </Button>
        </div>
      </div>

      {failure !== null && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {failure}
        </p>
      )}
      {savedAt !== null && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <ClipboardCheck className="h-4 w-4" />
          Ölçüm kaydedildi; geçmiş ve trend güncellendi.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_380px]">
        {/* --- Sol: modelin söyledikleri --- */}
        <aside className="order-3 min-w-0 xl:order-none">
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Simülasyon sonuçları
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {result.simulation_id.slice(0, 8)} · {config.num_replications} tekrar
            </p>

            <ul className="mt-3 space-y-2.5">
              {modelStations.map((station) => (
                <li
                  key={station.stationId}
                  className="rounded-xl border border-slate-200 p-2.5"
                >
                  <p className="text-xs font-semibold text-slate-900">
                    {station.stationName}
                  </p>
                  <dl className="mt-1.5 space-y-1">
                    <Row
                      label={METRIC_LABEL.cycleTime}
                      value={`${showNumber(station.cycleTimeMinutes)} dk`}
                    />
                    <Row
                      label={METRIC_LABEL.throughput}
                      value={`${showNumber(station.throughputPerMinute, 3)} parça/dk`}
                    />
                    <Row
                      label={METRIC_LABEL.queue}
                      value={`${showNumber(station.waitMinutes)} dk`}
                    />
                    <Row
                      label={METRIC_LABEL.scrap}
                      value={showPercent(station.scrapRatio, 1)}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          </Card>
        </aside>

        {/*
          --- Orta: canlı karşılaştırma ---

          Dar ekranda bu sütun en üste alınır: üç sütun alt alta dizildiğinde
          kullanıcı önce modelin ham değerlerini görüp asıl sonucu aramak zorunda
          kalıyordu. Dar ekranda sıra karşılaştırma → veri girişi → model
          değerleri olur; kullanıcının **yapacağı iş** (ölçüm girmek) modelin ham
          listesinden önce gelir. Geniş ekranda sıra doğal hâline döner.
        */}
        <div className="order-first min-w-0 space-y-4 xl:order-none">
          <ValidationDashboard
            summary={summary}
            confidence={confidence}
            headline={headline}
          />
          <ComparisonTable stations={summary.stations} />
          <CauseAnalysis
            findings={findings}
            emptyMessage={emptyFindingMessage(summary)}
          />
        </div>

        {/* --- Sağ: sahanın söyledikleri --- */}
        <aside className="order-2 min-w-0 space-y-4 xl:order-none">
          <RealDataPanel
            data={data}
            stations={stations}
            onChange={(next) => {
              setData(next);
              setSavedAt(null);
            }}
            onReset={() => setData(blankRealData(stations, new Date()))}
          />
          <ValidationTimelinePanel history={factoryHistory} />
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-[11px] font-medium tabular-nums text-slate-700">
        {value}
      </dd>
    </div>
  );
}
