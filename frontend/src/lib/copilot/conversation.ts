/**
 * Konuşma motoru — mesajlar, oturum ve kalıcılık.
 *
 * Bir yönetici Copilot'a sorduğu soruyu ve aldığı yanıtı ertesi gün yeniden
 * bulabilmelidir: "geçen hafta bana ne demişti?" sorusu, kaydı olmayan bir
 * sohbette yanıtlanamaz. Bu yüzden konuşma tarayıcıda saklanır.
 *
 * Saklama bilinçli olarak **tarayıcıdadır**: bu sprintte backend'e
 * dokunulmuyor. Sunucuya taşındığında değişecek tek şey bu dosyadaki iki
 * çağrıdır; ekranlar aynı kalır. Arayüz kapsamın sınırını yazar — başka bir
 * cihazda yapılmış konuşma burada görünmez.
 *
 * Zaman her işlevde dışarıdan gelir; motor saat okumaz.
 */

import type {
  ActionCard,
  Conversation,
  CopilotAnswer,
  CopilotMessage,
} from "./types";

const STORAGE_KEY = "optiflow.copilot.conversation";

/**
 * Bir konuşmada tutulan en fazla mesaj.
 *
 * Kırk mesaj, uzun bir analiz oturumunu kapsar. Sınırsız bırakılsaydı aylarca
 * açık kalan bir sekmede kayıt sürekli büyür ve her yazmada tarayıcı deposuna
 * giderek daha büyük bir metin yazılırdı.
 */
export const MAX_MESSAGES = 40;

/** Başlığın en fazla uzunluğu. */
export const MAX_TITLE_LENGTH = 48;

/** Yeni bir konuşma. */
export function startConversation(id: string, nowMs: number): Conversation {
  return {
    id,
    title: "Yeni konuşma",
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
    messages: [],
  };
}

/**
 * İlk sorudan başlık türetir.
 *
 * Başlık kısaltılırken kelime ortasından kesilmez: "Bugünkü darboğazı açık…"
 * gibi bir başlık, listede okunmaz hâle gelirdi.
 */
export function titleFor(question: string): string {
  const clean = question.trim().replace(/\s+/g, " ");
  if (clean === "") {
    return "Yeni konuşma";
  }
  if (clean.length <= MAX_TITLE_LENGTH) {
    return clean;
  }
  const cut = clean.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Kullanıcı mesajı. */
export function userMessage(
  id: string,
  text: string,
  atMs: number,
): CopilotMessage {
  return {
    id,
    role: "user",
    text: text.trim(),
    atMs,
    confidence: null,
    reasons: [],
    actions: [],
    sources: [],
  };
}

/** Yanıt mesajı; gerekçeler ve eylem kartları yanıtla birlikte taşınır. */
export function assistantMessage(
  id: string,
  answer: CopilotAnswer,
  atMs: number,
): CopilotMessage {
  return {
    id,
    role: "assistant",
    text: answer.text,
    atMs,
    confidence: answer.confidence,
    reasons: answer.reasons,
    actions: answer.actions,
    sources: answer.sources,
  };
}

/**
 * Mesajı konuşmaya ekler.
 *
 * İlk kullanıcı mesajı başlığı belirler. Sınır aşıldığında **en eski** mesajlar
 * düşer; son mesajlar bağlamı taşıdığı için baştan kırpılır.
 */
export function appendMessage(
  conversation: Conversation,
  message: CopilotMessage,
): Conversation {
  const messages = [...conversation.messages, message];
  const trimmed = messages.slice(Math.max(messages.length - MAX_MESSAGES, 0));

  const isFirstQuestion =
    message.role === "user" &&
    conversation.messages.every((item) => item.role !== "user");

  return {
    ...conversation,
    title: isFirstQuestion ? titleFor(message.text) : conversation.title,
    updatedAtMs: message.atMs,
    messages: trimmed,
  };
}

/** Konuşmayı boşaltır ama kimliğini korur. */
export function clearMessages(
  conversation: Conversation,
  nowMs: number,
): Conversation {
  return {
    ...conversation,
    title: "Yeni konuşma",
    updatedAtMs: nowMs,
    messages: [],
  };
}

/** Son kullanıcı sorusu; yoksa `null`. */
export function lastQuestion(conversation: Conversation): string | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    if (conversation.messages[index].role === "user") {
      return conversation.messages[index].text;
    }
  }
  return null;
}

