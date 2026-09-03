/**
 * Kimlik doğrulama — Supabase Auth üzerinden oturum açma, kapatma, izleme.
 *
 * Kullanıcı bu uygulamada hiç saklanmaz: parola, oturum, token yenileme
 * tamamen Supabase'in sorumluluğudur. Bu dosya yalnızca ince bir sarmalayıcı
 * (wrapper) sağlar — `App.tsx` doğrudan `@supabase/supabase-js`'e bağımlı
 * olmasın diye. İleride Supabase'in kendisi değişse (ör. self-hosted GoTrue'ya
 * geçilse) yalnızca bu dosya güncellenir.
 *
 * Oturum kalıcılığı Supabase'in istemci kitaplığının kendi işidir
 * (`persistSession: true`, varsayılan): erişim ve yenileme token'ları
 * tarayıcının kendi deposunda tutulur ve sayfa yenilendiğinde
 * `getCurrentSession()` bunları geri okur. Ayrı bir kalıcılık katmanı
 * yazılmadı çünkü Supabase'in kendi mekanizması zaten bunu çözüyor ve
 * tekrar yazmak, iki yerde aynı sorunu (token yenileme, süre dolumu) çözmeye
 * çalışmak demek olurdu.
 */

import { createClient, type Session } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

/**
 * Ortam değişkenleri tanımlı değilse kimlik doğrulama hiç çalışamaz.
 *
 * Sessizce geçersiz bir istemci kurmak yerine bunu açıkça bildirmek
 * bilinçlidir: aksi hâlde hata, "Kimlik doğrulama sunucusuna ulaşılamıyor"
 * gibi anlaşılmaz bir ağ hatası olarak çok sonra ortaya çıkardı.
 */
export const isAuthConfigured: boolean = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const supabase = isAuthConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function requireClient() {
  if (!supabase) {
    throw new Error(
      "Kimlik dogrulama yapilandirilmamis: VITE_SUPABASE_URL ve " +
        "VITE_SUPABASE_ANON_KEY ortam degiskenleri tanimli olmali.",
    );
  }
  return supabase;
}

/** Normalleştirilmiş kimlik doğrulama hatası. */
export class AuthClientError extends Error {}

/**
 * E-posta ve parolayla oturum açar.
 *
 * Raises: AuthClientError — kimlik bilgileri hatalıysa ya da yapılandırma
 * eksikse.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new AuthClientError(translateAuthError(error.message));
  }
}

/**
 * Yeni bir hesap açar.
 *
 * Organizasyon burada oluşturulmaz — bu bilinçlidir. Organizasyon, ilk
 * doğrulanmış API çağrısında (`GET /api/me`) backend tarafından kendiliğinden
 * kurulur (`get_current_org` bağımlılığı). İki ayrı "hesap aç" ve
 * "organizasyon kur" adımı olsaydı, ikinci adımı yarıda bırakan bir kullanıcı
 * oturumu olan ama organizasyonu olmayan bir durumda kalırdı.
 */
export async function signUp(email: string, password: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new AuthClientError(translateAuthError(error.message));
  }
}

export async function signOut(): Promise<void> {
  const client = requireClient();
  await client.auth.signOut();
}

/** Şu anki oturumu döndürür; oturum yoksa `null`. */
export async function getCurrentSession(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Oturum durumu her değiştiğinde (giriş, çıkış, token yenileme) çağrılır.
 *
 * Aboneliği iptal eden bir işlev döndürür; bileşen kaldırıldığında
 * çağrılmalıdır, aksi hâlde artık var olmayan bir bileşenin state'ini
 * güncellemeye çalışan bir dinleyici sızıntısı oluşur.
 */
export function onAuthStateChange(
  callback: (session: Session | null) => void,
): () => void {
  if (!supabase) {
    return () => {};
  }
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}

/**
 * API isteklerine eklenecek erişim token'ını döndürür; oturum yoksa `null`.
 *
 * `apiClient.ts` her isteği göndermeden önce bunu çağırır. Token'ı ayrıca bir
 * modül değişkeninde tutmak yerine her seferinde Supabase'in kendi oturum
 * önbelleğinden okunması bilinçlidir: token arka planda yenilendiğinde
 * (Supabase bunu kendiliğinden yapar) ayrı bir senkronizasyon kodu yazmaya
 * gerek kalmaz.
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.access_token ?? null;
}

/**
 * Supabase'in İngilizce hata mesajlarını kullanıcıya gösterilecek Türkçe
 * metne çevirir.
 *
 * Tam eşleşme aranır, alt dize değil: Supabase'in mesaj biçimini değiştirmesi
 * durumunda çeviri sessizce atlanır ve ham (İngilizce) mesaj gösterilir —
 * bu, yanlış bir çeviri göstermekten daha iyidir.
 */
const KNOWN_ERRORS: Record<string, string> = {
  "Invalid login credentials": "E-posta veya parola hatalı.",
  "User already registered": "Bu e-posta ile zaten bir hesap var.",
  "Email not confirmed": "E-posta adresiniz henüz doğrulanmadı.",
  "Password should be at least 6 characters.": "Parola en az 6 karakter olmalı.",
};

function translateAuthError(message: string): string {
  return KNOWN_ERRORS[message] ?? message;
}
