/**
 * Ekip ve çok kullanıcılı çalışma şeması.
 *
 * Bu katmanın en önemli alanı `origin`'dir. OptiFlow'un bugün **gerçekten
 * okuyabildiği** tek kimlik bilgisi, oturum açmış kullanıcının kendisidir
 * (`MeResponse`: kullanıcı kimliği, e-posta, organizasyon). Üye listesi, roller,
 * davetler ve aktivite geçmişi için backend'de bir uç yok.
 *
 * Bu yüzden her kayıt nereden geldiğini taşır:
 *
 * - `account` — oturumdan okundu, gerçektir.
 * - `local`   — bu tarayıcıda oluşturuldu; gerçek bir kayıttır ama yalnızca bu
 *               cihazda yaşar ve arayüz bunu söyler.
 * - `fixture` — ürünün ne yaptığını göstermek için konmuş örnek veridir; her
 *               yerde "Örnek" etiketiyle görünür.
 *
 * Bir örnek üyeyi gerçek ekip arkadaşı gibi göstermek, bu sprintte
 * yapılabilecek en zararlı şey olurdu: yönetici, olmayan bir kişiye yetki
 * verdiğini sanır.
 */

/** Bir kaydın kaynağı. */
export type DataOrigin = "account" | "local" | "fixture";

export const ORIGIN_LABEL: Record<DataOrigin, string> = {
  account: "Hesap",
  local: "Bu cihaz",
  fixture: "Örnek",
};

/* -------------------------------------------------------------------------- */
/* Roller                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Kullanıcı rolleri.
 *
 * İlk beşi yazılım kurulumunun rolleridir; `shift_lead` ve `maintenance`
 * sahanın rolleridir. Sahada bir vardiya üç kişiye bölünür ve üçünün gördüğü
 * ekran farklıdır: operatör ölçüm girer, vardiya lideri hattı yönetir, bakım
 * cihaza dokunur.
 */
export type Role =
  | "owner"
  | "admin"
  | "engineer"
  | "shift_lead"
  | "maintenance"
  | "operator"
  | "viewer";

/**
 * Yetki genişliğine göre sıralı; karşılaştırmalar bu sırayı kullanır.
 *
 * Vardiya lideri bakımın üstündedir: hattı durdurma kararı bakımdan değil
 * üretimden çıkar. Bakım operatörün üstündedir: cihaza dokunabilen kişi,
 * ölçüm girenden geniş yetkilidir.
 */
export const ROLE_ORDER: Role[] = [
  "owner",
  "admin",
  "engineer",
  "shift_lead",
  "maintenance",
  "operator",
  "viewer",
];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Sahip",
  admin: "Yönetici",
  engineer: "Mühendis",
  shift_lead: "Vardiya Lideri",
  maintenance: "Bakım",
  operator: "Operatör",
  viewer: "İzleyici",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: "Her şeyi yapabilir; faturalandırma ve organizasyon ayarları dâhil.",
  admin: "Ekibi ve fabrikaları yönetir; faturalandırmaya dokunamaz.",
  engineer: "Model kurar, simülasyon çalıştırır, veri kaynaklarını bağlar.",
  shift_lead:
    "Vardiyayı yönetir: alarmı görür ve susturur, devri yapar; modeli değiştiremez.",
  maintenance:
    "Cihaza dokunur: bağlantıyı test eder, eşlemeyi düzeltir; ölçüm girmez.",
  operator: "Vardiya ekranlarını kullanır, ölçüm girer; modeli değiştiremez.",
  viewer: "Yalnızca görüntüler; hiçbir şeyi değiştiremez.",
};

/* -------------------------------------------------------------------------- */
/* Üyeler                                                                      */
/* -------------------------------------------------------------------------- */

export type MemberStatus = "active" | "invited" | "suspended";

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Aktif",
  invited: "Davet edildi",
  suspended: "Askıda",
};

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  /** Son etkinlik anı (ms); bilinmiyorsa `null` — sıfır değil. */
  lastActiveAtMs: number | null;
  origin: DataOrigin;
}

/* -------------------------------------------------------------------------- */
/* Davetler                                                                    */
/* -------------------------------------------------------------------------- */

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "Bekliyor",
  accepted: "Kabul edildi",
  revoked: "İptal edildi",
  expired: "Süresi doldu",
};

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  /** Bağlantıda geçen belirteç. */
  token: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: InvitationStatus;
  /**
   * Davet e-postası gönderildi mi?
   *
   * Bu sürümde **her zaman `false`**: e-posta altyapısı yok ve gönderilmiş gibi
   * göstermek, davetin ulaşmadığını günler sonra fark ettirirdi. Bağlantı elle
   * kopyalanıp iletilir.
   */
  emailSent: boolean;
  origin: DataOrigin;
}

