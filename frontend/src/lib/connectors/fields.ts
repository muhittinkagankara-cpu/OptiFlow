/**
 * Bağlantı ayar şemaları.
 *
 * Her protokolün formu **veriden** çizilir, elle yazılmaz. Beş form beş ayrı
 * bileşende yazılsaydı, yeni bir alan eklendiğinde doğrulama, varsayılan değer
 * ve ekran üçü ayrı yerde güncellenmek zorunda kalır ve biri unutulurdu.
 *
 * Parola ve anahtar alanları `secret` işaretlidir: bu alanlar ekranda gizlenir,
 * olay günlüğüne ve hata metinlerine hiçbir zaman yazılmaz. Bir bağlantı
 * hatasının ekran görüntüsünün ne kadar kolay paylaşıldığı düşünülürse, bu
 * ayrımın maliyeti tek satır, atlanmasının maliyeti bir sızıntıdır.
 */

import {
  CONNECTOR_LABEL,
  type ConnectorField,
  type ConnectorKind,
  type ConnectorSettings,
} from "./types";

const OPCUA_FIELDS: ConnectorField[] = [
  {
    key: "endpoint",
    label: "Endpoint",
    type: "text",
    required: true,
    placeholder: "opc.tcp://192.168.1.10:4840",
    hint: "Denetleyicinin OPC UA sunucu adresi.",
  },
  {
    key: "securityPolicy",
    label: "Güvenlik politikası",
    type: "select",
    required: true,
    options: [
      { value: "None", label: "None (şifresiz)" },
      { value: "Basic256Sha256", label: "Basic256Sha256" },
      { value: "Aes256Sha256RsaPss", label: "Aes256Sha256RsaPss" },
    ],
    hint: "Üretim hattında şifresiz bağlantı önerilmez.",
  },
  { key: "username", label: "Kullanıcı adı", type: "text", required: false },
  {
    key: "password",
    label: "Parola",
    type: "password",
    required: false,
    secret: true,
  },
  {
    key: "nodePrefix",
    label: "Düğüm ön eki",
    type: "text",
    required: false,
    placeholder: "ns=2;s=Line1",
    hint: "Eşleme ekranında düğümler bu ön ekle listelenir.",
  },
];

const MQTT_FIELDS: ConnectorField[] = [
  {
    key: "broker",
    label: "Broker",
    type: "text",
    required: true,
    placeholder: "mqtt://192.168.1.20",
  },
  {
    key: "port",
    label: "Port",
    type: "number",
    required: true,
    min: 1,
    max: 65_535,
    placeholder: "1883",
  },
  {
    key: "topic",
    label: "Konu (topic)",
    type: "text",
    required: true,
    placeholder: "fabrika/hat1/#",
    hint: "Joker karakterler desteklenir: + tek seviye, # çok seviye.",
  },
  { key: "username", label: "Kullanıcı adı", type: "text", required: false },
  {
    key: "password",
    label: "Parola",
    type: "password",
    required: false,
    secret: true,
  },
  {
    key: "qos",
    label: "QoS",
    type: "select",
    required: true,
    options: [
      { value: "0", label: "0 — en fazla bir kez" },
      { value: "1", label: "1 — en az bir kez" },
      { value: "2", label: "2 — tam olarak bir kez" },
    ],
    hint: "Sayaç verisinde 1, kritik alarmda 2 önerilir.",
  },
  { key: "tls", label: "TLS", type: "boolean", required: false },
];

