/**
 * Ekip çalışma alanının durumu.
 *
 * Kancanın tek işi parçaları bir araya getirmektir: oturumdan gelen **gerçek**
 * kullanıcı, bu tarayıcıda oluşturulmuş **yerel** kayıtlar ve ürünün ne yaptığını
 * gösteren **örnek** veriler. Üçü tek listede toplanır ama her kayıt kendi
 * `origin` alanını korur — karar ve etiketleme mantığının tamamı `lib/team`
 * altındadır, burada yalnızca çağrılır.
 *
 * Örnek veriler yalnızca **bellekte** yaşar: depoya yazılmazlar (`storage.ts`
 * onları süzer), böylece bir sonraki açılışta gerçek sanılmaları mümkün değildir.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applySavable,
  createComment,
  createInvitation,
  memberFromAccount,
  recallComments,
  recallInvitations,
  recallSettings,
  rememberComments,
  rememberInvitations,
  rememberSettings,
  removeMember as removeMemberFrom,
  resolveComment as resolveCommentIn,
  reopenComment as reopenCommentIn,
  revokeInvitation,
  sampleActivity,
  sampleComments,
  sampleInvitations,
  sampleMembers,
  samplePresence,
  setRole as setRoleIn,
  normalizePresence,
  upsertMember,
  workspaceStats,
  type Comment,
  type CommentTarget,
  type Invitation,
  type Member,
  type OrgSettings,
  type Role,
} from "../../lib/team";
import { appendEvent } from "../../lib/team";

export interface TeamWorkspaceInput {
  userId: string;
  email: string | null;
  orgName: string;
  /** Sunucudan okunan fabrika sayısı; okunamadıysa `null`. */
  factoryCount: number | null;
  machineCount: number;
  connectorCount: number;
}

