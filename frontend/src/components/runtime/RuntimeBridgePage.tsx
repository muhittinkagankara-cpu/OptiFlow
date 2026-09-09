/**
 * Runtime köprüsü ekranı.
 *
 * Üç bölüm: bağlantı tanımlama formu, durum panosu ve olay akışı. Hepsinin
 * ortak kuralı aynıdır — ekranda "Bağlandı" yazan tek şey, sunucunun gerçek
 * bir cihazdan yanıt aldığı bağlantıdır.
 *
 * Akış (SSE) kullanıcı isteyince açılır ve ekran kapanınca kapanır.
 */

import { useState } from "react";
import {
  Database,
  Gauge,
  HardDriveDownload,
  Play,
  PlugZap,
  Radio,
  Siren,
  Square,
} from "lucide-react";
import {
  BRIDGE_KIND_LABEL,
  FEED_LABEL,
  describeBridgeEvent,
  latencyOf,
  type BridgeKind,
} from "../../lib/connectors";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { ConnectorMatrixTable } from "./ConnectorMatrixTable";
import { DataExplorer } from "./DataExplorer";
import { MonitoringPage } from "../monitoring/MonitoringPage";
import { RuntimeStatusPanel } from "./RuntimeStatusPanel";
import {
  FEED_TONE,
  LEVEL_TONE,
  NOT_MEASURED,
  showClock,
  showCount,
  showLatency,
} from "./runtimeStyles";
import { useRuntimeBridge } from "./useRuntimeBridge";

const KINDS: BridgeKind[] = ["rest", "opcua", "mqtt"];

/** Protokole göre örnek adres; kullanıcı biçimi buradan öğrenir. */
const PLACEHOLDER: Record<BridgeKind, string> = {
  rest: "http://192.168.1.50:8080/api/uretim",
  opcua: "opc.tcp://192.168.1.10:4840",
  mqtt: "192.168.1.20",
};

const TOPIC_LABEL: Record<BridgeKind, string> = {
  rest: "Bu protokolde konu kullanılmaz",
  opcua: "Düğümler (virgülle): ns=2;i=2",
  mqtt: "Konular (virgülle): fabrika/hat1/#",
};

type RuntimeTab = "connections" | "data" | "monitoring";

const TABS: { id: RuntimeTab; label: string; icon: typeof Radio }[] = [
  { id: "connections", label: "Bağlantılar", icon: Gauge },
  { id: "data", label: "Data Explorer", icon: Database },
  { id: "monitoring", label: "İzleme", icon: Siren },
];