/** Kaç analiz yapıldı (yanıt sayısı). */
export function answerCount(conversation: Conversation): number {
  return conversation.messages.filter((item) => item.role === "assistant").length;
}

/* -------------------------------------------------------------------------- */
/* Dışa aktarma                                                                */
/* -------------------------------------------------------------------------- */

const TIME_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Konuşmanın düz metin hâli.
 *
 * Gerekçeler de yazılır: yanıtı bir e-postaya yapıştıran kullanıcı, cümlenin
 * neye dayandığını da göndermelidir.
 */
export function conversationToText(conversation: Conversation): string {
  const lines: string[] = [
    `OptiFlow Copilot — ${conversation.title}`,
    TIME_FORMAT.format(new Date(conversation.startedAtMs)),
    "",
  ];

  for (const message of conversation.messages) {
    const who = message.role === "user" ? "Soru" : "Copilot";
    lines.push(`[${TIME_FORMAT.format(new Date(message.atMs))}] ${who}:`);
    lines.push(message.text);

    if (message.reasons.length > 0) {
      lines.push("Neden:");
      for (const reason of message.reasons) {
        lines.push(`  - ${reason}`);
      }
    }
    lines.push("");
  }

  lines.push(
    "Bu konuşmadaki sayılar OptiFlow'un ölçtüğü değerlerden gelir; Copilot ölçülmemiş bir değer üretmez.",
  );

  return lines.join("\n");
}

/** Dosya adı (uzantısız). */
export function conversationFileName(conversation: Conversation): string {
  const date = new Date(conversation.startedAtMs);
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `optiflow-copilot-${stamp}`;
}

/* -------------------------------------------------------------------------- */
/* Saklama                                                                     */
/* -------------------------------------------------------------------------- */

function isValidAction(value: unknown): value is ActionCard {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.label === "string" &&
    typeof item.view === "string" &&
    typeof item.reason === "string"
  );
}

export function isValidMessage(value: unknown): value is CopilotMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const confidenceOk =
    item.confidence === null ||
    item.confidence === "high" ||
    item.confidence === "medium" ||
    item.confidence === "low" ||
    item.confidence === "none";

  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.text === "string" &&
    typeof item.atMs === "number" &&
    confidenceOk &&
    Array.isArray(item.reasons) &&
    item.reasons.every((reason) => typeof reason === "string") &&
    Array.isArray(item.actions) &&
    item.actions.every(isValidAction) &&
    Array.isArray(item.sources)
  );
}

/**
 * Ham metni konuşmaya çevirir.
 *
 * Tanınmayan mesajlar atılır ama konuşma silinmez: eski bir sürümden kalmış tek
 * bozuk satır yüzünden bütün geçmişi kaybettirmek, kullanıcının güvenini
 * kaybettirmenin en hızlı yoludur.
 */
export function parseConversation(
  raw: string | null,
  fallback: Conversation,
): Conversation {
  if (raw === null) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return fallback;
    }
    const item = parsed as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.startedAtMs !== "number" ||
      !Array.isArray(item.messages)
    ) {
      return fallback;
    }

    const messages = item.messages.filter(isValidMessage) as CopilotMessage[];

    return {
      id: item.id,
      title: typeof item.title === "string" ? item.title : "Yeni konuşma",
      startedAtMs: item.startedAtMs,
      updatedAtMs:
        typeof item.updatedAtMs === "number" ? item.updatedAtMs : item.startedAtMs,
      messages: messages.slice(Math.max(messages.length - MAX_MESSAGES, 0)),
    };
  } catch {
    return fallback;
  }
}

export function recallConversation(fallback: Conversation): Conversation {
  try {
    return parseConversation(window.localStorage.getItem(STORAGE_KEY), fallback);
  } catch {
    return fallback;
  }
}

export function rememberConversation(conversation: Conversation): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
  } catch {
    /* Depolama yoksa konuşma yalnızca bu oturumda yaşar. */
  }
}