export function useTeamWorkspace(input: TeamWorkspaceInput) {
  /*
   * Saat bir kez okunur ve dakikada bir tazelenir. Her render'da okunsaydı,
   * aynı kaydın göreli zamanı iki render arasında değişir ve testlenemezdi.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /*
   * Bir kayıt oluşturulduğunda saat de ileri alınır.
   *
   * Tarayıcıda görüldü: yeni oluşturulan yedi günlük bir davet "8 gün geçerli"
   * yazıyordu. Neden, ekranın saatinin dakikada bir tazelenmesiydi — kayıt
   * gerçek "şimdi" ile yazılıyor, kalan süre ise en fazla bir dakika geride
   * kalmış bir saate göre hesaplanıyordu ve yukarı yuvarlama farkı bir güne
   * çeviriyordu.
   */

  /** Oturumdaki kullanıcı: listedeki tek gerçek üye. */
  const account = useMemo(
    () => memberFromAccount({ user_id: input.userId, email: input.email }),
    [input.userId, input.email],
  );

  /*
   * Örnek üyeler durumda tutulur; oturumdaki gerçek kullanıcı ise **render
   * sırasında** listeye katılır. Bir etki ile eklenseydi, oturum her
   * tazelendiğinde ikinci bir render turu başlar ve listedeki gerçek kayıt bir
   * an için eksik görünürdü.
   */
  const [otherMembers, setOtherMembers] = useState<Member[]>(() =>
    sampleMembers(Date.now()),
  );
  const members = useMemo(
    () => upsertMember(otherMembers, account),
    [otherMembers, account],
  );

  const [invitations, setInvitations] = useState<Invitation[]>(() => [
    ...recallInvitations(),
    ...sampleInvitations(Date.now()),
  ]);

  const [comments, setComments] = useState<Comment[]>(() => [
    ...recallComments(),
    ...sampleComments(Date.now()),
  ]);

  const [events, setEvents] = useState(() => sampleActivity(Date.now()));

  const presence = useMemo(() => normalizePresence(samplePresence(nowMs)), [nowMs]);

  const [savedSettings, setSavedSettings] = useState<OrgSettings>(() =>
    recallSettings(input.orgName),
  );

  /*
   * Organizasyon adı her zaman oturumdan gelir ve depodaki değerin üzerine
   * render sırasında yazılır: eski bir ad geri yüklenirse, organizasyon adı
   * değiştiğinde ekranda eskisi görünürdü.
   */
  const settings = useMemo<OrgSettings>(
    () => ({ ...savedSettings, name: input.orgName }),
    [savedSettings, input.orgName],
  );

  const stats = useMemo(
    () =>
      workspaceStats({
        orgName: input.orgName,
        factoryCount: input.factoryCount,
        members,
        events,
        nowMs,
      }),
    [input.orgName, input.factoryCount, members, events, nowMs],
  );

  /* ---------------------------------------------------------------------- */
  /* Eylemler                                                                */
  /* ---------------------------------------------------------------------- */

  const invite = useCallback(
    (email: string, role: Role) => {
      const atMs = Date.now();
      setNowMs(atMs);
      const result = createInvitation(invitations, { email, role, nowMs: atMs });
      if (result.invitation !== null) {
        const next = [result.invitation, ...invitations];
        setInvitations(next);
        rememberInvitations(next);
        setEvents((current) =>
          appendEvent(current, {
            kind: "invitation_created",
            atMs,
            actorName: account.name,
            subject: result.invitation?.email ?? null,
            detail: "E-posta gönderilmedi; bağlantı elle iletilir.",
          }),
        );
      }
      return result;
    },
    [invitations, account.name],
  );

  const revoke = useCallback(
    (id: string) => {
      const next = revokeInvitation(invitations, id);
      setInvitations(next);
      rememberInvitations(next);
    },
    [invitations],
  );

  const changeRole = useCallback(
    (id: string, role: Role) => {
      setNowMs(Date.now());
      const target = members.find((member) => member.id === id);
      setOtherMembers((current) => setRoleIn(current, id, role));
      setEvents((current) =>
        appendEvent(current, {
          kind: "role_changed",
          atMs: Date.now(),
          actorName: account.name,
          subject: target?.name ?? id,
          detail: null,
        }),
      );
    },
    [members, account.name],
  );

  const removeMember = useCallback((id: string) => {
    setOtherMembers((current) => removeMemberFrom(current, id));
  }, []);

  const addComment = useCallback(
    (target: CommentTarget, text: string) => {
      const atMs = Date.now();
      setNowMs(atMs);
      const result = createComment(comments, {
        target,
        authorName: account.name,
        text,
        atMs,
        members,
      });
      if (result.comment !== null) {
        const next = [result.comment, ...comments];
        setComments(next);
        rememberComments(next);
        setEvents((current) =>
          appendEvent(current, {
            kind: "comment_added",
            atMs,
            actorName: account.name,
            subject: target.label,
            detail: null,
          }),
        );
      }
      return result;
    },
    [comments, members, account.name],
  );

  const resolveComment = useCallback(
    (id: string) => {
      const atMs = Date.now();
      setNowMs(atMs);
      const next = resolveCommentIn(comments, id, account.name, atMs);
      setComments(next);
      rememberComments(next);
    },
    [comments, account.name],
  );

  const reopenComment = useCallback(
    (id: string) => {
      const next = reopenCommentIn(comments, id);
      setComments(next);
      rememberComments(next);
    },
    [comments],
  );

  const saveSettings = useCallback(
    (next: Partial<OrgSettings>) => {
      const applied = applySavable(settings, next);
      setSavedSettings(applied);
      rememberSettings(applied);
      return applied;
    },
    [settings],
  );

  return {
    nowMs,
    account,
    members,
    invitations,
    comments,
    events,
    presence,
    settings,
    stats,
    usage: {
      users: members.filter((member) => member.origin !== "fixture").length,
      factories: input.factoryCount ?? 0,
      connectors: input.connectorCount,
    },
    machineCount: input.machineCount,
    invite,
    revoke,
    changeRole,
    removeMember,
    addComment,
    resolveComment,
    reopenComment,
    saveSettings,
  };
}
