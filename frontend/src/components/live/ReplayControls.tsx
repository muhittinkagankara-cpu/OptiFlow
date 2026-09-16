/**
 * Kayıttan oynatma çubuğu.
 *
 * Bu bileşen `ReplayProvider` tipini **bilmez**; yalnızca `ReplayControls`
 * yeteneğini alır (`asReplayControls`). Yarın kaydı sunucudan çalan başka bir
 * sağlayıcı eklendiğinde aynı çubuk hiç değişmeden onunla da çalışır.
 *
 * İlerleme, sağlayıcının kendi bildirimiyle okunur; bileşen zamanlayıcı
 * kurmaz. Kendi sayacını tutsaydı, hız değişimlerinde ve atlamalarda
 * sağlayıcıyla arası açılırdı.
 */

import { memo, useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { REPLAY_SPEEDS, type ReplayControls as Controls } from "../../lib/live";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ReplayControlsInner({ controls }: { controls: Controls }) {
  /*
   * Sağlayıcı React'in dışında yaşıyor; ilerlemesini okumak için bir yeniden
   * render tetiklemek gerekir. Sayaç, `useSyncExternalStore` yerine basit bir
   * artırıcıyla yapılır: okunacak değer tek bir nesne değil, sağlayıcının
   * birkaç alanıdır.
   */
  const [, bump] = useState(0);
  useEffect(
    () => controls.onProgress(() => bump((count) => count + 1)),
    [controls],
  );

  const duration = controls.durationMs;
  const ratio = duration > 0 ? controls.positionMs / duration : 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Dokunma hedefi 44px, görünen kare 32px: düğmenin kendisi saydam ve
          büyük, renkli yüzey içteki kutuda. Böylece MASTER §14 kapanırken
          çubuğun görsel yoğunluğu değişmez. */}
      <button
        type="button"
        onClick={() => (controls.isPlaying ? controls.pause() : controls.play())}
        aria-label={controls.isPlaying ? "Duraklat" : "Oynat"}
        className="group flex h-11 w-11 shrink-0 items-center justify-center focus:outline-none"
      >
        {/* Vurgu tüm 44px alanda verilir, yalnızca görünen karede değil:
            tıklanabilir alanın neresi olduğu geri bildirimle örtüşmeli. */}
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors group-hover:bg-brand-700">
          {controls.isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(1, duration)}
        value={controls.positionMs}
        onChange={(event) => controls.seek(Number(event.target.value))}
        aria-label="Kayıt konumu"
        /* Yükseklik ve ray artık `optiflow-touch-range` içinde: öğe 44px,
           görünür ray 6px. Yerel sınıf; paylaşılan girdi stiline dokunulmadı. */
        className="optiflow-touch-range min-w-[7rem] flex-1 cursor-pointer appearance-none accent-brand-600"
      />

      <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">
        {formatElapsed(controls.positionMs)} / {formatElapsed(duration)}
        {/* Yüzde, kaydırıcının konumunu yazıyla da verir. */}
        {duration > 0 && ` · %${Math.round(ratio * 100)}`}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
        {REPLAY_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => controls.setSpeed(speed)}
            aria-pressed={controls.speed === speed}
            /* Sözde öğeyle büyütmek burada güvenli değildi: düğmeler arası
               boşluk 2px, 44px'e çıkmak için gereken taşma ise ±12px. Hedefler
               üst üste biner ve komşu düğmenin tıklamasını çalardı. Bu yüzden
               gerçek yükseklik büyütüldü; punto 10px kaldı. */
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-[10px] font-semibold transition-colors ${
              controls.speed === speed
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>
    </div>
  );
}

export const ReplayControls = memo(ReplayControlsInner);
