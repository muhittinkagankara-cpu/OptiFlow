/**
 * Kurulum danışmanı paneli.
 *
 * Yanıtlar Copilot'un koruma katmanından geçen `answerSetupQuestion` ile
 * üretilir; bu bileşen tek bir cümle kurmaz. Aynı guardrail geçerlidir:
 * bağlamda karşılığı olmayan bir sayı geçen yanıt gösterilmez.
 */

import { useState } from "react";
import { Bot, Info } from "lucide-react";
import {
  CONFIDENCE_LABEL,
  type CopilotAnswer,
} from "../../lib/copilot";
import {
  SETUP_QUESTIONS,
  answerSetupQuestion,
  type AdvisorInput,
} from "../../lib/onboarding-enterprise";
import { Card } from "../ui/Primitives";

interface SetupAdvisorPanelProps {
  input: AdvisorInput;
  onNavigate: (view: string) => void;
}

export function SetupAdvisorPanel({ input, onNavigate }: SetupAdvisorPanelProps) {
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [showReasons, setShowReasons] = useState(false);

  return (
    <Card className="optiflow-glass p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <Bot className="h-4 w-4 text-brand-600" />
        Kurulum danışmanı
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Yanıtlar bu cihazda üretilir ve yalnızca ölçülmüş kurulum verisini kullanır.
      </p>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {SETUP_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => {
              setAsked(question);
              setShowReasons(false);
              setAnswer(answerSetupQuestion(question, input));
            }}
            className={`optiflow-lift rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors duration-200 ${
              asked === question
                ? "border-brand-400 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-700 hover:border-brand-400"
            }`}
          >
            {question}
          </button>
        ))}
      </div>

      {answer !== null && (
        <div className="optiflow-enter mt-3 rounded-xl border border-brand-400/30 bg-brand-600/10 p-3">
          <p className="text-sm text-slate-900">{answer.text}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {answer.confidence !== null && (
              <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                {CONFIDENCE_LABEL[answer.confidence]}
              </span>
            )}
            {answer.reasons.length > 0 && (
              <button
                type="button"
                onClick={() => setShowReasons((current) => !current)}
                aria-expanded={showReasons}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 transition-colors duration-200 hover:text-slate-900"
              >
                <Info className="h-3 w-3" />
                Neden bunu öneriyorum?
              </button>
            )}
          </div>

          {showReasons && (
            <ul className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              {answer.reasons.map((reason) => (
                <li key={reason} className="text-[11px] text-slate-600">
                  • {reason}
                </li>
              ))}
            </ul>
          )}

          {answer.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {answer.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  title={action.reason}
                  onClick={() => onNavigate(action.view)}
                  className="optiflow-lift rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors duration-200 hover:border-brand-400 hover:text-brand-700"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
