/**
 * Ayarlar — menüde yer alan, henüz doldurulmamış bölüm.
 *
 * Gerçek işlev taşımaz ve bunu açıkça söyler. Menüde görünüp tıklanınca boş
 * bir ekran açan bir bölüm, kullanıcıya ürünün bozuk olduğunu düşündürürdü;
 * "bu bölüm henüz hazır değil" demek daha dürüsttür.
 *
 * Raporlar ekranı buradan çıktı: artık gerçek bir işlevi var ve kendi
 * dosyasında yaşıyor (`components/reports/ReportsPage.tsx`).
 */

import { Settings as SettingsIcon } from "lucide-react";
import { Card, EmptyState, MetricRow } from "../ui/Primitives";

export function SettingsPage({
  orgName,
  userEmail,
}: {
  orgName: string;
  userEmail: string | null;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Ayarlar
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Hesabınız ve organizasyonunuz.
        </p>
      </div>

      <Card className="p-5" index={0}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Hesap</h3>
        <MetricRow label="E-posta" value={userEmail ?? "—"} />
        <MetricRow label="Organizasyon" value={orgName} />
        <MetricRow label="Tema" value="Koyu (varsayılan)" />
      </Card>

      <div className="mt-4">
        <EmptyState
          icon={SettingsIcon}
          title="Ayarlar henüz düzenlenemiyor"
          description="Organizasyon adı, kullanıcı davetleri ve tema seçimi sonraki sürümde bu ekrana gelecek."
        />
      </div>
    </div>
  );
}
