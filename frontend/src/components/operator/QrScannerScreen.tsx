/**
 * Ekran 3 — QR tarayıcı.
 *
 * Kamera bu sürümde **kullanılmıyor**. Tasarım hazır: vizör çerçevesi, tarama
 * çizgisi ve sonuç akışı gerçek kameralı sürümdekiyle aynıdır; değişecek olan
 * tek şey kodun nereden geldiğidir. `getUserMedia` çağrısı eklendiğinde bu
 * ekranın yapısı değişmez, yalnızca `<div>` yerine `<video>` gelir ve okunan
 * metin aynı `taskFromCode` işlevine verilir.
 *
 * Kameranın kapalı olduğu ekranda açıkça yazılır. Boş bir siyah kutu gösterip
 * "tarayın" demek, operatörün telefonu iş emrine tutup hiçbir şey olmamasını
 * beklemesine yol açardı.
 */

import { useState } from "react";
import { CameraOff, QrCode, ScanLine, TriangleAlert } from "lucide-react";
import { haptic, sortTasks, taskFromCode, type OperatorTask } from "../../lib/operator";
import { TouchButton } from "./operatorUi";

export function QrScannerScreen({
  tasks,
  onOpenTask,
}: {
  tasks: OperatorTask[];
  onOpenTask: (taskId: string) => void;
}) {
  const [code, setCode] = useState("");
  const [notFound, setNotFound] = useState(false);

  const submit = (value: string) => {
    const match = taskFromCode(tasks, value);
    if (match) {
      haptic("success");
      setNotFound(false);
      onOpenTask(match.id);
      return;
    }
    haptic("reject");
    setNotFound(true);
  };

  /* Simülasyonda ilk sıradaki iş okunur: gerçek kamerada operatörün elindeki
     iş emri hangisiyse o okunacaktır. */
  const firstTask = sortTasks(tasks)[0] ?? null;

  return (
    <div className="optiflow-screen space-y-4 px-4 py-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">QR kod okut</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          İş emri etiketindeki kodu okutarak doğrudan göreve gidin.
        </p>
      </div>

      {/* Vizör */}
      <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <CameraOff className="h-8 w-8 text-slate-400" />
          <p className="text-xs font-medium text-slate-500">
            Kamera bu sürümde bağlı değil.
          </p>
        </div>

        {/* Köşe ayraçları ve tarama çizgisi — gerçek kameradaki yerleşimin
            aynısı, böylece kamera eklendiğinde düzen değişmez. */}
        <span className="pointer-events-none absolute top-6 left-6 h-8 w-8 rounded-tl-xl border-t-2 border-l-2 border-brand-500" />
        <span className="pointer-events-none absolute top-6 right-6 h-8 w-8 rounded-tr-xl border-t-2 border-r-2 border-brand-500" />
        <span className="pointer-events-none absolute bottom-6 left-6 h-8 w-8 rounded-bl-xl border-b-2 border-l-2 border-brand-500" />
        <span className="pointer-events-none absolute right-6 bottom-6 h-8 w-8 rounded-br-xl border-r-2 border-b-2 border-brand-500" />
        <span className="optiflow-scanline pointer-events-none absolute inset-x-6 top-6 h-0.5 rounded-full bg-brand-500/70" />
      </div>

      <TouchButton
        onClick={() => (firstTask ? submit(firstTask.workOrder) : submit(""))}
        icon={ScanLine}
        tone="primary"
        full
        disabled={!firstTask}
      >
        Taramayı simüle et
      </TouchButton>

      {/* Elle giriş: kamera olmadığında da akışın tamamı denenebilsin. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
        <label
          htmlFor="operator-code"
          className="text-xs font-medium text-slate-500"
        >
          Kodu elle girin
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="operator-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setNotFound(false);
            }}
            placeholder="İE-2401"
            className="min-h-[3rem] min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-100 px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
          />
          <TouchButton onClick={() => submit(code)} icon={QrCode} disabled={!code.trim()}>
            Bul
          </TouchButton>
        </div>
        {notFound && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Bu kod bugünkü görevlerinizde yok. İş emri numarasını ya da istasyon
            adını deneyin.
          </p>
        )}
      </div>
    </div>
  );
}
