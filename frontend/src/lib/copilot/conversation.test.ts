import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGES,
  MAX_TITLE_LENGTH,
  answerCount,
  appendMessage,
  assistantMessage,
  clearMessages,
  conversationFileName,
  conversationToText,
  isValidMessage,
  lastQuestion,
  parseConversation,
  startConversation,
  titleFor,
  userMessage,
} from "./conversation";
import { sampleConversation } from "./fixtures";
import type { Conversation, CopilotAnswer } from "./types";

const NOW = 1_700_000_000_000;

function answer(text = "Darboğaz Kaynak istasyonu."): CopilotAnswer {
  return {
    text,
    reasons: ["Koşumda darboğaz olarak Kaynak işaretlendi."],
    actions: [
      { id: "action-finance", label: "Finans'a git", view: "finance", reason: "Kayıp dökümü." },
    ],
    confidence: "high",
    sources: ["simulation", "finance"],
  };
}

function withMessages(count: number): Conversation {
  let conversation = startConversation("c1", NOW);
  for (let index = 0; index < count; index += 1) {
    conversation = appendMessage(
      conversation,
      userMessage(`u${index}`, `Soru ${index}`, NOW + index),
    );
  }
  return conversation;
}

describe("startConversation", () => {
  it("bos bir konusma kurar", () => {
    const conversation = startConversation("c1", NOW);
    expect(conversation.messages).toEqual([]);
    expect(conversation.title).toBe("Yeni konuşma");
    expect(conversation.startedAtMs).toBe(NOW);
  });
});

describe("titleFor", () => {
  it("kisa soruyu oldugu gibi kullanir", () => {
    expect(titleFor("Bugünkü darboğazı açıkla.")).toBe("Bugünkü darboğazı açıkla.");
  });

  it("fazla bosluklari temizler", () => {
    expect(titleFor("  Fire   neden   arttı? ")).toBe("Fire neden arttı?");
  });

  it("uzun soruyu kelime ortasindan kesmez", () => {
    const long =
      "Hangi istasyona yatırım yapmalıyım ve bu yatırımın geri dönüşü ne kadar sürer";
    const title = titleFor(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("  ");
  });

  it("bos soruda varsayilan baslik verir", () => {
    expect(titleFor("   ")).toBe("Yeni konuşma");
  });
});

describe("appendMessage", () => {
  it("mesaji ekler ve zamani gunceller", () => {
    const conversation = appendMessage(
      startConversation("c1", NOW),
      userMessage("u1", "Fire neden arttı?", NOW + 5),
    );
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.updatedAtMs).toBe(NOW + 5);
  });

  it("ilk sorudan baslik turetir", () => {
    const conversation = appendMessage(
      startConversation("c1", NOW),
      userMessage("u1", "Fire neden arttı?", NOW),
    );
    expect(conversation.title).toBe("Fire neden arttı?");
  });

  it("ikinci soru basligi degistirmez", () => {
    let conversation = appendMessage(
      startConversation("c1", NOW),
      userMessage("u1", "Fire neden arttı?", NOW),
    );
    conversation = appendMessage(
      conversation,
      userMessage("u2", "Peki kayıp?", NOW + 1),
    );
    expect(conversation.title).toBe("Fire neden arttı?");
  });

  it("yanit mesaji baslik belirlemez", () => {
    const conversation = appendMessage(
      startConversation("c1", NOW),
      assistantMessage("a1", answer(), NOW),
    );
    expect(conversation.title).toBe("Yeni konuşma");
  });

  it("sinir asilinca en eski mesaj duser", () => {
    const conversation = withMessages(MAX_MESSAGES + 5);
    expect(conversation.messages).toHaveLength(MAX_MESSAGES);
    expect(conversation.messages[0].text).toBe("Soru 5");
  });

  it("girdiyi degistirmez", () => {
    const original = startConversation("c1", NOW);
    appendMessage(original, userMessage("u1", "Soru", NOW));
    expect(original.messages).toHaveLength(0);
  });
});

describe("assistantMessage", () => {
  it("yanitin gerekce ve eylemlerini tasir", () => {
    const message = assistantMessage("a1", answer(), NOW);
    expect(message.role).toBe("assistant");
    expect(message.confidence).toBe("high");
    expect(message.reasons).toHaveLength(1);
    expect(message.actions).toHaveLength(1);
    expect(message.sources).toEqual(["simulation", "finance"]);
  });
});

describe("userMessage", () => {
  it("metni kirpar ve alanlari bos birakir", () => {
    const message = userMessage("u1", "  Soru  ", NOW);
    expect(message.text).toBe("Soru");
    expect(message.confidence).toBeNull();
    expect(message.reasons).toEqual([]);
  });
});

