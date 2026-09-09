import { describe, expect, it } from "vitest";
import {
  MAX_COMMENT_LENGTH,
  appendComment,
  commentsFor,
  createComment,
  deleteComment,
  extractMentionCandidates,
  mentionsOf,
  openComments,
  openCountByTarget,
  reopenComment,
  resolveComment,
  resolveMentions,
  splitMentions,
} from "./comments";
import type { Comment, CommentTarget, Member } from "./types";

const NOW = 1_700_000_000_000;

const TORNA: CommentTarget = { kind: "station", id: "torna", label: "Torna" };
const HAT: CommentTarget = { kind: "factory", id: "hat-1", label: "Kuzey Hat 1" };

function member(name: string, email: string): Member {
  return {
    id: email,
    name,
    email,
    role: "engineer",
    status: "active",
    lastActiveAtMs: null,
    origin: "fixture",
  };
}

const MEMBERS = [
  member("Ayşe Yıldız", "ayse@fabrika.com"),
  member("Kaan Demir", "kaan@fabrika.com"),
];

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    target: TORNA,
    authorName: "Kaan Demir",
    text: "Çevrim süresi uzun.",
    createdAtMs: NOW,
    mentions: [],
    resolved: false,
    resolvedBy: null,
    resolvedAtMs: null,
    origin: "local",
    ...overrides,
  };
}

describe("extractMentionCandidates", () => {
  it("basit anmayi bulur", () => {
    expect(extractMentionCandidates("@kaan bak")).toEqual(["kaan"]);
  });

  it("turkce harfli anmayi bulur", () => {
    expect(extractMentionCandidates("@ayşe bakar mısın")).toEqual(["ayşe"]);
  });

  it("birden fazla anmayi bulur", () => {
    expect(extractMentionCandidates("@kaan ve @ayse")).toEqual(["kaan", "ayse"]);
  });

  it("nokta ve alt cizgi iceren adi bulur", () => {
    expect(extractMentionCandidates("@ayse_y.demir")).toEqual(["ayse_y.demir"]);
  });

  it("anma yoksa bos doner", () => {
    expect(extractMentionCandidates("düz metin")).toEqual([]);
  });

  it("yalniz @ isaretini anma saymaz", () => {
    expect(extractMentionCandidates("bak @ ve dur")).toEqual([]);
  });
});

describe("resolveMentions", () => {
  it("var olan uyeyi tam adiyla doner", () => {
    const result = resolveMentions("@ayşe bak", MEMBERS);
    expect(result.mentions).toEqual(["Ayşe Yıldız"]);
  });

  it("e-postanin yerel kismiyla da eslesir", () => {
    expect(resolveMentions("@ayse bak", MEMBERS).mentions).toEqual(["Ayşe Yıldız"]);
  });

  it("eslesmeyen anmayi bildirir", () => {
    // Yazim hatasi olan anma, ulastigi sanilan ama ulasmayan bir mesajdir.
    const result = resolveMentions("@zeynep bak", MEMBERS);
    expect(result.mentions).toEqual([]);
    expect(result.unknown).toEqual(["zeynep"]);
  });

  it("ayni kisiyi iki kez saymaz", () => {
    const result = resolveMentions("@ayse @ayşe", MEMBERS);
    expect(result.mentions).toEqual(["Ayşe Yıldız"]);
  });

  it("gercek ve hatali anmayi ayirir", () => {
    const result = resolveMentions("@kaan ve @yok", MEMBERS);
    expect(result.mentions).toEqual(["Kaan Demir"]);
    expect(result.unknown).toEqual(["yok"]);
  });

  it("bos uye listesinde her anma bilinmezdir", () => {
    expect(resolveMentions("@kaan", []).unknown).toEqual(["kaan"]);
  });
});

describe("createComment", () => {
  it("gecerli yorumu uretir", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan Demir",
      text: "Ölçüm alalım.",
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.error).toBeNull();
    expect(result.comment?.text).toBe("Ölçüm alalım.");
  });

  it("bos yorumu reddeder", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan",
      text: "   ",
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.comment).toBeNull();
    expect(result.error).toBe("Yorum boş olamaz.");
  });

  it("uzun yorumu reddeder", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan",
      text: "a".repeat(MAX_COMMENT_LENGTH + 1),
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.error).toContain(String(MAX_COMMENT_LENGTH));
  });

  it("sinirdaki uzunlugu kabul eder", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan",
      text: "a".repeat(MAX_COMMENT_LENGTH),
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.comment).not.toBeNull();
  });

  it("metni kirpar", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan",
      text: "  not  ",
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.comment?.text).toBe("not");
  });

  it("anmalari cozer", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan",
      text: "@ayse bakar mısın",
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.comment?.mentions).toEqual(["Ayşe Yıldız"]);
  });

  it("eslesmeyen anmayi cagirana bildirir", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan",
      text: "@yok bak",
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.unknownMentions).toEqual(["yok"]);
  });

  it("yeni yorum cozulmemis baslar", () => {
    const result = createComment([], {
      target: TORNA,
      authorName: "Kaan",
      text: "not",
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.comment?.resolved).toBe(false);
    expect(result.comment?.resolvedBy).toBeNull();
  });

  it("kaynak local olur", () => {
    const result = createComment([], {
      target: HAT,
      authorName: "Kaan",
      text: "not",
      atMs: NOW,
      members: MEMBERS,
    });
    expect(result.comment?.origin).toBe("local");
  });
});

