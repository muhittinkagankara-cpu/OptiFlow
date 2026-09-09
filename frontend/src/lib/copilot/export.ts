/**
 * Konuşmanın dışa aktarılması — PDF ve düz metin.
 *
 * PDF, rapor katmanının `ReportDocument` şemasını kullanır: kapak, bloklar,
 * gömülü Türkçe yazı tipi ve sayfa taşması orada bir kez çözülmüştür. İkinci
 * bir PDF hattı yazmak, aynı sorunları ikinci kez çözmek olurdu.
 *
 * Gerekçeler ("neden bunu öneriyorum") çıktıya **dâhil edilir**. Bir yönetici
 * raporu toplantıya götürdüğünde ilk sorulacak soru "bu sayı nereden geliyor?"
 * olur; gerekçesi olmayan bir cümle o toplantıda çöker.
 */

import {
  fileDateStamp,
  formatReportDate,
  type ReportBlock,
  type ReportDocument,
} from "../reports";
import { conversationFileName } from "./conversation";
import { SOURCE_LABEL, type Conversation, type FactoryContext } from "./types";
import { CONFIDENCE_LABEL } from "./types";

export interface CopilotExportInput {
  conversation: Conversation;
  context: FactoryContext;
  orgName: string | null;
  generatedAt: Date;
  /** Sağlayıcının adı; kapakta künye olarak görünür. */
  providerName: string;
}

/** PDF dosyasının adı (uzantısız). */
export function copilotReportFileName(input: CopilotExportInput): string {
  return `${conversationFileName(input.conversation)}-${fileDateStamp(input.generatedAt)}`;
}

export function buildCopilotDocument(
  input: CopilotExportInput,
): ReportDocument {
  const { conversation, context, providerName } = input;
  const blocks: ReportBlock[] = [];

  if (conversation.messages.length === 0) {
    blocks.push({
      kind: "paragraph",
      text: "Bu konuşmada henüz mesaj yok.",
      muted: true,
    });
  }

  for (const message of conversation.messages) {
    if (message.role === "user") {
      blocks.push({ kind: "heading", level: 2, text: message.text });
      continue;
    }

    blocks.push({ kind: "paragraph", text: message.text });

    if (message.confidence !== null) {
      blocks.push({
        kind: "note",
        text: `${CONFIDENCE_LABEL[message.confidence]}${
          message.sources.length === 0
            ? ""
            : ` · Kaynaklar: ${message.sources.map((source) => SOURCE_LABEL[source]).join(", ")}`
        }`,
        tone:
          message.confidence === "high"
            ? "good"
            : message.confidence === "none"
              ? "neutral"
              : "warning",
      });
    }

    if (message.reasons.length > 0) {
      blocks.push({
        kind: "table",
        caption: "Neden bu yanıt verildi",
        columns: ["Gerekçe"],
        widths: ["*"],
        rows: message.reasons.map((reason) => [reason]),
      });
    }
  }

  /* --- Bağlamın kapsamı --- */
  blocks.push({ kind: "heading", level: 2, text: "Yanıtların Dayandığı Veri" });
  blocks.push({
    kind: "table",
    columns: ["Katman", "Durum", "Açıklama"],
    widths: ["auto", "auto", "*"],
    rows: context.sections.map((section) => [
      SOURCE_LABEL[section.source],
      section.available ? "var" : "yok",
      section.available
        ? `${section.facts.length} ölçüm`
        : (section.missingReason ?? "—"),
    ]),
  });

  blocks.push({
    kind: "note",
    text: "Copilot yalnızca bu tabloda 'var' görünen katmanların ölçümlerini kullanır; ölçülmemiş bir değeri tahmin etmez.",
    tone: "neutral",
  });

  return {
    fileName: copilotReportFileName(input),
    cover: {
      title: "Copilot Analizi",
      subtitle: conversation.title,
      factoryName: context.factoryName ?? "Kaydedilmemiş model",
      generatedAtLabel: formatReportDate(input.generatedAt),
      orgName: input.orgName,
      facts: [
        { label: "Sağlayıcı", value: providerName },
        {
          label: "Mesaj sayısı",
          value: String(conversation.messages.length),
        },
        {
          label: "Veri katmanı",
          value: `${context.sections.filter((section) => section.available).length} / ${context.sections.length}`,
        },
        {
          label: "Konuşma başlangıcı",
          value: formatReportDate(new Date(conversation.startedAtMs)),
        },
      ],
    },
    blocks,
  };
}

/**
 * Düz metin indirmesini tetikler.
 *
 * PDF'in aksine burada bir kütüphane yoktur: metin dosyası, tarayıcının kendi
 * Blob desteğiyle üretilir ve paketi büyütmez.
 */
export function downloadText(text: string, fileName: string): void {
  const blob = new Blob(["﻿", text], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
