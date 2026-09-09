/**
 * OPC UA ve MQTT runtime iskeletleri.
 *
 * İkisi de sözleşmeyi eksiksiz uygular ama **gerçek bir istemci taşımaz**.
 * `test()` çağrıldığında `attempted: false` döner ve arayüz "Doğrulanmadı"
 * yazar. Bu bilinçli bir karardır:
 *
 * - OPC UA, tarayıcıdan doğrudan konuşulamayan bir protokoldür (TCP tabanlı,
 *   `opc.tcp://`). Gerçek bağlantı bir sunucu tarafı köprü ya da ağ geçidi
 *   gerektirir.
 * - MQTT, tarayıcıda ancak WebSocket taşıması üzerinden çalışır
 *   (`ws://` / `wss://`); broker'ın bu taşımayı açması gerekir.
 *
 * Bu gerçekleri bilerek sahte bir "bağlandı" üretmek, pilot fabrikada ilk gün
 * fark edilecek ve ürünün bütün ölçümlerine olan güveni götürecek bir yalan
 * olurdu. Sözleşme bugün hazırdır; istemci geldiğinde değişecek tek şey bu
 * dosyadaki iki sınıftır.
 */

import type { ConnectorKind, ConnectorSettings } from "../types";
import { notAttempted, type RuntimeClient, type RuntimeProbe } from "./types";

/** Gerçek istemcisi olmayan runtime'ların ortak gövdesi. */
export abstract class UnimplementedRuntime implements RuntimeClient {
  abstract readonly kind: ConnectorKind;
  abstract readonly name: string;
  abstract readonly description: string;
  /** Neden gerçek bağlantı kurulamıyor; arayüz bunu aynen gösterir. */
  abstract readonly blocker: string;

  readonly isImplemented = false;

  /**
   * Denemeyi **yapmaz** ve yapmadığını söyler.
   *
   * Ayarların doğruluğu yine de sınanır: yanlış yazılmış bir broker adresi,
   * istemci geldiğinde de yanlış olacaktır ve bunu bugün söylemek bedavadır.
   */
  async test(settings: ConnectorSettings, nowMs: number): Promise<RuntimeProbe> {
    const issues = this.validate(settings);
    const detail =
      issues.length === 0
        ? `${this.name} bağlantısı doğrulanmadı: ${this.blocker}`
        : `${this.name} bağlantısı doğrulanmadı: ${this.blocker} Ayrıca: ${issues.join(" ")}`;
    return notAttempted(detail, nowMs);
  }

  /** Protokole özgü ayar kontrolleri. */
  protected abstract validate(settings: ConnectorSettings): string[];
}

/** OPC UA — denetleyiciden etiket aboneliği. */
export class OpcUaRuntime extends UnimplementedRuntime {
  readonly kind = "opcua" as const;
  readonly name = "OPC UA";
  readonly description =
    "Sözleşme hazır; gerçek istemci bir sunucu tarafı köprü gerektirir.";
  readonly blocker =
    "OPC UA tarayıcıdan doğrudan konuşulamaz (opc.tcp), sunucu tarafı köprü gerekiyor.";

  protected validate(settings: ConnectorSettings): string[] {
    const issues: string[] = [];
    const endpoint = typeof settings.endpoint === "string" ? settings.endpoint.trim() : "";
    if (endpoint === "") {
      issues.push("Endpoint girilmedi.");
    } else if (!endpoint.startsWith("opc.tcp://")) {
      issues.push("Endpoint opc.tcp:// ile başlamalı.");
    }
    if (settings.securityPolicy === "None") {
      issues.push("Güvenlik politikası None; üretim hattında önerilmez.");
    }
    return issues;
  }
}

/** MQTT — sensör ve kenar cihaz yayını. */
export class MqttRuntime extends UnimplementedRuntime {
  readonly kind = "mqtt" as const;
  readonly name = "MQTT";
  readonly description =
    "Sözleşme hazır; tarayıcıdan bağlanmak için broker'ın WebSocket taşımasını açması gerekir.";
  readonly blocker =
    "MQTT tarayıcıda yalnızca WebSocket taşıması üzerinden çalışır (ws:// veya wss://); broker'da bu uç açık olmalı.";

  protected validate(settings: ConnectorSettings): string[] {
    const issues: string[] = [];
    const broker = typeof settings.broker === "string" ? settings.broker.trim() : "";
    const port = Number(settings.port);
    const topic = typeof settings.topic === "string" ? settings.topic.trim() : "";

    if (broker === "") {
      issues.push("Broker adresi girilmedi.");
    } else if (!/^(mqtts?|wss?):\/\//i.test(broker)) {
      issues.push("Broker adresi mqtt://, mqtts://, ws:// ya da wss:// ile başlamalı.");
    }
    if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
      issues.push("Port 1-65535 aralığında olmalı.");
    }
    if (topic === "") {
      issues.push("Konu (topic) girilmedi.");
    }
    if (settings.tls === true && port === 1883) {
      issues.push("TLS açık ama port 1883; şifreli bağlantı genellikle 8883 kullanır.");
    }
    return issues;
  }
}

/** CSV klasör izleme — tarayıcıdan dosya sistemi izlenemez. */
export class CsvRuntime extends UnimplementedRuntime {
  readonly kind = "csv" as const;
  readonly name = "CSV klasör izleme";
  readonly description =
    "Sözleşme hazır; klasör izleme tarayıcıdan yapılamaz, dosyalar elle yüklenir.";
  readonly blocker =
    "Tarayıcı bir ağ klasörünü kendiliğinden izleyemez; bu akış için sunucu tarafı bir görev gerekiyor.";

  protected validate(settings: ConnectorSettings): string[] {
    const folder = typeof settings.folder === "string" ? settings.folder.trim() : "";
    return folder === "" ? ["İzlenecek klasör girilmedi."] : [];
  }
}

/** ERP — satıcıya özgü uçlar; REST runtime'ı kullanılabilir. */
export class ErpRuntime extends UnimplementedRuntime {
  readonly kind = "erp" as const;
  readonly name = "ERP";
  readonly description =
    "Sözleşme hazır; çoğu ERP REST sunar, o durumda REST bağlantısı kullanılmalı.";
  readonly blocker =
    "ERP için ayrı bir istemci yazılmadı; uç REST ise REST bağlantısı olarak tanımlayın.";

  protected validate(settings: ConnectorSettings): string[] {
    const url = typeof settings.baseUrl === "string" ? settings.baseUrl.trim() : "";
    return url === "" ? ["Temel adres girilmedi."] : [];
  }
}