describe("clearMessages / lastQuestion / answerCount", () => {
  it("mesajlari siler ama kimligi korur", () => {
    const conversation = clearMessages(sampleConversation(NOW), NOW + 10);
    expect(conversation.id).toBe("conv-ornek");
    expect(conversation.messages).toEqual([]);
    expect(conversation.title).toBe("Yeni konuşma");
  });

  it("son soruyu bulur", () => {
    expect(lastQuestion(sampleConversation(NOW))).toBe("Bugünkü darboğazı açıkla.");
  });

  it("soru yoksa bos doner", () => {
    expect(lastQuestion(startConversation("c1", NOW))).toBeNull();
  });

  it("yanit sayisini sayar", () => {
    expect(answerCount(sampleConversation(NOW))).toBe(1);
    expect(answerCount(startConversation("c1", NOW))).toBe(0);
  });
});

describe("conversationToText", () => {
  const text = conversationToText(sampleConversation(NOW));

  it("soruyu ve yaniti yazar", () => {
    expect(text).toContain("Soru:");
    expect(text).toContain("Copilot:");
    expect(text).toContain("Bugünkü darboğazı açıkla.");
  });

  it("gerekceleri de tasir", () => {
    // Yaniti e-postaya yapistiran kullanici, dayanagi da gondermelidir.
    expect(text).toContain("Neden:");
    expect(text).toContain("Kaynak işaretlendi");
  });

  it("sonunda kaynak notunu yazar", () => {
    expect(text).toContain("ölçülmemiş bir değer üretmez");
  });

  it("bos konusmada da coker degil", () => {
    const empty = conversationToText(startConversation("c1", NOW));
    expect(empty).toContain("OptiFlow Copilot");
  });
});

describe("conversationFileName", () => {
  it("tarih damgasi tasir", () => {
    expect(conversationFileName(sampleConversation(NOW))).toMatch(
      /^optiflow-copilot-\d{4}-\d{2}-\d{2}$/,
    );
  });
});

describe("isValidMessage", () => {
  it("gecerli mesaji tanir", () => {
    expect(isValidMessage(userMessage("u1", "Soru", NOW))).toBe(true);
    expect(isValidMessage(assistantMessage("a1", answer(), NOW))).toBe(true);
  });

  it("eksik alanli mesaji reddeder", () => {
    expect(isValidMessage({ id: "u1", role: "user" })).toBe(false);
    expect(isValidMessage(null)).toBe(false);
  });

  it("taninmayan rolu reddeder", () => {
    expect(
      isValidMessage({
        id: "x",
        role: "system",
        text: "a",
        atMs: 1,
        confidence: null,
        reasons: [],
        actions: [],
        sources: [],
      }),
    ).toBe(false);
  });

  it("bozuk eylem kartini reddeder", () => {
    expect(
      isValidMessage({
        id: "x",
        role: "assistant",
        text: "a",
        atMs: 1,
        confidence: "high",
        reasons: [],
        actions: [{ id: "a" }],
        sources: [],
      }),
    ).toBe(false);
  });
});

describe("parseConversation", () => {
  const fallback = startConversation("bos", NOW);

  it("gecerli kaydi okur", () => {
    const stored = sampleConversation(NOW);
    expect(parseConversation(JSON.stringify(stored), fallback)).toEqual(stored);
  });

  it("bozuk metinde yedege doner", () => {
    expect(parseConversation("{bozuk", fallback)).toBe(fallback);
    expect(parseConversation(null, fallback)).toBe(fallback);
    expect(parseConversation('"metin"', fallback)).toBe(fallback);
  });

  it("eksik alanli kayitta yedege doner", () => {
    expect(parseConversation('{"id":"c1"}', fallback)).toBe(fallback);
  });

  it("bozuk tek mesaji atar, konusmayi silmez", () => {
    // Eski surumden kalmis tek satir yuzunden gecmisi silmek guveni kaybettirir.
    const stored = {
      ...sampleConversation(NOW),
      messages: [...sampleConversation(NOW).messages, { id: "kirik" }],
    };
    const parsed = parseConversation(JSON.stringify(stored), fallback);
    expect(parsed.messages).toHaveLength(2);
  });

  it("cok uzun kaydi sinira kirpar", () => {
    const stored = {
      ...startConversation("c1", NOW),
      messages: Array.from({ length: MAX_MESSAGES + 10 }, (_, index) =>
        userMessage(`u${index}`, `Soru ${index}`, NOW + index),
      ),
    };
    expect(
      parseConversation(JSON.stringify(stored), fallback).messages,
    ).toHaveLength(MAX_MESSAGES);
  });

  it("baslik eksikse varsayilan verir", () => {
    const stored = { id: "c1", startedAtMs: NOW, messages: [] };
    expect(parseConversation(JSON.stringify(stored), fallback).title).toBe(
      "Yeni konuşma",
    );
  });
});
