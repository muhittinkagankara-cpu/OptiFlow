/**
 * Copilot Home — büyük sohbet ekranı.
 *
 * Ekran hiçbir karar vermez: soruyu sağlayıcıya iletir, dönen yanıtı çizer.
 * Yanıtın içeriği, gerekçesi, güven etiketi ve eylem kartları
 * `lib/copilot` içinde üretilir ve sınanır.
 *
 * Sağlayıcı **soyutlama üzerinden** kullanılır; bu dosyada tek bir somut sınıf
 * adı geçmez (`defaultProvider()`). Yarın bir dil modeli eklendiğinde burası
 * değişmeyecek.
 *
 * Konuşma tarayıcıda saklanır: ekranı kapatıp geri gelen kullanıcı, sorduğu
 * soruyu ve aldığı yanıtı yerinde bulur.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Eraser, FileText, Send, Sparkles } from "lucide-react";
import type {
  FinancialReport,
  InventoryAnalysis,
  SimulationRunResponse,
} from "../../types/simulationTypes";
import { downloadPdf, readLogo } from "../../lib/reports";
import { recallLeads } from "../../lib/sales";
import { recallTimeline } from "../../lib/validation";
import {
  SUGGESTED_QUESTIONS,
  appendMessage,
  assistantMessage,
  buildContext,
  buildCopilotDocument,
  clearMessages,
  consume,
  conversationFileName,
  conversationToText,
  defaultProvider,
  downloadText,
  initialQuota,
  quotaSnapshot,
  recallConversation,
  recallQuota,
  rememberConversation,
  rememberQuota,
  startConversation,
  userMessage,
  type CopilotTier,
} from "../../lib/copilot";
import { Badge, Button, Card } from "../ui/Primitives";
import { AIHealthPanel } from "./AIHealthPanel";
import { MessageBubble, TypingIndicator } from "./MessageBubble";

interface CopilotHomeProps {
  factoryName: string | null;
  orgName: string;
  result: SimulationRunResponse | null;
  report: FinancialReport | null;
  inventory: InventoryAnalysis[] | null;
  /** Abonelik paketi; kota sınırı buradan gelir. */
  tier: CopilotTier;
  /** Eylem kartlarının götüreceği ekranı açar. */
  onNavigate: (view: string) => void;
}

