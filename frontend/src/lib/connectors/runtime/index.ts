/**
 * Runtime katmanının giriş noktası.
 *
 * Bileşenler yalnızca buradan içe aktarır ve somut istemci sınıfını
 * `runtimeFor()` üzerinden alır. Hangi protokolde gerçek istemci olduğu tek
 * yerde durur; ekran bunu `isImplemented` alanından okur.
 */

import type { ConnectorKind } from "../types";
import { RestRuntime } from "./rest";
import {
  CsvRuntime,
  ErpRuntime,
  MqttRuntime,
  OpcUaRuntime,
} from "./skeletons";
import type { RuntimeClient } from "./types";

export * from "./types";
export * from "./rest";
export * from "./skeletons";
export * from "./payload";
export * from "./diagnostics";

/**
 * Protokolün runtime istemcisi.
 *
 * REST dışındakiler iskelettir ve `test()` çağrıldığında "Doğrulanmadı" döner.
 * Bu liste, hangi bağlantının gerçekten kurulabildiğinin tek doğruluk
 * kaynağıdır; arayüzde ayrı bir liste tutulmaz.
 */
export function runtimeFor(kind: ConnectorKind): RuntimeClient {
  switch (kind) {
    case "rest":
      return new RestRuntime();
    case "opcua":
      return new OpcUaRuntime();
    case "mqtt":
      return new MqttRuntime();
    case "csv":
      return new CsvRuntime();
    case "erp":
      return new ErpRuntime();
  }
}

/** Gerçek istemcisi olan protokoller. */
export function implementedKinds(kinds: ConnectorKind[]): ConnectorKind[] {
  return kinds.filter((kind) => runtimeFor(kind).isImplemented);
}
