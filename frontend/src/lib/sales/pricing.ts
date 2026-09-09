/**
 * Teklif motoru.
 *
 * Fiyat bir **karardır**, biçimlendirme değil: hangi firmanın hangi pakete
 * gireceği ve ne ödeyeceği satışın en tartışmalı noktasıdır. Bu yüzden kural
 * burada durur, sınanır ve tek yerden değişir. Teklif sayfası ile PDF aynı
 * işlevi çağırır; ekranda gördüğü rakamla müşteriye giden rakamın ayrışması
 * mümkün değildir.
 *
 * Bileşenlerde hiçbir tutar yazılı değildir. Bir fiyat değişikliği bu dosyada
 * tek satırlık bir düzenlemedir.
 */

import type { PlanDefinition, PlanId, Quote, QuoteInput } from "./types";

/**
 * Üç paketin sabit tanımı.
 *
 * Sınırlar (`maxMachines`, `maxEmployees`) üst sınırdır: ikisinden **biri**
 * aşıldığında bir üst pakete geçilir. "Ve" ile bağlansaydı, on beş makinesi
 * olan üç kişilik bir atölye Starter'da kalır ve altyapı maliyetimizi
 * karşılamazdı.
 */
export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    label: "Starter",
    monthlyBase: 4_500,
    monthlyPerMachine: 350,
    setupFee: 12_000,
    support: "E-posta desteği, 2 iş günü yanıt",
    features: [
      "Süreç modelleme ve simülasyon",
      "Darboğaz ve OEE analizi",
      "Yönetici PDF raporu",
      "Tek kullanıcı",
    ],
    maxMachines: 10,
    maxEmployees: 25,
  },
  growth: {
    id: "growth",
    label: "Growth",
    monthlyBase: 9_500,
    monthlyPerMachine: 300,
    setupFee: 28_000,
    support: "Telefon ve e-posta, aynı gün yanıt",
    features: [
      "Starter'daki her şey",
      "Finansal kayıp analizi ve ısı haritası",
      "Canlı üretim merkezi",
      "Mobil operatör ekranı",
      "10 kullanıcıya kadar",
    ],
    maxMachines: 40,
    maxEmployees: 150,
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    monthlyBase: 22_000,
    // Büyük tesislerde makine başına birim maliyet düşer; ölçek indirimi
    // pazarlıkta zaten verilecekse, listede olması daha dürüsttür.
    monthlyPerMachine: 220,
    setupFee: 65_000,
    support: "Özel müşteri temsilcisi, 4 saat yanıt taahhüdü",
    features: [
      "Growth'taki her şey",
      "MES / OPC-UA / MQTT bağlantısı",
      "Çoklu tesis ve rol yönetimi",
      "Sınırsız kullanıcı",
      "Yerinde kurulum ve eğitim",
    ],
    // Üst paket olduğu için sınırları pratik olarak sonsuzdur; alan yine de
    // doldurulur ki paket tanımları aynı şekli taşısın.
    maxMachines: Number.POSITIVE_INFINITY,
    maxEmployees: Number.POSITIVE_INFINITY,
  },
};

/** Paketlerin küçükten büyüğe sırası. */
export const PLAN_ORDER: PlanId[] = ["starter", "growth", "enterprise"];

/**
 * Girdiye uyan en küçük paketi seçer.
 *
 * Makine **ya da** çalışan sayısı bir paketin sınırını aşıyorsa bir üste
 * geçilir. Hiçbiri yetmiyorsa Enterprise'ta kalınır.
 */
export function selectPlan(input: QuoteInput): PlanDefinition {
  const machines = normalize(input.machineCount);
  const employees = normalize(input.employeeCount);

  for (const id of PLAN_ORDER) {
    const plan = PLANS[id];
    if (machines <= plan.maxMachines && employees <= plan.maxEmployees) {
      return plan;
    }
  }
  return PLANS.enterprise;
}

/**
 * Belirli bir paketin aylık ücreti.
 *
 * `buildQuote` paketi kendisi seçer; abonelik ekranı ise **her paketin** fiyatını
 * yan yana göstermek zorundadır. İkisi de aynı formülü ve aynı sabitleri
 * kullanır — ekranın kendi çarpımını yapması, teklifte ve üründe farklı rakam
 * görünmesine yol açardı.
 */
export function monthlyFor(planId: PlanId, machineCount: number): number {
  const plan = PLANS[planId];
  return plan.monthlyBase + normalize(machineCount) * plan.monthlyPerMachine;
}

/**
 * Bir firma için teklif üretir.
 *
 * Aylık ücret taban artı makine başınadır. Sıfır makineli bir kayıt için
 * yalnızca taban ücret çıkar — makine sayısını henüz öğrenmemiş bir satışçının
 * eline "₺0" yazan bir teklif geçmemelidir.
 */
export function buildQuote(input: QuoteInput): Quote {
  const plan = selectPlan(input);
  const machines = normalize(input.machineCount);
  const employees = normalize(input.employeeCount);

  const monthly = plan.monthlyBase + machines * plan.monthlyPerMachine;

  return {
    plan,
    monthly,
    setupFee: plan.setupFee,
    firstYearTotal: monthly * 12 + plan.setupFee,
    rationale: rationaleFor(plan, machines, employees),
  };
}

/** Paketin neden seçildiğini tek cümleyle anlatır. */
function rationaleFor(
  plan: PlanDefinition,
  machines: number,
  employees: number,
): string {
  const scale = `${machines} makine ve ${employees} çalışan`;

  if (plan.id === "enterprise") {
    return `${scale} için Enterprise öneriliyor: bu ölçekte MES bağlantısı ve çoklu tesis yönetimi gerekiyor.`;
  }
  if (plan.id === "growth") {
    return `${scale} için Growth öneriliyor: finansal kayıp analizi ve canlı üretim ekranı bu ölçekte karşılığını veriyor.`;
  }
  return `${scale} için Starter yeterli: modelleme, darboğaz analizi ve yönetici raporu kapsanıyor.`;
}

/**
 * Sayısal girdiyi güvene alır.
 *
 * Form alanları boş bırakılabilir ve `NaN` üretebilir; negatif bir makine
 * sayısı aylık ücreti taban ücretin altına indirirdi.
 */
function normalize(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * İlk ay tahmini tasarrufu.
 *
 * Yalnızca demoda ölçülmüş bir aylık kayıp varsa hesaplanır ve o kaybın
 * kurtarılabilir sayılan payı üzerinden verilir. Kayıp bilinmiyorsa `null`
 * döner — teklife uydurma bir tasarruf yazmak, ilk faturada tartışma çıkarır.
 */
export const RECOVERABLE_SHARE = 0.35;

export function estimateFirstMonthSaving(
  monthlyLoss: number | null,
  monthly: number,
): { saving: number; net: number } | null {
  if (monthlyLoss === null || !Number.isFinite(monthlyLoss) || monthlyLoss <= 0) {
    return null;
  }
  const saving = Math.round(monthlyLoss * RECOVERABLE_SHARE);
  return { saving, net: saving - monthly };
}