export function CopilotHome({
  factoryName,
  orgName,
  result,
  report,
  inventory,
  tier,
  onNavigate,
}: CopilotHomeProps) {
  const provider = useMemo(() => defaultProvider(), []);

  const [conversation, setConversation] = useState(() =>
    recallConversation(startConversation(`conv-${Date.now().toString(36)}`, Date.now())),
  );
  const [quota, setQuota] = useState(() =>
    recallQuota(initialQuota(tier, Date.now())),
  );
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /*
   * Paket değişince kota durumu da değişir; kayıtlı durum eski pakete aitse
   * güncellenir. Kullanıcı Growth'a yükselttiğinde eski "kapalı" durumunun
   * kalması, ödediği özelliği görememesi demek olurdu.
   */
  const [knownTier, setKnownTier] = useState(tier);
  if (knownTier !== tier) {
    setKnownTier(tier);
    setQuota((current) => ({ ...current, tier }));
  }

  useEffect(() => {
    rememberConversation(conversation);
  }, [conversation]);

  useEffect(() => {
    rememberQuota(quota);
  }, [quota]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation.messages.length, thinking]);

  /**
   * Bağlam her soruda yeniden kurulur.
   *
   * Dondurulsaydı, sohbet açıkken alınan yeni bir koşum yanıtlara yansımaz ve
   * Copilot eski sayıları söylemeye devam ederdi.
   */
  const buildCurrentContext = useCallback(
    () =>
      buildContext({
        factoryName,
        nowMs: Date.now(),
        results: result?.results ?? null,
        report,
        validation: null,
        confidence: null,
        // Doğrulama ve satış ekranları kendi durumlarını taşır; Copilot burada
        // kullanıcının kendi kaydettiği son veriyi okur.
        validationHistory: recallTimeline(),
        live: null,
        inventory,
        leads: recallLeads(),
        connectors: null,
      }),
    [factoryName, inventory, report, result],
  );

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "" || thinking) {
        return;
      }

      const nowMs = Date.now();
      const spend = consume(quota, nowMs);
      if (!spend.allowed) {
        setQuota(spend.state);
        setNotice(spend.reason);
        return;
      }

      setNotice(null);
      setQuota(spend.state);
      setQuestion("");
      setThinking(true);

      const withQuestion = appendMessage(
        conversation,
        userMessage(`u-${nowMs.toString(36)}`, trimmed, nowMs),
      );
      setConversation(withQuestion);

      try {
        const answer = await provider.generate({
          question: trimmed,
          context: buildCurrentContext(),
          nowMs,
          history: withQuestion.messages,
        });
        setConversation((current) =>
          appendMessage(
            current,
            assistantMessage(`a-${Date.now().toString(36)}`, answer, Date.now()),
          ),
        );
      } catch (error) {
        // Sağlayıcı hatası sessizce yutulmaz; kullanıcı neden yanıt gelmediğini
        // görmelidir.
        setNotice(
          error instanceof Error
            ? `Yanıt üretilemedi: ${error.message}`
            : "Yanıt üretilemedi.",
        );
      } finally {
        setThinking(false);
      }
    },
    [buildCurrentContext, conversation, provider, quota, thinking],
  );

  const exportPdf = useCallback(async () => {
    setExporting(true);
    try {
      await downloadPdf(
        buildCopilotDocument({
          conversation,
          context: buildCurrentContext(),
          orgName,
          generatedAt: new Date(),
          providerName: provider.name,
        }),
        readLogo(),
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? `PDF üretilemedi: ${error.message}` : "PDF üretilemedi.",
      );
    } finally {
      setExporting(false);
    }
  }, [buildCurrentContext, conversation, orgName, provider.name]);

  /*
   * Kota özeti render sırasında saat okumaz: `Date.now()` her render'da farklı
   * bir değer döndürür ve React'in saf render beklentisini bozar. Saat, dakikada
   * bir tazelenen bir durumda tutulur — kalan hak ve dönem sonu için bu
   * çözünürlük fazlasıyla yeter.
   */
  const snapshot = useMemo(() => quotaSnapshot(quota, nowMs), [quota, nowMs]);
  const health = provider.health();
  const isEmpty = conversation.messages.length === 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            AI Copilot
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Fabrikanızın verisini yorumlar; ölçülmemiş bir sayı üretmez.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={health.status === "ready" ? "good" : "neutral"} icon={Sparkles}>
            {provider.name}
          </Badge>
          <Button
            size="sm"
            icon={FileText}
            busy={exporting}
            disabled={isEmpty}
            onClick={() => void exportPdf()}
          >
            PDF
          </Button>
          <Button
            size="sm"
            disabled={isEmpty}
            onClick={() =>
              downloadText(
                conversationToText(conversation),
                conversationFileName(conversation),
              )
            }
          >
            TXT
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Eraser}
            disabled={isEmpty}
            onClick={() => setConversation((current) => clearMessages(current, Date.now()))}
          >
            Temizle
          </Button>
        </div>
      </div>

      <AIHealthPanel
        providerName={provider.name}
        health={health}
        quota={snapshot}
        conversation={conversation}
      />

      {notice !== null && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </p>
      )}

      {/* --- Sohbet --- */}
      <Card className="mt-3 flex min-h-[320px] flex-1 flex-col overflow-hidden p-4">
        <div className="flex-1 space-y-4 overflow-y-auto">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/15 text-brand-700">
                <Sparkles className="h-6 w-6" />
              </span>
              <p className="text-base font-semibold text-slate-900">
                Fabrikanız hakkında bir soru sorun
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Yanıtlar bu cihazda, ürünün kendi ölçümlerinden üretilir. Veri
                yoksa Copilot bunu açıkça söyler.
              </p>
            </div>
          ) : (
            conversation.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onNavigate={onNavigate}
              />
            ))
          )}

          {thinking && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* --- Hazır sorular --- */}
        {isEmpty && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SUGGESTED_QUESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => void ask(item)}
                className="optiflow-lift rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-medium text-slate-700 transition-colors duration-200 hover:border-brand-400 hover:text-brand-700"
              >
                {item}
              </button>
            ))}
          </div>
        )}

        {/* --- Giriş --- */}
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter gönderir, Shift+Enter satır ekler: sohbet kutusunun
              // beklenen davranışı budur.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(question);
              }
            }}
            rows={2}
            placeholder={
              snapshot.allowed
                ? "Bugün en büyük kaybım nerede?"
                : "Analiz hakkınız bu dönem için doldu."
            }
            disabled={!snapshot.allowed}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400 disabled:bg-slate-100 disabled:text-slate-400"
          />
          <Button
            variant="primary"
            icon={Send}
            busy={thinking}
            disabled={!snapshot.allowed || question.trim() === ""}
            onClick={() => void ask(question)}
          >
            Sor
          </Button>
        </form>
      </Card>
    </div>
  );
}
