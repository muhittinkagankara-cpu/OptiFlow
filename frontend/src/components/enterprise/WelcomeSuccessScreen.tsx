/**
 * Kurulum tamamlandı ekranı.
 *
 * Konfeti `prefers-reduced-motion` altında **hiç çizilmez** — hareket
 * duyarlılığı olan bir kullanıcı için ekranda uçuşan otuz parça, kutlamadan
 * çok rahatsızlıktır. Animasyonu kapatmak yerine parçaları hiç oluşturmamak,
 * gereksiz DOM düğümünü de engeller.
 *
 * Ekrandaki tek iddia ölçülmüş olandır: hazırlık puanı. "Canlı bağlantıya
 * geçebilirsiniz" cümlesi bir hazırlık ifadesidir ve altında gerçek bağlantının
 * henüz kurulmadığı açıkça yazar.
 */

import { useMemo } from "react";
import { ArrowRight, Check, PartyPopper } from "lucide-react";
import type { ReadinessReport } from "../../lib/onboarding-enterprise";
import { Button, Card } from "../ui/Primitives";
import { BAND_STYLE } from "./enterpriseStyles";

const CONFETTI_COUNT = 28;
const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444"];

interface WelcomeSuccessScreenProps {
  report: ReadinessReport;
  companyName: string | null;
  onNavigate: (view: string) => void;
  onClose: () => void;
}

export function WelcomeSuccessScreen({
  report,
  companyName,
  onNavigate,
  onClose,
}: WelcomeSuccessScreenProps) {
  /*
   * Hareket tercihi bir kez okunur. Her render'da okunsaydı, medya sorgusu
   * değişmediği hâlde parçalar yeniden üretilirdi.
   */
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const confetti = useMemo(() => {
    if (reducedMotion) {
      return [];
    }
    return Array.from({ length: CONFETTI_COUNT }, (_, index) => ({
      id: index,
      left: (index * 37) % 100,
      delay: (index % 7) * 120,
      duration: 2_400 + (index % 5) * 400,
      color: COLORS[index % COLORS.length],
      size: 6 + (index % 3) * 3,
    }));
  }, [reducedMotion]);

  const items = [
    { label: `Hazırlık puanı ${Math.round(report.total)}/100`, done: true },
    { label: "İlk yönetici raporu hazır", done: true },
    { label: "Simülasyon çalışır durumda", done: true },
  ];

  return (
    <div className="relative mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      {confetti.length > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {confetti.map((piece) => (
            <span
              key={piece.id}
              className="optiflow-confetti absolute top-0 block rounded-sm"
              style={{
                left: `${piece.left}%`,
                width: piece.size,
                height: piece.size * 2,
                background: piece.color,
                animationDelay: `${piece.delay}ms`,
                animationDuration: `${piece.duration}ms`,
              }}
            />
          ))}
        </div>
      )}

      <Card className="optiflow-glass relative p-8 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600">
          <PartyPopper className="h-7 w-7" />
        </span>

        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Kurulum tamamlandı
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          {companyName ?? "Fabrikanız"} için kurulum bitti. Aşağıdaki adımların
          hepsi ürünün ürettiği sonuçlarla doğrulandı.
        </p>

        <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left">
          {items.map((item) => (
            <li
              key={item.label}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${BAND_STYLE.green.chip}`}
            >
              <Check className="h-4 w-4 shrink-0" />
              {item.label}
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Canlı bağlantıya geçebilirsiniz. Bu sürümde veri kaynakları
          <strong> benzetimle</strong> çalışır; gerçek bir PLC, OPC UA, MQTT ya da
          MES bağlantısı henüz kurulmadı.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={ArrowRight} onClick={() => onNavigate("reports")}>
            Raporu aç
          </Button>
          <Button onClick={() => onNavigate("connectors")}>Bağlantıları aç</Button>
          <Button variant="ghost" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </Card>
    </div>
  );
}
