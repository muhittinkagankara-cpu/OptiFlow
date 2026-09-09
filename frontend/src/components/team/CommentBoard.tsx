/**
 * Ortak yorumlar — fabrika ve istasyon notları.
 *
 * Yorumlar yalnızca bu tarayıcıda yaşar ve ekran bunu yazar. "Ekip arkadaşınız
 * görecek" izlenimi vermek, yanıt beklenen bir soruyu görünmez kılardı.
 *
 * Anma (`@ad`) çözümü `resolveMentions` içindedir; eşleşmeyen bir anma sessizce
 * yutulmaz, formun altında uyarı olarak görünür.
 */

import { useState } from "react";
import { CheckCircle2, MessageSquare, RotateCcw } from "lucide-react";
import {
  ORIGIN_LABEL,
  commentsFor,
  openComments,
  relativeTime,
  splitMentions,
  type Comment,
  type CommentTarget,
} from "../../lib/team";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { ORIGIN_TONE } from "./teamStyles";

interface CommentBoardProps {
  comments: Comment[];
  /** Yorum yazılabilecek yerler: fabrika ve istasyonlar. */
  targets: CommentTarget[];
  nowMs: number;
  canComment: boolean;
  canResolve: boolean;
  denialReason: string;
  onAdd: (target: CommentTarget, text: string) => { unknownMentions: string[]; error: string | null };
  onResolve: (id: string) => void;
  onReopen: (id: string) => void;
}

export function CommentBoard({
  comments,
  targets,
  nowMs,
  canComment,
  canResolve,
  denialReason,
  onAdd,
  onResolve,
  onReopen,
}: CommentBoardProps) {
  const [targetKey, setTargetKey] = useState(
    () => `${targets[0]?.kind ?? "factory"}:${targets[0]?.id ?? ""}`,
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);

  const target =
    targets.find((item) => `${item.kind}:${item.id}` === targetKey) ?? targets[0];
  const visible = target === undefined ? [] : commentsFor(comments, target);

  function submit() {
    if (target === undefined) {
      return;
    }
    const result = onAdd(target, text);
    setError(result.error);
    setUnknown(result.unknownMentions);
    if (result.error === null) {
      setText("");
    }
  }

  return (
    <div>
      <SectionTitle
        title="Yorumlar"
        description={`${openComments(comments).length} açık not.`}
        action={<Badge tone="warning">Yalnızca bu cihazda</Badge>}
      />

      <Card className="p-4">
        <div className="flex flex-col gap-2">
          <select
            value={targetKey}
            onChange={(event) => setTargetKey(event.target.value)}
            aria-label="Yorumun bağlanacağı yer"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
          >
            {targets.map((item) => (
              <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                {item.label}
              </option>
            ))}
          </select>

          <textarea
            value={text}
            disabled={!canComment}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="Notunuzu yazın. Bir kişiyi anmak için @ad kullanın."
            aria-label="Yorum metni"
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Yorumlar sunucuya gönderilmez; yalnızca bu tarayıcıda saklanır.
            </p>
            <Button
              variant="primary"
              size="sm"
              icon={MessageSquare}
              disabled={!canComment}
              title={canComment ? "Yorumu kaydet" : denialReason}
              onClick={submit}
            >
              Yorum ekle
            </Button>
          </div>
        </div>

        {error !== null && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
            {error}
          </p>
        )}

        {unknown.length > 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            Bu adlar ekipte bulunamadı: {unknown.join(", ")}. Anma kimseye
            ulaşmadı.
          </p>
        )}
      </Card>

      <div className="mt-3">
        {visible.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Bu yerde henüz not yok"
            description="Bir istasyonda gördüğünüz sapmayı buraya yazın; ölçüm alan kişiyi @ad ile anabilirsiniz."
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((comment) => (
              <li key={comment.id}>
                <Card className="p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <span>{comment.authorName}</span>
                      <Badge tone={ORIGIN_TONE[comment.origin]}>
                        {ORIGIN_LABEL[comment.origin]}
                      </Badge>
                      {comment.resolved && <Badge tone="good">Çözüldü</Badge>}
                    </p>
                    <span className="text-xs text-slate-400">
                      {relativeTime(comment.createdAtMs, nowMs)}
                    </span>
                  </div>

                  <p className="mt-1 break-words text-sm text-slate-700">
                    {splitMentions(comment.text).map((part, index) => (
                      <span
                        key={`${comment.id}-${index}`}
                        className={
                          part.isMention
                            ? "font-semibold text-brand-700"
                            : undefined
                        }
                      >
                        {part.text}
                      </span>
                    ))}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      {comment.resolved
                        ? `${comment.resolvedBy ?? "Bilinmeyen"} kapattı`
                        : `${comment.mentions.length} kişi anıldı`}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={comment.resolved ? RotateCcw : CheckCircle2}
                      disabled={!canResolve}
                      title={canResolve ? "Durumu değiştir" : denialReason}
                      onClick={() =>
                        comment.resolved
                          ? onReopen(comment.id)
                          : onResolve(comment.id)
                      }
                    >
                      {comment.resolved ? "Yeniden aç" : "Çözüldü işaretle"}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
