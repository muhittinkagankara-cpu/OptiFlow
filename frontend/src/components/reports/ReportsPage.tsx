/**
 * Raporlar — yönetici PDF'i, teknik PDF ve Excel dışa aktarımı.
 *
 * Bu ekran hiçbir hesap yapmaz. Ne yazılacağına `lib/reports` karar verir;
 * burada yalnızca "neyin dahil olduğu" gösterilir ve indirme tetiklenir.
 * Kapsam listesinin ekranda görünmesi bilinçlidir: bir yöneticiye rapor
 * göndermeden önce içinde ne olduğunu bilmek gerekir.
 *
 * Eksik veri gizlenmez, **sayılır**: finans raporu yoksa "parasal bölümler boş
 * gelecek" diye yazar. Kullanıcı raporu alıp toplantıda tire dolu bir sayfayla
 * karşılaşmaktansa, indirmeden önce eksiği görmelidir.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  FileBarChart,
  FileSpreadsheet,
  FileText,
  ImageUp,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type {
  FinancialReport,
  SimulationConfig,
  SimulationRunResponse,
} from "../../types/simulationTypes";
import {
  ACCEPTED_LOGO_TYPES,
  buildExecutiveReport,
  buildTechnicalReport,
  buildWorkbook,
  clearLogo,
  downloadPdf,
  downloadWorkbook,
  readLogo,
  saveLogo,
  validateLogo,
  workbookFileName,
  type ReportContext,
} from "../../lib/reports";
import { ValidationPanel } from "../results/ValidationPanel";
import { Badge, Button, Card, EmptyState } from "../ui/Primitives";

type Job = "executive" | "technical" | "excel" | null;

interface ReportsPageProps {
  result: SimulationRunResponse | null;
  config: SimulationConfig | null;
  report: FinancialReport | null;
  factoryName: string | null;
  orgName: string;
  onStartSimulation: () => void;
}

export function ReportsPage({
  result,
  config,
  report,
  factoryName,
  orgName,
  onStartSimulation,
}: ReportsPageProps) {
  const [logo, setLogo] = useState<string | null>(() => readLogo());
  const [logoError, setLogoError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Job>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /**
   * Rapor bağlamı her indirmede yeniden kurulur çünkü `generatedAt` o anın
   * saatidir. `useMemo` ile dondurulsaydı, sekmeyi sabah açıp akşam indiren
   * kullanıcı sabahki saati taşıyan bir rapor alırdı.
   */
  const buildContext = useCallback(
    (): ReportContext => ({
      factoryName,
      generatedAt: new Date(),
      config,
      result,
      report,
      orgName,
    }),
    [factoryName, config, result, report, orgName],
  );

  /** Kapsam listesi için örnek bir bağlam; sayılar değil, yapı okunur. */
  const preview = useMemo(
    () => ({
      sheets: buildWorkbook({
        factoryName,
        generatedAt: new Date(0),
        config,
        result,
        report,
        orgName,
      }),
    }),
    [factoryName, config, result, report, orgName],
  );

  const run = useCallback(
    async (job: Exclude<Job, null>) => {
      setBusy(job);
      setFailure(null);
      try {
        const context = buildContext();
        if (job === "excel") {
          await downloadWorkbook(buildWorkbook(context), workbookFileName(context));
        } else {
          const document =
            job === "executive"
              ? buildExecutiveReport(context)
              : buildTechnicalReport(context);
          await downloadPdf(document, logo);
        }
      } catch (error) {
        // Dosya üretimi sessizce başarısız olursa kullanıcı düğmeye basıp
        // hiçbir şey olmadığını görür ve ürünün bozuk olduğunu düşünür.
        setFailure(
          error instanceof Error
            ? `Rapor oluşturulamadı: ${error.message}`
            : "Rapor oluşturulamadı.",
        );
      } finally {
        setBusy(null);
      }
    },
    [buildContext, logo],
  );

  const onPickLogo = useCallback((file: File) => {
    const error = validateLogo({ type: file.type, size: file.size });
    if (error !== null) {
      setLogoError(error);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (dataUrl === null) {
        setLogoError("Dosya okunamadı.");
        return;
      }
      saveLogo(dataUrl);
      setLogo(dataUrl);
      setLogoError(null);
    };
    reader.onerror = () => setLogoError("Dosya okunamadı.");
    reader.readAsDataURL(file);
  }, []);

  const hasRun = result !== null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Raporlar
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Yönetici sunumu için PDF, analiz için Excel.
          </p>
        </div>
        {report === null && hasRun && (
          <Badge tone="warning">Finans oranları girilmedi</Badge>
        )}
      </div>

      {!hasRun ? (
        <EmptyState
          icon={FileBarChart}
          title="Raporlanacak bir koşum yok"
          description="Rapor, kaydedilmiş bir simülasyon koşumundan üretilir. Bir model çalıştırdığınızda yönetici ve teknik raporlar burada indirilebilir olur."
          action={
            <Button variant="primary" onClick={onStartSimulation}>
              Simülasyona git
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {failure !== null && (
            <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {failure}
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-3">
            <ReportCard
              icon={FileText}
              title="Yönetici PDF"
              description="Kapak, tek cümlelik durum, dört gösterge, öncelikli aksiyonlar ve finansal etki."
              contents={[
                "Kapak: fabrika adı, tarih, kapsam",
                "OEE · Throughput · Darboğaz · Aylık kayıp",
                "Öncelikli aksiyonlar tablosu",
                report === null
                  ? "Finansal etki — oranlar girilmediği için boş gelecek"
                  : "Finansal etki ve kurtarılabilir tutar",
              ]}
              busy={busy === "executive"}
              disabled={busy !== null}
              onDownload={() => void run("executive")}
            />

            <ReportCard
              icon={FileText}
              title="Teknik PDF"
              description="Süreç mühendisi için ayrıntı: istasyon tablosu, ısı haritası, grafikler ve doğrulama."
              contents={[
                "Hat göstergeleri ve doluluk grafiği",
                "İstasyon metrikleri (sayfaya sığacak biçimde bölünür)",
                report === null
                  ? "Isı haritası — finans raporu olmadan çizilmez"
                  : "Kayıp ısı haritası ve kalem dökümü",
                "Little Yasası doğrulaması ve koşum uyarıları",
              ]}
              busy={busy === "technical"}
              disabled={busy !== null}
              onDownload={() => void run("technical")}
            />

            <ReportCard
              icon={FileSpreadsheet}
              title="Excel"
              description="Beş sekme; sayılar metin değil sayı olarak yazılır, eksik veri boş hücre kalır."
              contents={preview.sheets.map(
                (sheet) =>
                  `${sheet.name} — ${
                    sheet.rows.length > 0
                      ? `${sheet.rows.length} satır`
                      : "veri yok, nedeni yazılı"
                  }`,
              )}
              busy={busy === "excel"}
              disabled={busy !== null}
              onDownload={() => void run("excel")}
            />
          </div>

          {/* --- Logo --- */}
          <Card className="p-5" index={0}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">
                  Rapor logosu
                </h3>
                <p className="mt-1 max-w-md text-sm text-slate-500">
                  PDF kapaklarının üst köşesinde görünür. PNG veya JPEG, en fazla
                  512 KB. Logo yalnızca bu tarayıcıda saklanır; sunucuya
                  gönderilmez.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {logo !== null && (
                  <img
                    src={logo}
                    alt="Yüklenen logo"
                    className="h-12 w-auto max-w-[9rem] rounded-lg border border-slate-200 bg-white object-contain p-1"
                  />
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPTED_LOGO_TYPES.join(",")}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onPickLogo(file);
                    }
                    // Aynı dosyanın ikinci kez seçilebilmesi için sıfırlanır.
                    event.target.value = "";
                  }}
                />
                <Button icon={ImageUp} onClick={() => fileInput.current?.click()}>
                  {logo === null ? "Logo yükle" : "Değiştir"}
                </Button>
                {logo !== null && (
                  <Button
                    icon={Trash2}
                    variant="ghost"
                    onClick={() => {
                      clearLogo();
                      setLogo(null);
                      setLogoError(null);
                    }}
                  >
                    Kaldır
                  </Button>
                )}
              </div>
            </div>

            {logoError !== null && (
              <p className="mt-3 flex items-start gap-2 text-sm text-amber-800">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {logoError}
              </p>
            )}
          </Card>

          <ValidationPanel
            simulationId={result.simulation_id}
            warnings={result.warnings}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ReportCard({
  icon: Icon,
  title,
  description,
  contents,
  busy,
  disabled,
  onDownload,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  contents: string[];
  busy: boolean;
  disabled: boolean;
  onDownload: () => void;
}) {
  return (
    <Card className="flex flex-col p-4" index={0}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600/15 text-brand-700">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-500">{description}</p>

      <ul className="mt-3 flex-1 space-y-1">
        {contents.map((line) => (
          <li
            key={line}
            className="flex gap-1.5 text-[11px] leading-relaxed text-slate-600"
          >
            <span className="text-slate-400">·</span>
            {line}
          </li>
        ))}
      </ul>

      <Button
        variant="primary"
        className="mt-4 w-full"
        busy={busy}
        disabled={disabled}
        onClick={onDownload}
      >
        {busy ? "Hazırlanıyor…" : "İndir"}
      </Button>
    </Card>
  );
}