/* -------------------------------------------------------------------------- */
/* Aktivite                                                                    */
/* -------------------------------------------------------------------------- */

export type ActivityKind =
  | "factory_created"
  | "simulation_run"
  | "report_downloaded"
  | "validation_saved"
  | "member_added"
  | "role_changed"
  | "invitation_created"
  | "comment_added";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  factory_created: "Fabrika oluşturuldu",
  simulation_run: "Simülasyon çalıştırıldı",
  report_downloaded: "Rapor indirildi",
  validation_saved: "Doğrulama yapıldı",
  member_added: "Üye eklendi",
  role_changed: "Rol değişti",
  invitation_created: "Davet oluşturuldu",
  comment_added: "Yorum eklendi",
};

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  atMs: number;
  /** Eylemi yapan kişi; bilinmiyorsa `null`. */
  actorName: string | null;
  /** Ne üzerinde yapıldı ("Kuzey Hat 1", "Torna"). */
  subject: string | null;
  /** Ek açıklama; yoksa `null`. */
  detail: string | null;
  origin: DataOrigin;
}

/* -------------------------------------------------------------------------- */
/* Yorumlar                                                                    */
/* -------------------------------------------------------------------------- */

/** Yorumun bağlandığı yer. */
export type CommentTargetKind = "factory" | "station";

export interface CommentTarget {
  kind: CommentTargetKind;
  /** Fabrika ya da istasyon kimliği. */
  id: string;
  /** Ekranda görünen ad. */
  label: string;
}

export interface Comment {
  id: string;
  target: CommentTarget;
  authorName: string;
  text: string;
  createdAtMs: number;
  /** Metinde geçen `@ad` anmaları. */
  mentions: string[];
  resolved: boolean;
  /** Çözüldü işaretini kimin koyduğu; çözülmediyse `null`. */
  resolvedBy: string | null;
  resolvedAtMs: number | null;
  origin: DataOrigin;
}

/* -------------------------------------------------------------------------- */
/* Eşzamanlı çalışma                                                           */
/* -------------------------------------------------------------------------- */

export type PresenceActivity = "editing" | "viewing" | "running";

export const PRESENCE_LABEL: Record<PresenceActivity, string> = {
  editing: "düzenliyor",
  viewing: "görüntülüyor",
  running: "koşum alıyor",
};

export interface PresenceEntry {
  id: string;
  name: string;
  /** Hangi ekranda. */
  screen: string;
  activity: PresenceActivity;
  /** Kaydın alındığı an. */
  atMs: number;
  /**
   * Bu kayıt canlı bir bağlantıdan mı geliyor?
   *
   * Bu sürümde **her zaman `false`**. Gerçek eşzamanlılık bir WebSocket ya da
   * sunucu tarafı bir yoklama gerektirir; ikisi de yok. Arayüz her listede
   * "Canlı değil" etiketi taşır.
   */
  isLive: boolean;
  origin: DataOrigin;
}

/* -------------------------------------------------------------------------- */
/* Organizasyon ayarları                                                       */
/* -------------------------------------------------------------------------- */

export interface OrgSettings {
  /** Organizasyon adı; oturumdan gelir ve bu sürümde **değiştirilemez**. */
  name: string;
  logoDataUrl: string | null;
  timezone: string;
  currency: string;
  /** Varsayılan vardiya süresi (saat). */
  shiftHours: number;
  /** Günlük vardiya sayısı. */
  shiftsPerDay: number;
  notifyOnSimulation: boolean;
  notifyOnValidation: boolean;
  notifyOnMemberChange: boolean;
}

/**
 * Bir ayarın gerçekten kaydedilip kaydedilemediği.
 *
 * `local` olanlar bu tarayıcıya yazılır ve geri okunur — gerçekten kaydedilir.
 * `readonly` olanlar oturumdan gelir, değiştirilemez. `unavailable` olanlar için
 * ne bir uç ne de bir depo var; arayüz bunları kapalı gösterir ve nedenini yazar.
 */
export type SettingPersistence = "local" | "readonly" | "unavailable";

export interface SettingField {
  key: keyof OrgSettings;
  label: string;
  persistence: SettingPersistence;
  /** Kaydedilemiyorsa nedeni. */
  note: string | null;
}

/* -------------------------------------------------------------------------- */
/* Çalışma alanı özeti                                                         */
/* -------------------------------------------------------------------------- */

/** Ekranda gösterilen tek bir ölçü. */
export interface WorkspaceStat {
  label: string;
  /** Okunabilen değer; okunamıyorsa `null` → "Doğrulanmadı". */
  value: string | null;
  origin: DataOrigin | null;
  /** Değerin nereden geldiği ya da neden okunamadığı. */
  note: string;
}
