/**
 * Command Center'ın sunum mantığı.
 *
 * İş kuralları burada değil: eşikler, para hesabı ve sağlık göstergeleri
 * `lib/actionItems`, `lib/dashboardMetrics` ve `lib/factoryHealth` içinde
 * kalır. Bu klasör yalnızca o çıktıları seçer ve cümleye çevirir.
 */

export type {
  FactoryStatement,
  RailStation,
  RunProvenance,
} from "./types";

export { factoryStatement } from "./statement";
export { railStations, utilizationState } from "./rail";
export { leadDecision, moneyLine, remainingTopics, type MoneyLine } from "./decision";
export { confidenceLine, runProvenance } from "./provenance";
