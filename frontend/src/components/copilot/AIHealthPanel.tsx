/**
 * AI sağlık paneli — sağlayıcı, gecikme, kota ve son analiz.
 *
 * Sayıların tamamı ölçülmüştür: gecikme sağlayıcının kendi ölçümü, kota
 * motorun sayacı, son analiz konuşmadaki son yanıtın zamanı. Süs olarak
 * konulmuş tek bir gösterge yoktur — çalışmadığı hâlde yeşil yanan bir panel,
 * panonun tamamını inanılmaz kılardı.
 */

import { Cpu, Gauge, MessageSquare, Timer } from "lucide-react";
import {
  CONFIDENCE_LABEL,
  type Conversation,
  type ProviderHealth,
  type QuotaSnapshot,
} from "../../lib/copilot";
import { Card } from "../ui/Primitives";
import { messageTime } from "./copilotStyles";

interface AIHealthPanelProps {
  providerName: string;
  health: ProviderHealth;
  quota: QuotaSnapshot;
  conversation: Conversation;
}

export function AIHealthPanel({
  providerName,
  health,
  quota,
  conversation,
}: AIHealthPanelProps) {
  const lastAnswer = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const cards = [
    {
      icon: Cpu,
      label: "Sağlayıcı",
      value: providerName,
      hint: health.detail,
      tone:
        health.status === "ready"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-slate-100 text-slate-600",
    },
    {
      icon: Timer,
      label: "Gecikme",
      value:
        health.latencyMs === null
          ? "—"
          : `${health.latencyMs.toString().replace(".", ",")} ms`,
      hint: health.latencyMs === null ? "Henüz ölçüm yok" : "Son yanıt süresi",
      tone: "border-slate-200 bg-slate-100 text-slate-600",
    },
    {
      icon: Gauge,
      label: "Kalan analiz",
      value:
        quota.limit === null
          ? "Sınırsız"
          : `${quota.remaining ?? 0}/${quota.limit}`,
      hint: quota.warning ?? "Dönem hakkınız yeterli",
      tone:
        quota.warning === null
          ? "border-slate-200 bg-slate-100 text-slate-600"
          : "border-amber-200 bg-amber-50 text-amber-800",
    },
    {
      icon: MessageSquare,
      label: "Son analiz",
      value: lastAnswer === undefined ? "—" : messageTime(lastAnswer.atMs),
      hint:
        lastAnswer?.confidence == null
          ? "Henüz analiz yapılmadı"
          : CONFIDENCE_LABEL[lastAnswer.confidence],
      tone: "border-slate-200 bg-slate-100 text-slate-600",
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card, index) => (
        <Card key={card.label} className="p-3" index={index}>
          <div className="flex items-center gap-1.5">
            <card.icon className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {card.label}
            </span>
          </div>
          <p className="mt-1.5 truncate text-sm font-semibold text-slate-900">
            {card.value}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500" title={card.hint}>
            {card.hint}
          </p>
        </Card>
      ))}
    </div>
  );
}
