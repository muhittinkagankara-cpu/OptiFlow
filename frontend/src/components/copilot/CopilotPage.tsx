/**
 * AI Copilot — bu sprintte yer tutucu.
 *
 * Ekran gerçek bir dil modeline **bağlı değildir** ve hiçbir uca istek atmaz.
 * Bu, arayüzde açıkça yazılır: sohbet kutusu devre dışıdır ve üstte bir uyarı
 * şeridi durur. Çalışıyormuş gibi görünüp boş yanıt veren bir sohbet penceresi,
 * kullanıcının ürünün bozuk olduğunu düşünmesine yol açardı — yer tutucu
 * olduğunu söylemek, sessizce çalışmamaktan iyidir.
 *
 * Hazır öneriler gerçek verilerden türetilir (darboğaz adı, kayıp kalemi):
 * böylece ekran bir kabuk gösterisi değil, bağlandığında ne soracağını bilen
 * bir arayüz taslağı olur.
 */

import { Bot, Send, Sparkles, User } from "lucide-react";
import type {
  FinancialReport,
  SimulationResults,
} from "../../types/simulationTypes";
import { bottleneckSummary } from "../../lib/dashboardMetrics";
import { Badge, Card } from "../ui/Primitives";

interface CopilotPageProps {
  results: SimulationResults | null;
  report: FinancialReport | null;
}

export function CopilotPage({ results, report }: CopilotPageProps) {
  const bottleneck = bottleneckSummary(results);
  const suggestions = buildSuggestions(bottleneck?.name ?? null, report);

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            AI Copilot
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Fabrikanız hakkında soru sorun, senaryo önerileri alın.
          </p>
        </div>
        <Badge tone="warning">Yer tutucu · model bağlı değil</Badge>
      </div>

      {/* Karşılama */}
      <Card className="p-6 text-center" index={0}>
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/15 text-brand-700">
          <Sparkles className="h-6 w-6" />
        </span>
        <p className="text-base font-semibold text-slate-900">
          Copilot henüz bağlanmadı
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Bu ekran arayüz taslağıdır. Bağlandığında aşağıdaki sorular, o anki
          koşum verinizle birlikte modele gönderilecek.
        </p>
      </Card>

      {/* Hazır öneriler */}
      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Hazır öneriler
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {suggestions.map((text, position) => (
            <button
              key={text}
              type="button"
              disabled
              title="Copilot bu sürümde bağlı değil"
              className="optiflow-enter cursor-not-allowed rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 opacity-70"
              style={{ animationDelay: `${position * 45}ms` }}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {/* Örnek konuşma — arayüzün nasıl görüneceğini gösterir. */}
      <div className="mt-5 flex-1 space-y-3 overflow-y-auto">
        <Bubble role="user">
          {bottleneck
            ? `${bottleneck.name} istasyonuna bir makine eklesem çıktı ne olur?`
            : "Hattımdaki en büyük kısıt ne?"}
        </Bubble>
        <Bubble role="assistant">
          Bu bir örnek yanıttır. Copilot bağlandığında burada senaryo
          karşılaştırması, tahmini çıktı değişimi ve geri ödeme süresi yer
          alacak.
        </Bubble>
      </div>

      {/* Sohbet kutusu — bilinçli olarak devre dışı. */}
      <form
        className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2"
        onSubmit={(event) => event.preventDefault()}
      >
        <input
          type="text"
          disabled
          placeholder="Copilot bu sürümde bağlı değil"
          aria-label="Copilot'a mesaj"
          className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled
          aria-label="Gönder"
          className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg bg-slate-200 text-slate-400"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          isUser
            ? "bg-slate-100 text-slate-500"
            : "bg-brand-600/15 text-brand-700"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </span>
      <div
        className={`max-w-lg rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-brand-600 text-white"
            : "border border-slate-200 bg-white text-slate-700"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** Öneriler eldeki gerçek verilerden kurulur; hepsi statik değildir. */
function buildSuggestions(
  bottleneckName: string | null,
  report: FinancialReport | null,
): string[] {
  const topStation = report?.stations.find((item) => item.total_loss > 0);

  return [
    bottleneckName
      ? `${bottleneckName} istasyonundaki darboğazı nasıl açarım?`
      : "Hattımdaki kısıt nerede?",
    topStation
      ? `${topStation.station_name} istasyonundaki kaybı azaltmanın en ucuz yolu ne?`
      : "Maliyet oranlarımı girersem ne öğrenirim?",
    "Bir vardiya daha eklesem geri ödeme süresi ne olur?",
    "Tampon kapasitesini artırmak çıktıyı nasıl etkiler?",
  ];
}
