/**
 * Tek bir sohbet baloncuğu.
 *
 * Yanıt baloncuğu üç şeyi birlikte taşır: cümle, **güven etiketi** ve "neden
 * bunu öneriyorum" maddeleri. Üçü ayrılamaz — etiketsiz bir cümle kesin bilgi
 * sanılır, gerekçesiz bir öneri doğrulanamaz.
 *
 * Gerekçeler varsayılan olarak kapalıdır ama bir tık uzaktadır: her yanıtın
 * altına dört madde açmak, sohbeti okunmaz hâle getirirdi.
 */

import { useState } from "react";
import { Bot, ChevronDown, ExternalLink, Info, User } from "lucide-react";
import {
  CONFIDENCE_LABEL,
  SOURCE_LABEL,
  type CopilotMessage,
} from "../../lib/copilot";
import { CONFIDENCE_CHIP, SOURCE_CHIP, messageTime } from "./copilotStyles";

interface MessageBubbleProps {
  message: CopilotMessage;
  /** Eylem kartına basıldığında ilgili ekrana götürür. */
  onNavigate: (view: string) => void;
}

export function MessageBubble({ message, onNavigate }: MessageBubbleProps) {
  const [showReasons, setShowReasons] = useState(false);
  const isUser = message.role === "user";

  return (
    <div
      className={`optiflow-enter flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
          isUser
            ? "border-slate-200 bg-slate-100 text-slate-500"
            : "border-brand-400/40 bg-brand-600/15 text-brand-700"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>

      <div className={`min-w-0 max-w-[85%] ${isUser ? "text-right" : ""}`}>
        <div
          className={`optiflow-glass inline-block rounded-2xl border px-3.5 py-2.5 text-left ${
            isUser
              ? "border-slate-200 bg-slate-100"
              : "border-brand-400/30 bg-brand-600/10"
          }`}
        >
          <p className="whitespace-pre-wrap text-sm text-slate-900">
            {message.text}
          </p>
        </div>

        <div
          className={`mt-1 flex flex-wrap items-center gap-1.5 ${
            isUser ? "justify-end" : ""
          }`}
        >
          <span className="text-[11px] text-slate-500">
            {messageTime(message.atMs)}
          </span>

          {message.confidence !== null && (
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${CONFIDENCE_CHIP[message.confidence]}`}
            >
              {CONFIDENCE_LABEL[message.confidence]}
            </span>
          )}

          {message.sources.map((source) => (
            <span
              key={source}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_CHIP[source]}`}
            >
              {SOURCE_LABEL[source]}
            </span>
          ))}
        </div>

        {message.reasons.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowReasons((current) => !current)}
              aria-expanded={showReasons}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 transition-colors duration-200 hover:text-slate-900"
            >
              <Info className="h-3 w-3" />
              Neden bunu öneriyorum?
              <ChevronDown
                className={`h-3 w-3 transition-transform duration-200 motion-reduce:transition-none ${
                  showReasons ? "rotate-180" : ""
                }`}
              />
            </button>

            {showReasons && (
              <ul className="mt-1.5 space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-left">
                {message.reasons.map((reason) => (
                  <li key={reason} className="text-[11px] text-slate-600">
                    • {reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {message.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onNavigate(action.view)}
                title={action.reason}
                className="optiflow-lift inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors duration-200 hover:border-brand-400 hover:text-brand-700"
              >
                <ExternalLink className="h-3 w-3" />
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Yazıyor göstergesi.
 *
 * Yerel motor milisaniyelerde yanıt verir; gösterge yine de vardır çünkü
 * kullanıcı gönder'e bastığında bir şeyin olduğunu görmelidir. Sahte bir
 * gecikme eklenmez — gösterge yalnızca gerçek işlem süresince görünür.
 */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-400/40 bg-brand-600/15 text-brand-700">
        <Bot className="h-4 w-4" />
      </span>
      <span className="optiflow-glass inline-flex items-center gap-1 rounded-2xl border border-brand-400/30 bg-brand-600/10 px-3.5 py-3">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 motion-reduce:animate-none"
            style={{ animationDelay: `${index * 120}ms` }}
          />
        ))}
      </span>
    </div>
  );
}
