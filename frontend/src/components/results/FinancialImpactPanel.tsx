/**
 * Finansal Etki paneli — kayıpların parasal karşılığı.
 *
 * Sonuç sayfasının "nerede tıkanıyorum?" sorusunu "bu bana ne kadara mal
 * oluyor?" sorusuna bağlar. Varsayılan olarak **kapalıdır** ve maliyet
 * oranları girilmeden hiçbir rakam göstermez: uydurulmuş oranlarla üretilen
 * bir kayıp rakamı, hiç rakam göstermemekten kötüdür — kullanıcı onu kendi
 * verisi sanır.
 *
 * Şeffaflık paneli taşıyan asıl fikirdir. Her kalem, tutarının nereden
 * geldiğini yanında taşır (Ölçüldü / Hesaplandı / Tahmin) ve eksik bir
 * maliyet oranı **sıfır olarak gösterilmez**; o kalem "hesaplanamadı" diye
 * işaretlenir. Aksi hâlde hiç oran girmemiş bir kullanıcı "toplam kaybınız
 * ₺0" yanıtını alır ve bunu iyi haber sanardı.
 */

import { useCallback, useState } from "react";
import type {
  FinancialReport,
  FinancialSettings,
  LossComponent,
  SimulationConfig,
  SimulationRunResponse,
} from "../../types/simulationTypes";
import { ApiError, getFinancialImpact } from "../../lib/apiClient";
import { FactoryHeatmap } from "../heatmap/FactoryHeatmap";
import { HeatLegend } from "../heatmap/HeatLegend";
import { TopLossStations } from "../heatmap/TopLossStations";
import { SelectedStationCard } from "../heatmap/SelectedStationCard";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import {
  confidenceLabel,
  formatMoney,
  provenanceHint,
  provenanceLabel,
  rateLabel,
  shareOfTotal,
} from "../../lib/financeFormatting";
import { Field, NumberField } from "../shared/FormControls";
import { Spinner } from "../wizard/WizardStep3_Confirmation";

/** Vardiya süresi hazır seçenekleri — envanter modülüyle aynı değerler. */
const SHIFT_PRESETS = [
  { label: "Tek vardiya (480 dk)", value: 480 },
  { label: "Çift vardiya (960 dk)", value: 960 },
  { label: "Kesintisiz (1440 dk)", value: 1440 },
];

interface FinancialImpactPanelProps {
  result: SimulationRunResponse;
  config: SimulationConfig;
  /**
   * Maliyet oranları ve rapor — **yukarıdan** gelir (Sprint 2H-A).
   *
   * Eskiden ikisi de bu bileşenin kendi `useState`'indeydi ve dışarı hiç
   * taşınmıyordu. Sonuç: aynı koşum için iki ayrı finans durumu oluşuyordu —
   * kullanıcı oranları bir kez Finans ekranında, bir kez de burada giriyordu
   * ve Sonuç ekranında hesaplanan rapor Command Center'a hiç ulaşmıyordu.
   *
   * `FinancePage` zaten bu kalıbı kullanıyor; panel de aynı kalıba geçti, tek
   * yetkili kaynak `App` oldu.
   */
  settings: FinancialSettings;
  onSettingsChange: (patch: Partial<FinancialSettings>) => void;
  report: FinancialReport | null;
  onReportChange: (report: FinancialReport | null) => void;
}

export function FinancialImpactPanel({
  result,
  config,
  settings,
  onSettingsChange,
  report,
  onReportChange,
}: FinancialImpactPanelProps) {
  /* Bunlar gerçekten bu panele ait geçici arayüz durumudur — paylaşılan veri
     değildir, bu yüzden yukarı taşınmaz. */
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const update = onSettingsChange;

  const calculate = useCallback(async () => {
    setIsLoading(true);
    setErrors([]);
    try {
      onReportChange(await getFinancialImpact(result.simulation_id, settings));
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsLoading(false);
    }
  }, [result.simulation_id, settings, onReportChange]);

  // En az bir oran girilmeden hesap anlamsizdir: tum kalemler
  // "hesaplanamadi" doner ve kullanici bos bir tablo gorur.
  const hasAnyRate = Object.entries(settings).some(
    ([key, value]) =>
      key !== "production_minutes_per_day" && typeof value === "number",
  );

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            Finansal Etki
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Kayıplarınızın parasal karşılığı. Maliyet oranlarınızı girin.
          </span>
        </span>
        <span className="text-sm text-slate-400">{isOpen ? "Gizle" : "Göster"}</span>
      </button>

      {isOpen && (
        <div className="border-t border-slate-200 px-5 py-5">
          <SettingsForm settings={settings} onChange={update} />

          {/* Tek ana eylem. Yükleme sırasında devre dışı kalır; ikinci bir
              birincil düğme yoktur (MASTER: bölge başına tek primary). */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void calculate()}
              disabled={isLoading || !hasAnyRate}
              title={hasAnyRate ? undefined : "En az bir maliyet oranı girin"}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
            >
              {isLoading && <Spinner />}
              Kaybı hesapla
            </button>
            {!hasAnyRate && (
              <span className="text-xs text-slate-500">
                Oranlar girilmeden rakam gösterilmez.
              </span>
            )}
          </div>

          {/* Hata kutu değil, kenar çizgisidir: kırmızı ölçülmüş bir durumu
              gösterir (Yasa 3), ama panelin içinde ikinci bir kart açmaz. */}
          {errors.length > 0 && (
            <ul className="mt-4 space-y-1 border-l-2 border-red-400 pl-3 text-sm text-red-700">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}

          {report && <ReportView report={report} config={config} />}
        </div>
      )}
    </section>
  );
}

