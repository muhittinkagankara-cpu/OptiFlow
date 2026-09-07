/**
 * Ekran 5 — Hurda girişi.
 *
 * Dört neden büyük kutular hâlinde durur; adet artı/eksi düğmeleriyle
 * değiştirilir. Serbest sayı klavyesi yerine düğme kullanılması bilinçlidir:
 * eldivenli parmakla sayı yazmak zordur ve hurda adetleri küçük sayılardır.
 * Yine de elle giriş alanı vardır, çünkü bir seferde 40 parça hurdaya
 * ayrılabilir.
 *
 * Fotoğraf ekleme bu sürümde **yer tutucudur**: dosya seçilmez, saklanmaz;
 * yalnızca kaç fotoğraf ekleneceği sayılır ve ekranda bunun henüz
 * kaydedilmediği yazar. Sahte bir görsel üretip saklamak, sonradan gerçek
 * dosyalarla değiştirilmesi gereken bir veri yükü bırakırdı.
 */

import { useState } from "react";
import { Camera, Check, Minus, Plus } from "lucide-react";
import {
  SCRAP_REASON_LABEL,
  haptic,
  type OperatorTask,
  type ScrapReason,
} from "../../lib/operator";
import { ScreenHeader, TouchButton } from "./operatorUi";

const REASONS: ScrapReason[] = ["burr", "scratch", "dimension", "other"];

export function ScrapEntryScreen({
  task,
  onBack,
  onSubmit,
}: {
  task: OperatorTask;
  onBack: () => void;
  onSubmit: (input: {
    reason: ScrapReason;
    quantity: number;
    photoCount: number;
    note: string | null;
  }) => void;
}) {
  const [reason, setReason] = useState<ScrapReason>("burr");
  const [quantity, setQuantity] = useState(1);
  const [photoCount, setPhotoCount] = useState(0);
  const [note, setNote] = useState("");

  const step = (delta: number) => {
    haptic("tap");
    setQuantity((current) => Math.max(1, current + delta));
  };

  return (
    <div className="optiflow-screen flex min-h-full flex-col">
      <ScreenHeader
        title="Hurda gir"
        subtitle={`${task.stationName} · ${task.workOrder}`}
        onBack={onBack}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {/* Neden */}
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Neden
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {REASONS.map((item) => {
              const isSelected = item === reason;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    haptic("tap");
                    setReason(item);
                  }}
                  aria-pressed={isSelected}
                  className={`flex min-h-[3.5rem] items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-semibold transition-all duration-200 active:scale-[0.98] focus:outline-none ${
                    isSelected
                      ? "border-brand-500 bg-brand-600/15 text-brand-700"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {/* Seçim rengin yanında bir onay işaretiyle de belirtilir. */}
                  {isSelected && <Check className="h-4 w-4 shrink-0" />}
                  {SCRAP_REASON_LABEL[item]}
                </button>
              );
            })}
          </div>
        </section>

        {/* Adet */}
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Adet
          </h2>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Bir azalt"
              disabled={quantity <= 1}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700 transition-transform active:scale-95 disabled:text-slate-400"
            >
              <Minus className="h-5 w-5" />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={quantity}
              onChange={(event) =>
                setQuantity(Math.max(1, Math.trunc(Number(event.target.value) || 1)))
              }
              aria-label="Hurda adedi"
              className="min-w-0 flex-1 bg-transparent text-center text-3xl font-bold text-slate-900 tabular-nums focus:outline-none"
            />
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Bir artır"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700 transition-transform active:scale-95"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </section>

        {/* Fotoğraf — yer tutucu */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Fotoğraf ekle</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {photoCount === 0
                  ? "Henüz fotoğraf eklenmedi."
                  : `${photoCount} fotoğraf işaretlendi.`}
              </p>
            </div>
            <TouchButton
              onClick={() => {
                haptic("tap");
                setPhotoCount((current) => current + 1);
              }}
              icon={Camera}
            >
              Ekle
            </TouchButton>
          </div>
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
            Bu sürümde fotoğraf saklanmıyor; yalnızca kaç tane eklendiği
            kaydediliyor.
          </p>
        </section>

        {/* Not */}
        <section>
          <label
            htmlFor="scrap-note"
            className="text-xs font-semibold tracking-wide text-slate-500 uppercase"
          >
            Not (isteğe bağlı)
          </label>
          <textarea
            id="scrap-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Örneğin: kalıp değişiminden sonra başladı"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
          />
        </section>
      </div>

      <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
        <TouchButton
          onClick={() =>
            onSubmit({
              reason,
              quantity,
              photoCount,
              note: note.trim() === "" ? null : note.trim(),
            })
          }
          icon={Check}
          tone="primary"
          full
        >
          {quantity} adet hurda kaydet
        </TouchButton>
      </div>
    </div>
  );
}