export function RuntimeBridgePage() {
  const bridge = useRuntimeBridge();
  const { state } = bridge;
  const [tab, setTab] = useState<RuntimeTab>("connections");

  const [kind, setKind] = useState<BridgeKind>("opcua");
  const [label, setLabel] = useState("PLC 1");
  const [endpoint, setEndpoint] = useState("");
  const [topics, setTopics] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    await bridge.connect({
      connectionId: label.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, "-") || "baglanti",
      kind,
      label: label.trim() || "Bağlantı",
      endpoint: endpoint.trim(),
      topics: topics
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== ""),
      username: username.trim() === "" ? null : username.trim(),
      password: password === "" ? null : password,
      timeoutMs: 5_000,
      maxRetries: 0,
    });
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900">Runtime köprüsü</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Frontend → Backend → Bağlayıcı → Cihaz
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={FEED_TONE[state.feed.status]}>
              {FEED_LABEL[state.feed.status]}
            </Badge>
            <Badge tone={state.isStreaming ? "good" : "neutral"} icon={Radio}>
              {state.isStreaming ? "Olay akışı açık" : "Olay akışı kapalı"}
            </Badge>
          </div>
        </div>

        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
          Tarayıcı hiçbir cihaza doğrudan bağlanmaz: bağlantıyı sunucu kurar,
          kimlik bilgileri sunucuda kalır ve tarayıcıya hiç inmez. Bir bağlantı
          ancak cihazdan somut bir yanıt alındığında "Bağlandı (doğrulandı)"
          olur; ötekiler "Test edilmedi" ya da "Bağlantı kurulamadı" yazar.
        </p>

        {state.error !== null && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
            {state.error}
          </p>
        )}
      </Card>

      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-1.5 rounded-lg border border-slate-200 bg-white p-1">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-pressed={tab === item.id}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none ${
                  tab === item.id
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "connections" && state.dashboard !== null && (
        <div>
          <SectionTitle
            title="Runtime panosu"
            description="Köprünün ölçülen durumu; ölçülemeyen alan '—' gösterilir."
            action={
              <Button
                size="sm"
                icon={HardDriveDownload}
                onClick={() => void bridge.recover()}
                title="Diskteki bağlantıları ve makine görüntülerini geri yükle"
              >
                Diskten geri yükle
              </Button>
            }
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              {
                label: "Aktif bağlantı",
                value: showCount(state.dashboard.connections),
                hint: `${state.dashboard.verified} doğrulandı`,
              },
              {
                label: "Açık akış",
                value: showCount(state.dashboard.streamsRunning),
                hint: "Dinleme / yoklama",
              },
              {
                label: "Yeniden bağlanma",
                value: showCount(state.dashboard.reconnects),
                hint: `${state.dashboard.recoveries} kurtarma`,
              },
              {
                label: "Olay hızı",
                value:
                  state.dashboard.eventsPerSecond === null
                    ? NOT_MEASURED
                    : `${state.dashboard.eventsPerSecond.toFixed(1)}/sn`,
                hint: "Ölçülebiliyorsa",
              },
              {
                label: "Makine görüntüsü",
                value: showCount(state.dashboard.snapshots),
                hint: "Son bilinen durum",
              },
              {
                label: "Kalıcılık",
                value: state.dashboard.persistent ? "Gerçek doğrulandı" : "Doğrulanmadı",
                hint: state.dashboard.persistent
                  ? `${showCount(state.dashboard.persistedEvents)} olay diskte`
                  : "Bellek modu; yeniden başlatmada kaybolur",
              },
            ].map((card, index) => (
              <Card key={card.label} className="p-3" index={index}>
                <p className="text-xs font-medium text-slate-500">{card.label}</p>
                <p className="mt-1 break-words text-base font-semibold tabular-nums text-slate-900">
                  {card.value}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{card.hint}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/*
        İzleme sekmesi kendi verisini okur ve yalnızca açıkken yoklar: kapalı
        bir sekme için on saniyede bir istek atmak, hiç bakılmayan bir ekran
        uğruna sunucuyu meşgul etmek olurdu.
      */}
      {tab === "monitoring" && <MonitoringPage />}

      {tab === "data" && (
        <DataExplorer page={state.devices} feed={state.feed} />
      )}

      {tab === "connections" && (
      <div>
        <SectionTitle
          title="Yeni bağlantı"
          description="Sunucu bu adrese gerçekten gider ve sonucu buraya yazar."
        />
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              Protokol
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as BridgeKind)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none"
              >
                {KINDS.map((item) => (
                  <option key={item} value={item}>
                    {BRIDGE_KIND_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-600">
              Ad
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none"
              />
            </label>

            <label className="text-xs text-slate-600 sm:col-span-2">
              Adres
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder={PLACEHOLDER[kind]}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-brand-400 focus:outline-none"
              />
            </label>

            <label className="text-xs text-slate-600 sm:col-span-2">
              {TOPIC_LABEL[kind]}
              <input
                value={topics}
                disabled={kind === "rest"}
                onChange={(event) => setTopics(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-brand-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
              />
            </label>

            <label className="text-xs text-slate-600">
              Kullanıcı adı (isteğe bağlı)
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none"
              />
            </label>

            <label className="text-xs text-slate-600">
              Parola (isteğe bağlı)
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Parola sunucuda kalır; hiçbir yanıtta geri dönmez.
            </p>
            <Button
              variant="primary"
              icon={PlugZap}
              busy={state.isLoading}
              disabled={endpoint.trim() === ""}
              onClick={submit}
            >
              Bağlan ve doğrula
            </Button>
          </div>
        </Card>
      </div>

      )}

      {tab === "connections" && (
      <RuntimeStatusPanel
        connections={state.connections}
        summary={state.summary}
        streams={state.devices.streams}
        isLoading={state.isLoading}
        onRefresh={() => void bridge.refresh()}
        onDisconnect={(id) => void bridge.disconnect(id)}
        onSubscribe={(id) => void bridge.subscribe(id)}
        onUnsubscribe={(id) => void bridge.unsubscribe(id)}
      />
      )}

      {tab === "connections" && <ConnectorMatrixTable rows={state.matrix} />}

      {tab === "connections" && (
      <div>
        <SectionTitle
          title="Olay akışı"
          description="Sunucudaki son olaylar; akış açıkken canlı düşer."
          action={
            state.isStreaming ? (
              <Button size="sm" icon={Square} onClick={bridge.stopStream}>
                Akışı durdur
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={Play}
                onClick={() => void bridge.startStream()}
              >
                Akışı başlat
              </Button>
            )
          }
        />

        <Card className="p-4">
          {state.events.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="Henüz olay yok"
              description="Bir bağlantı tanımlayın; kayıt, deneme ve cihaz yanıtları buraya düşer."
            />
          ) : (
            <ol className="space-y-2">
              {state.events.map((event) => (
                <li
                  key={event.sequence}
                  className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm text-slate-800">
                      {describeBridgeEvent(event)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {event.connectionId} · {event.kind}
                      {latencyOf(event) === null
                        ? ""
                        : ` · ${showLatency(latencyOf(event))}`}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">
                      {showClock(event.atMs)}
                    </span>
                    <Badge tone={LEVEL_TONE[event.level] ?? "neutral"}>
                      {event.level}
                    </Badge>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      )}
    </div>
  );
}
