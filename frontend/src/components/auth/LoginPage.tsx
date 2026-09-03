/**
 * Oturum açma / hesap oluşturma ekranı.
 *
 * Tek form iki modu paylaşır (giriş / kayıt); ayrı sayfalara bölünmedi çünkü
 * ikisi arasındaki tek fark bir düğme etiketi ve bir doğrulama çağrısıdır.
 * Organizasyon burada kurulmaz — kayıt olduktan sonra ilk API çağrısında
 * (`GET /api/me`) backend tarafından kendiliğinden oluşturulur; bu ekranın
 * tek işi kimlik doğrulamaktır.
 */

import { useState, type FormEvent } from "react";
import { AuthClientError, signInWithPassword, signUp } from "../../lib/authClient";
import { Spinner } from "../wizard/WizardStep3_Confirmation";

type Mode = "sign-in" | "sign-up";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedUpMessage, setSignedUpMessage] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSignedUpMessage(false);
    setIsSubmitting(true);
    try {
      if (mode === "sign-in") {
        await signInWithPassword(email, password);
        // Basarili girişten sonra hicbir sey yapmaya gerek yok: App.tsx
        // `onAuthStateChange` ile dinliyor ve oturum degisikligini kendisi
        // yakalayip ana uygulamaya gececek.
      } else {
        await signUp(email, password);
        // Supabase varsayilan olarak e-posta dogrulamasi ister; bu durumda
        // oturum hemen acilmaz. Kullaniciya ne olacagini soylemek, sessiz
        // bir "hicbir sey olmadi" izleniminden iyidir.
        setSignedUpMessage(true);
      }
    } catch (cause) {
      setError(
        cause instanceof AuthClientError
          ? cause.message
          : "Beklenmeyen bir hata olustu. Lutfen tekrar deneyin.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            S
          </span>
          <h1 className="text-lg font-semibold text-slate-900">
            {mode === "sign-in" ? "Giriş yapın" : "Hesap oluşturun"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Üretim simülasyonlarınıza ve fabrikalarınıza erişin.
          </p>
        </div>

        {signedUpMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Hesabınız oluşturuldu. E-postanıza gelen bağlantıyla doğruladıktan
            sonra giriş yapabilirsiniz.
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                E-posta
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Parola
              </label>
              <input
                id="login-password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting && <Spinner />}
              {mode === "sign-in" ? "Giriş yap" : "Hesap oluştur"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setError(null);
            setSignedUpMessage(false);
          }}
          className="mt-4 w-full text-center text-sm text-slate-600 hover:text-brand-700 focus:outline-none"
        >
          {mode === "sign-in"
            ? "Hesabınız yok mu? Kaydolun"
            : "Zaten hesabınız var mı? Giriş yapın"}
        </button>
      </div>
    </div>
  );
}
