/**
 * Henüz bağlanmayan sağlayıcılar — sözleşmenin şeklini bugünden sabitlerler.
 *
 * Üçü de `LiveDataProvider`'ı eksiksiz uygular ama `isAvailable` alanları
 * `false`'tur ve `connect` çağrılırsa açıklayıcı bir hata atarlar. Arayüzde
 * "yakında" olarak listelenirler; seçilemezler.
 *
 * Yarın hangi kaynağın hangi sağlayıcıya bağlanacağı:
 *
 * | Kaynak        | Sağlayıcı           | Taşıma                        |
 * |---------------|---------------------|-------------------------------|
 * | WebSocket     | `WebSocketProvider` | kalıcı soket                  |
 * | MQTT          | `WebSocketProvider` | MQTT-over-WS köprüsü          |
 * | OPC UA        | `OPCUAProvider`     | abonelik (subscription)       |
 * | Siemens S7    | `OPCUAProvider`     | S7 sürücüsü üzerinden OPC UA  |
 * | Beckhoff ADS  | `OPCUAProvider`     | ADS → OPC UA köprüsü          |
 * | Modbus TCP    | `MESProvider`       | yoklama (polling)             |
 * | Mitsubishi    | `MESProvider`       | SLMP / MC protokolü           |
 * | Optimak       | `MESProvider`       | satıcı REST ucu               |
 */

import { UnavailableProvider } from "./base";

/** Sunucudan kalıcı soket üzerinden olay akışı. */
export class WebSocketProvider extends UnavailableProvider {
  readonly id = "websocket";
  readonly name = "WebSocket";
  readonly description =
    "Sunucudan anlık olay akışı; MQTT köprüsü de bu sağlayıcıyı kullanacak.";
}

/** Üretim yönetim sisteminin REST / SLMP uçları. */
export class MESProvider extends UnavailableProvider {
  readonly id = "mes";
  readonly name = "MES";
  readonly description =
    "Üretim yönetim sisteminden iş emri ve sayaç okuma; Modbus TCP ve satıcı uçları buraya bağlanır.";
}

/** Makine denetleyicisinden doğrudan etiket okuma. */
export class OPCUAProvider extends UnavailableProvider {
  readonly id = "opcua";
  readonly name = "OPC UA";
  readonly description =
    "Denetleyiciden doğrudan etiket aboneliği; Siemens S7 ve Beckhoff ADS köprüleri buraya bağlanır.";
}