/** Maliyet oranları formu. */
export function SettingsForm({
  settings,
  onChange,
}: {
  settings: FinancialSettings;
  onChange: (patch: Partial<FinancialSettings>) => void;
}) {
  return (
    /* Dokunma hedefi burada, yalnızca finans formunda yükseltilir. Paylaşılan
       `INPUT_CLASS` uygulamadaki her formu (sihirbaz, parametreler, envanter)
       aynı anda değiştirirdi; bu sprintin kapsamı o değil. Aynı sarmalayıcı
       girdilerin gölgesini de kaldırır — panelde ölçülen yedi gölgenin altısı
       bu alanlardan geliyordu. */
    <div className="[&_input]:min-h-[44px] [&_input]:shadow-none">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Birim katkı payı" hint="Satış fiyatı eksi değişken maliyet. Fırsat kaybı bununla hesaplanır — ciroyla değil.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.contribution_margin ?? Number.NaN}
              onChange={(value) => onChange({ contribution_margin: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Saatlik makine maliyeti" hint="Arıza süresinin maliyeti bununla hesaplanır.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.machine_cost_per_hour ?? Number.NaN}
              onChange={(value) => onChange({ machine_cost_per_hour: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Saatlik işçilik maliyeti" hint="Bloke (bekleme) süresinin maliyeti bununla hesaplanır.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.labor_cost_per_hour ?? Number.NaN}
              onChange={(value) => onChange({ labor_cost_per_hour: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Birim fire maliyeti" hint="Hurdaya ayrılan her parçanın maliyeti.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.scrap_cost_per_unit ?? Number.NaN}
              onChange={(value) => onChange({ scrap_cost_per_unit: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Satış fiyatı" hint="Kayıt için tutulur; kayıp hesabına girmez.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.selling_price ?? Number.NaN}
              onChange={(value) => onChange({ selling_price: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Saatlik fazla mesai maliyeti" hint="Kaybı telafi etmenin maliyetini kıyaslamak için; kayıp hesabına girmez.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.overtime_cost_per_hour ?? Number.NaN}
              onChange={(value) => onChange({ overtime_cost_per_hour: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
      </div>

      {/* Vardiya süresi artık ayrı bir kartın içinde değil, ince çizgiyle
          ayrılmış bir alan. Bilgi aynı; kaybolan yalnızca kutu. */}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-700">
          Günde kaç dakika üretim yapıyorsunuz?
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Günlük kayıp projeksiyonu için gerekli. Girilmezse günlük rakam
          gösterilmez — uydurulmuş bir vardiya süresiyle hesaplanan rakam
          yanıltıcı olurdu.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SHIFT_PRESETS.map((preset) => {
            const isActive = settings.production_minutes_per_day === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() =>
                  onChange({
                    production_minutes_per_day: isActive ? null : preset.value,
                  })
                }
                aria-pressed={isActive}
                /* Seçili durum renkle birlikte `aria-pressed` ile de taşınır;
                   renk tek başına durum anlatmaz. */
                className={`inline-flex min-h-[44px] items-center rounded-lg border px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  isActive
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-700 hover:border-brand-300"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Hesaplanmış raporun görünümü. */
export function ReportView({
  report,
  config,
}: {
  report: FinancialReport;
  config: SimulationConfig;
}) {
  const { impact } = report;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedHeat =
    report.heat.find((item) => item.station_id === focusedId) ?? null;

  return (
    <div className="mt-6 space-y-6">
      {/* --- Isı haritası: "param nerede yanıyor?" tek ekranda --- */}
      {report.heat.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Isı haritası</h4>
          <p className="mt-0.5 mb-3 text-xs text-slate-500">
            Bir kutuya tıklayın; sağda o istasyonun dökümü açılır.
          </p>
          <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
            <FactoryHeatmap
              config={config}
              heat={report.heat}
              focusedId={focusedId}
              onFocus={setFocusedId}
            />
            <div className="space-y-3">
              {/* Seçim varsa ayrıntı kartı en üstte durur: kullanıcının az önce
                  tıkladığı şeyin karşılığı, göz hareketine en yakın yerdedir. */}
              {focusedHeat && (
                <SelectedStationCard
                  heat={focusedHeat}
                  onClear={() => setFocusedId(null)}
                />
              )}
              <HeatLegend isRelative={report.heat.some((item) => item.is_relative)} />
              <TopLossStations
                stations={report.top_loss_stations}
                focusedId={focusedId}
                onFocus={setFocusedId}
              />
            </div>
          </div>
        </div>
      )}
      {/*
        Özet satırları (Sprint 2H-C).

        Burada eskiden üç büyük `HeadlineCard` vardı: yuvarlak kenarlıklı üç
        kutu, 24 piksellik rakamlarla, bir ızgarada. Sonuç ekranının karar
        yüzeyi (2H-B) aynı parayı zaten cümleyle söylüyor; panelin görevi
        kararı tekrar etmek değil, dökümü vermek. Bu yüzden üç değer kutudan
        çıkarıldı, punto küçültüldü ve kutular ince çizgiye dönüştü — değerler,
        etiketler ve güven bilgisi aynen korundu.
      */}
      <dl className="divide-y divide-slate-200 border-y border-slate-200 sm:flex sm:divide-x sm:divide-y-0">
        <SummaryItem
          label="Bugünkü tahmini kayıp"
          value={
            report.daily_loss === null || report.daily_loss === undefined
              ? null
              : formatMoney(report.daily_loss)
          }
          fallback="Günlük üretim süresi girilmedi"
          hint={`${report.window_minutes.toLocaleString("tr-TR")} dakikalık pencereden ölçeklendi.`}
        />
        <SummaryItem
          label="Kurtarılabilir kayıp"
          value={formatMoney(report.recoverable_loss)}
          hint="Bilinen bir eylemin doğrudan hedefleyebileceği tutar. Fire buna dâhil değildir."
        />
        <SummaryItem
          label="Pencere toplamı"
          value={formatMoney(impact.total_loss)}
          hint={`Simülasyon penceresindeki toplam kayıp. Güven: ${confidenceLabel(impact.confidence)}.`}
        />
      </dl>

      {/* --- Eksik oran uyarısı --- */}
      {impact.missing_inputs.length > 0 && (
        <div className="border-l-2 border-amber-400 pl-3 text-sm text-amber-700">
          <p className="font-medium">
            Bazı kalemler hesaplanamadı; toplam gerçek kaybın altındadır.
          </p>
          <p className="mt-1">
            Eksik oranlar: {impact.missing_inputs.map(rateLabel).join(", ")}.
          </p>
        </div>
      )}

      {/* --- Kalem dökümü --- */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Kayıp kalemleri</h4>

        {/* 768 altında tablo kayıt listesine döner. Yatay kaydırma kutusu bir
            çözüm değil, sorunun saklanmasıdır (UI kuralı); aynı dönüşüm Sonuç
            ekranındaki istasyon tablosunda da uygulanmıştı. */}
        <ul className="divide-y divide-slate-200 border-y border-slate-200 md:hidden">
          {impact.components.map((component) => (
            <ComponentRecord
              key={component.name}
              component={component}
              total={impact.total_loss}
            />
          ))}
        </ul>

        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <Th>Kalem</Th>
              <Th>Tutar</Th>
              <Th>Pay</Th>
              <Th>Kaynak</Th>
              <Th>Dayanak</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {impact.components.map((component) => (
              <ComponentRow
                key={component.name}
                component={component}
                total={impact.total_loss}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* --- Notlar --- */}
      {impact.notes.length > 0 && (
        <ul className="space-y-1.5 text-xs text-slate-500">
          {impact.notes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      )}

      {/* --- İstasyon bazlı --- */}
      {report.stations.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-900">
            İstasyon bazlı kayıplar
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <Th>İstasyon</Th>
                  <Th>Arıza</Th>
                  <Th>Bekleme</Th>
                  <Th>Fire</Th>
                  <Th>Fırsat</Th>
                  <Th>Toplam</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.stations.map((station) => (
                  <tr key={station.station_id}>
                    <Td>
                      <span className="font-medium text-slate-900">
                        {station.station_name}
                      </span>
                      {station.is_bottleneck && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          darboğaz
                        </span>
                      )}
                    </Td>
                    <Td numeric>{formatMoney(station.downtime_loss)}</Td>
                    <Td numeric>{formatMoney(station.waiting_loss)}</Td>
                    <Td numeric>{formatMoney(station.scrap_loss)}</Td>
                    <Td numeric>{formatMoney(station.opportunity_loss)}</Td>
                    <Td numeric>
                      <span className="font-semibold text-slate-900">
                        {formatMoney(station.total_loss)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- En yüksek ROI önerisi --- */}
      {report.suggestions.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-900">
            En yüksek getirili iyileştirme
          </h4>
          {/*
            `suggestion.action` bir **metindir**, uygulanabilir bir işlem
            değil: backend'de `ACTION_BY_COMPONENT` sözlüğünden gelen sabit bir
            tavsiye cümlesidir ("Önleyici bakım önceliğini bu istasyona
            verin..."). Arkasında ne bir uç nokta, ne bir hedef ekran, ne de
            bir parametre var. Bu yüzden düğme ya da bağlantı yapılmadı —
            tıklanabilir görünen ama hiçbir şey yapmayan bir kontrol, olmayan
            bir yetenek vaat etmek olurdu.
          */}
          <ul className="divide-y divide-slate-200 border-y border-slate-200">
            {report.suggestions.map((suggestion) => (
              <li key={suggestion.station_id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">
                    {suggestion.station_name}
                  </span>
                  <span className="text-sm font-medium text-slate-900 tabular-nums">
                    {formatMoney(suggestion.recoverable_amount)} hedefleniyor
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{suggestion.rationale}</p>
                <p className="mt-2 text-sm text-slate-700">{suggestion.action}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Özet satırı: etiket, değer, açıklama. Kutu yok.
 *
 * Ölçülemeyen değer sıfıra düşmez; yerine **nedeni** yazılır — "Günlük üretim
 * süresi girilmedi" bir tireden daha faydalıdır çünkü eksiği kapatmanın yolunu
 * söyler (Yasa 4).
 */
function SummaryItem({
  label,
  value,
  hint,
  fallback,
}: {
  label: string;
  value: string | null;
  hint: string;
  fallback?: string;
}) {
  return (
    <div className="py-3 sm:flex-1 sm:px-4 sm:first:pl-0 sm:last:pr-0">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </dt>
      {value === null ? (
        <dd className="mt-1 text-sm text-slate-400">{fallback}</dd>
      ) : (
        <dd className="mt-1 text-base font-semibold text-slate-900 tabular-nums">
          {value}
        </dd>
      )}
      <dd className="mt-1 text-xs text-slate-500">{hint}</dd>
    </div>
  );
}

/**
 * Kalem satırı (768px ve üstü).
 *
 * `is_available === false` olan kalem **asla ₺0 yazmaz**; tutarı 0 gelse bile
 * "hesaplanamadı" der ve payı tire olur. Bu, panelin en kritik davranışıdır:
 * hiç oran girmemiş bir kullanıcıya "kaybınız yok" demek, ürünün
 * yapabileceği en pahalı hatadır.
 */
function ComponentRow({
  component,
  total,
}: {
  component: LossComponent;
  total: number;
}) {
  const share = shareOfTotal(component.amount, total);

  return (
    <tr>
      <Td>
        <span className="font-medium text-slate-900">{component.label}</span>
      </Td>
      <Td numeric>
        {component.is_available ? (
          formatMoney(component.amount)
        ) : (
          <span className="text-xs text-slate-400">hesaplanamadı</span>
        )}
      </Td>
      <Td numeric>
        {component.is_available ? (
          <span className="text-slate-600">%{share.toFixed(0)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </Td>
      <Td>
        {/* Kaynak artık renkli bir hap değil, düz yazı. Anlam (Ölçüldü /
            Hesaplandı / Tahmin) ve açıklaması aynen duruyor; kaybolan yalnızca
            dört satırda dört renkli yuvarlak yüzey. */}
        <span
          title={provenanceHint(component.provenance)}
          className="text-xs text-slate-500"
        >
          {provenanceLabel(component.provenance)}
        </span>
      </Td>
      <Td>
        <span className="text-xs text-slate-500">{component.basis}</span>
      </Td>
    </tr>
  );
}

/** Aynı kalem, 768px altında kayıt olarak. */
function ComponentRecord({
  component,
  total,
}: {
  component: LossComponent;
  total: number;
}) {
  const share = shareOfTotal(component.amount, total);

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-900">
          {component.label}
        </span>
        <span className="text-sm text-slate-900 tabular-nums">
          {component.is_available ? (
            formatMoney(component.amount)
          ) : (
            <span className="text-xs text-slate-400">hesaplanamadı</span>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {component.is_available ? `Pay %${share.toFixed(0)} · ` : "Pay — · "}
        <span title={provenanceHint(component.provenance)}>
          {provenanceLabel(component.provenance)}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{component.basis}</p>
    </li>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
      {children}
    </th>
  );
}

function Td({
  children,
  numeric = false,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <td className={`px-3 py-2.5 align-middle ${numeric ? "tabular-nums" : ""}`}>
      {children}
    </td>
  );
}