const REST_FIELDS: ConnectorField[] = [
  {
    key: "baseUrl",
    label: "Temel adres",
    type: "text",
    required: true,
    placeholder: "https://mes.fabrika.local/api",
  },
  {
    key: "apiKey",
    label: "API anahtarı",
    type: "password",
    required: false,
    secret: true,
  },
  {
    key: "bearer",
    label: "Bearer token",
    type: "password",
    required: false,
    secret: true,
  },
  {
    key: "refreshSeconds",
    label: "Yenileme aralığı (sn)",
    type: "number",
    required: true,
    min: 5,
    max: 3_600,
    placeholder: "30",
    hint: "Beş saniyenin altı çoğu MES ucunu gereksiz yorar.",
  },
  {
    key: "healthPath",
    label: "Sağlık ucu",
    type: "text",
    required: false,
    placeholder: "/health",
    hint: "Bağlantı testi bu uca gider.",
  },
  {
    key: "headers",
    label: "Ek başlıklar",
    type: "text",
    required: false,
    placeholder: "X-Line: 1",
    hint: "Her satıra bir tane: 'Anahtar: değer'. Uç noktanın beklediği özel başlıklar buraya yazılır.",
  },
  {
    key: "timeoutMs",
    label: "Zaman aşımı (ms)",
    type: "number",
    required: false,
    min: 1_000,
    max: 60_000,
    placeholder: "8000",
    hint: "Bu süre içinde yanıt gelmezse istek iptal edilir.",
  },
];

const CSV_FIELDS: ConnectorField[] = [
  {
    key: "folder",
    label: "İzlenen klasör",
    type: "text",
    required: true,
    placeholder: "\\\\sunucu\\uretim\\raporlar",
  },
  {
    key: "pattern",
    label: "Dosya deseni",
    type: "text",
    required: false,
    placeholder: "vardiya-*.csv",
  },
  {
    key: "intervalMinutes",
    label: "Kontrol aralığı (dk)",
    type: "number",
    required: true,
    min: 1,
    max: 1_440,
    placeholder: "15",
  },
  {
    key: "deleteAfterImport",
    label: "Alındıktan sonra dosyayı sil",
    type: "boolean",
    required: false,
    hint: "Kapalıyken aynı dosya ikinci kez alınmaz; ad ve tarih izlenir.",
  },
];

const ERP_FIELDS: ConnectorField[] = [
  {
    key: "baseUrl",
    label: "Temel adres",
    type: "text",
    required: true,
    placeholder: "https://erp.fabrika.local",
  },
  {
    key: "company",
    label: "Şirket kodu",
    type: "text",
    required: true,
    placeholder: "TR01",
  },
  {
    key: "apiKey",
    label: "API anahtarı",
    type: "password",
    required: true,
    secret: true,
  },
  {
    key: "syncOrders",
    label: "İş emirlerini al",
    type: "boolean",
    required: false,
  },
];

const FIELDS: Record<ConnectorKind, ConnectorField[]> = {
  opcua: OPCUA_FIELDS,
  mqtt: MQTT_FIELDS,
  rest: REST_FIELDS,
  csv: CSV_FIELDS,
  erp: ERP_FIELDS,
};

/** Bir protokolün ayar alanları. */
export function fieldsOf(kind: ConnectorKind): ConnectorField[] {
  return FIELDS[kind];
}

/**
 * Yeni bir bağlantının başlangıç ayarları.
 *
 * Bütün alanlar `null` başlar — boş metin değil. Boş metinle başlasaydı
 * "girilmedi" ile "bilerek boş bırakıldı" ayrımı kaybolur, doğrulama da bu iki
 * durumu ayıramazdı.
 */
export function defaultSettings(kind: ConnectorKind): ConnectorSettings {
  const settings: ConnectorSettings = {};
  for (const field of fieldsOf(kind)) {
    settings[field.key] = field.type === "boolean" ? false : null;
  }
  return settings;
}

/** Yeni bağlantı için önerilen ad: "OPC UA 2" gibi. */
export function suggestName(kind: ConnectorKind, existing: number): string {
  return existing === 0
    ? CONNECTOR_LABEL[kind]
    : `${CONNECTOR_LABEL[kind]} ${existing + 1}`;
}

/**
 * Ayarın günlüğe yazılabilir hâli.
 *
 * Gizli alanlar maskelenir. Olay günlüğü ekranda görünür ve dışa aktarılır;
 * içine düşen bir parola, günlüğü tutan herkesin eline geçer.
 */
export function redactSettings(
  kind: ConnectorKind,
  settings: ConnectorSettings,
): ConnectorSettings {
  const secretKeys = new Set(
    fieldsOf(kind)
      .filter((field) => field.secret === true)
      .map((field) => field.key),
  );

  const safe: ConnectorSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    safe[key] =
      secretKeys.has(key) && value !== null && value !== ""
        ? "••••••"
        : value;
  }
  return safe;
}
