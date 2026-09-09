/**
 * Ortak yorumlar — fabrika ve istasyon notları.
 *
 * Yorumlar bu sürümde **yalnızca bu tarayıcıda** yaşar: backend'e yazan bir uç
 * yok. Arayüz bunu açıkça söyler; "ekip arkadaşınız bunu görecek" izlenimi
 * vermek, cevap beklenen bir soruyu görünmez kılardı.
 *
 * Anma (`@ad`) ayrıştırması saf bir işlevdir ve yalnızca **var olan** üyeleri
 * anma sayar: yazım hatası olan bir anma, birine ulaştığı sanılan ama
 * ulaşmayan bir mesaj demektir.
 */

import { normalize } from "./members";
import type { Comment, CommentTarget, Member } from "./types";

/** Bir yorumda tutulan en fazla karakter. */
export const MAX_COMMENT_LENGTH = 1_000;

/**
 * Metindeki anma adaylarını çıkarır.
 *
 * `@` ile başlayan ve harf/rakam/nokta/alt çizgi süren parçalar aday sayılır.
 * Türkçe harfler de kabul edilir — "@ayşe" yazan biri anma yapmıştır.
 */
export function extractMentionCandidates(text: string): string[] {
  const matches = text.match(/@[\p{L}\p{N}._-]+/gu) ?? [];
  return matches.map((match) => match.slice(1));
}

/**
 * Anmaları üye listesiyle eşler.
 *
 * Yalnızca eşleşenler döner. Eşleşmeyen bir anma sessizce yutulmaz; çağıran
 * `unknownMentions` ile hangilerinin boşa gittiğini öğrenebilir.
 */
export function resolveMentions(
  text: string,
  members: Member[],
): { mentions: string[]; unknown: string[] } {
  const candidates = extractMentionCandidates(text);
  const mentions: string[] = [];
  const unknown: string[] = [];

  for (const candidate of candidates) {
    const target = members.find(
      (member) =>
        normalize(member.name) === normalize(candidate) ||
        normalize(member.email.split("@")[0]) === normalize(candidate),
    );
    if (target === undefined) {
      unknown.push(candidate);
    } else if (!mentions.includes(target.name)) {
      mentions.push(target.name);
    }
  }

  return { mentions, unknown };
}

export interface NewComment {
  target: CommentTarget;
  authorName: string;
  text: string;
  atMs: number;
  members: Member[];
}

export interface CreateCommentResult {
  comment: Comment | null;
  /** Eşleşmeyen anmalar; kullanıcı uyarılır. */
  unknownMentions: string[];
  error: string | null;
}

/** Yorum oluşturur. */
export function createComment(
  existing: Comment[],
  input: NewComment,
): CreateCommentResult {
  const text = input.text.trim();

  if (text === "") {
    return { comment: null, unknownMentions: [], error: "Yorum boş olamaz." };
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    return {
      comment: null,
      unknownMentions: [],
      error: `Yorum ${MAX_COMMENT_LENGTH} karakteri aşamaz.`,
    };
  }

  const { mentions, unknown } = resolveMentions(text, input.members);

  return {
    comment: {
      id: `cmt-${input.atMs.toString(36)}-${existing.length}`,
      target: input.target,
      authorName: input.authorName,
      text,
      createdAtMs: input.atMs,
      mentions,
      resolved: false,
      resolvedBy: null,
      resolvedAtMs: null,
      origin: "local",
    },
    unknownMentions: unknown,
    error: null,
  };
}

/** Yorumu listeye ekler; en yeni başta. */
export function appendComment(comments: Comment[], comment: Comment): Comment[] {
  return [comment, ...comments];
}

/**
 * Yorumu çözüldü işaretler.
 *
 * Çözülen yorum **silinmez**: bir sorunun ne zaman ve kim tarafından
 * kapatıldığı, sorunun kendisi kadar önemlidir.
 */
export function resolveComment(
  comments: Comment[],
  id: string,
  resolvedBy: string,
  atMs: number,
): Comment[] {
  return comments.map((comment) =>
    comment.id === id && !comment.resolved
      ? { ...comment, resolved: true, resolvedBy, resolvedAtMs: atMs }
      : comment,
  );
}

/** Çözüldü işaretini kaldırır. */
export function reopenComment(comments: Comment[], id: string): Comment[] {
  return comments.map((comment) =>
    comment.id === id
      ? { ...comment, resolved: false, resolvedBy: null, resolvedAtMs: null }
      : comment,
  );
}

export function deleteComment(comments: Comment[], id: string): Comment[] {
  return comments.filter((comment) => comment.id !== id);
}

/** Bir hedefe ait yorumlar. */
export function commentsFor(
  comments: Comment[],
  target: { kind: CommentTarget["kind"]; id: string },
): Comment[] {
  return comments.filter(
    (comment) =>
      comment.target.kind === target.kind && comment.target.id === target.id,
  );
}

/** Açık (çözülmemiş) yorumlar. */
export function openComments(comments: Comment[]): Comment[] {
  return comments.filter((comment) => !comment.resolved);
}

/** Bir kişiyi anan açık yorumlar; "bana gelenler" listesi. */
export function mentionsOf(comments: Comment[], name: string): Comment[] {
  return comments.filter(
    (comment) =>
      !comment.resolved &&
      comment.mentions.some((mention) => normalize(mention) === normalize(name)),
  );
}

/** Hedef başına açık yorum sayısı; ekranlarda rozet olarak görünür. */
export function openCountByTarget(comments: Comment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const comment of openComments(comments)) {
    const key = `${comment.target.kind}:${comment.target.id}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Yorum metnini anmalar işaretlenmiş parçalara böler.
 *
 * Bileşen bu parçaları çizer; metni bileşende ayrıştırmak, aynı kuralın iki
 * yerde yaşaması demek olurdu.
 */
export function splitMentions(
  text: string,
): { text: string; isMention: boolean }[] {
  const parts: { text: string; isMention: boolean }[] = [];
  const pattern = /@[\p{L}\p{N}._-]+/gu;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), isMention: false });
    }
    parts.push({ text: match[0], isMention: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isMention: false });
  }

  return parts;
}
