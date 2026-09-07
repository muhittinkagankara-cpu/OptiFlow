/**
 * Operatör uygulamasının ekran modeli.
 *
 * Masaüstü kabuğunun `shell/navigation.ts` dosyasından ayrıdır çünkü gezinme
 * biçimi de ayrıdır: orada bir kenar çubuğu vardır, burada beş sekmeli bir alt
 * çubuk ve onun üzerine açılan ekranlar (görev detayı, hurda girişi, vardiya
 * özeti). İki modeli tek dosyada birleştirmek, birinin kuralını diğerine
 * sızdırırdı.
 */

import { Bell, Home, ListChecks, QrCode, User, type LucideIcon } from "lucide-react";

/** Alt çubuktaki beş sekme. */
export type OperatorTab = "home" | "tasks" | "scan" | "alerts" | "profile";

/**
 * Uygulamanın çizebileceği ekranlar.
 *
 * Sekmeler ile üzerine açılan ekranlar tek bir birleşimde durur; böylece "şu
 * an neredeyim?" sorusunun tek bir yanıtı olur ve iki ekran aynı anda etkin
 * sayılamaz.
 */
export type OperatorScreen =
  | { name: OperatorTab }
  | { name: "task"; taskId: string }
  | { name: "scrap"; taskId: string }
  | { name: "shift" };

export interface OperatorNavItem {
  id: OperatorTab;
  label: string;
  icon: LucideIcon;
}

export const OPERATOR_NAV: OperatorNavItem[] = [
  { id: "home", label: "Ana Sayfa", icon: Home },
  { id: "tasks", label: "Görevler", icon: ListChecks },
  { id: "scan", label: "Tara", icon: QrCode },
  { id: "alerts", label: "Bildirim", icon: Bell },
  { id: "profile", label: "Profil", icon: User },
];

/**
 * Bir ekranın hangi sekmeyi aydınlatacağı.
 *
 * Görev detayı ve hurda girişi "Görevler" sekmesinin devamıdır; vardiya özeti
 * ana sayfadan açılır. Aydınlatma yapılmasaydı operatör bu ekranlardayken alt
 * çubukta hiçbir sekme seçili görünmez ve kendini uygulamanın dışında sanırdı.
 */
export function tabOfScreen(screen: OperatorScreen): OperatorTab {
  switch (screen.name) {
    case "task":
    case "scrap":
      return "tasks";
    case "shift":
      return "home";
    default:
      return screen.name;
  }
}