describe("appendComment", () => {
  it("yeni yorumu basa koyar", () => {
    const result = appendComment([comment({ id: "eski" })], comment({ id: "yeni" }));
    expect(result[0].id).toBe("yeni");
  });
});

describe("resolveComment", () => {
  it("cozuldu isaretler ve kimin kapattigini yazar", () => {
    const result = resolveComment([comment()], "c1", "Ayşe Yıldız", NOW + 1);
    expect(result[0].resolved).toBe(true);
    expect(result[0].resolvedBy).toBe("Ayşe Yıldız");
    expect(result[0].resolvedAtMs).toBe(NOW + 1);
  });

  it("yorumu silmez", () => {
    // Bir sorunun ne zaman kapatildigi, sorunun kendisi kadar onemlidir.
    expect(resolveComment([comment()], "c1", "Ayşe", NOW)).toHaveLength(1);
  });

  it("zaten cozulmus yorumun kaydini degistirmez", () => {
    const list = [comment({ resolved: true, resolvedBy: "Kaan", resolvedAtMs: NOW })];
    expect(resolveComment(list, "c1", "Ayşe", NOW + 5)[0].resolvedBy).toBe("Kaan");
  });

  it("olmayan kimlik listeyi bozmaz", () => {
    expect(resolveComment([comment()], "yok", "Ayşe", NOW)[0].resolved).toBe(false);
  });
});

describe("reopenComment", () => {
  it("cozuldu isaretini kaldirir", () => {
    const list = [comment({ resolved: true, resolvedBy: "Kaan", resolvedAtMs: NOW })];
    const result = reopenComment(list, "c1");
    expect(result[0].resolved).toBe(false);
    expect(result[0].resolvedBy).toBeNull();
    expect(result[0].resolvedAtMs).toBeNull();
  });
});

describe("deleteComment", () => {
  it("yorumu cikarir", () => {
    expect(deleteComment([comment(), comment({ id: "c2" })], "c1")).toHaveLength(1);
  });
});

describe("commentsFor", () => {
  const list = [
    comment({ id: "a", target: TORNA }),
    comment({ id: "b", target: HAT }),
  ];

  it("hedefe ait yorumlari doner", () => {
    expect(commentsFor(list, { kind: "station", id: "torna" }).map((c) => c.id)).toEqual([
      "a",
    ]);
  });

  it("ayni kimlikte farkli tur karismaz", () => {
    // Bir istasyon ile bir fabrika ayni kimligi tasiyabilir.
    expect(commentsFor(list, { kind: "factory", id: "torna" })).toHaveLength(0);
  });
});

describe("openComments", () => {
  it("yalnizca cozulmemisleri doner", () => {
    const list = [comment({ id: "a" }), comment({ id: "b", resolved: true })];
    expect(openComments(list).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("mentionsOf", () => {
  it("kisiyi anan acik yorumlari doner", () => {
    const list = [comment({ id: "a", mentions: ["Ayşe Yıldız"] })];
    expect(mentionsOf(list, "Ayşe Yıldız")).toHaveLength(1);
  });

  it("cozulmus yorumu saymaz", () => {
    const list = [comment({ id: "a", mentions: ["Ayşe Yıldız"], resolved: true })];
    expect(mentionsOf(list, "Ayşe Yıldız")).toHaveLength(0);
  });

  it("turkce harflere duyarsizdir", () => {
    const list = [comment({ mentions: ["Ayşe Yıldız"] })];
    expect(mentionsOf(list, "ayse yildiz")).toHaveLength(1);
  });

  it("baskasini anan yorumu dondurmez", () => {
    const list = [comment({ mentions: ["Kaan Demir"] })];
    expect(mentionsOf(list, "Ayşe Yıldız")).toHaveLength(0);
  });
});

describe("openCountByTarget", () => {
  it("hedef basina acik yorum sayar", () => {
    const list = [
      comment({ id: "a", target: TORNA }),
      comment({ id: "b", target: TORNA }),
      comment({ id: "c", target: HAT }),
    ];
    expect(openCountByTarget(list)).toEqual({ "station:torna": 2, "factory:hat-1": 1 });
  });

  it("cozulmus yorumlari saymaz", () => {
    const list = [comment({ target: TORNA, resolved: true })];
    expect(openCountByTarget(list)).toEqual({});
  });
});

describe("splitMentions", () => {
  it("anmayi ayri parca yapar", () => {
    expect(splitMentions("@kaan bak")).toEqual([
      { text: "@kaan", isMention: true },
      { text: " bak", isMention: false },
    ]);
  });

  it("bastaki metni korur", () => {
    expect(splitMentions("bak @kaan")).toEqual([
      { text: "bak ", isMention: false },
      { text: "@kaan", isMention: true },
    ]);
  });

  it("anma yoksa tek parca doner", () => {
    expect(splitMentions("düz metin")).toEqual([
      { text: "düz metin", isMention: false },
    ]);
  });

  it("parcalar birlestiginde ozgun metni verir", () => {
    const text = "@ayse ve @kaan bu istasyona bakar mı?";
    expect(
      splitMentions(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });

  it("bos metinde bos dizi doner", () => {
    expect(splitMentions("")).toEqual([]);
  });
});
