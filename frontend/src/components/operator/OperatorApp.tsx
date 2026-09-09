/**
 * Operatör deneyiminin kabuğu (Sprint UX-6).
 *
 * Masaüstü kabuğundan (kenar çubuğu + üst çubuk) tamamen ayrıdır ve tam ekran
 * çizilir. Aynı kabuğa sığdırılmaya çalışılsaydı, telefonda hem kenar çubuğu
 * hem alt çubuk taşımak zorunda kalır ve 375 pikselin üçte biri gezinmeye
 * giderdi.
 *
 * Veri akışı tek yönlüdür: her dokunuş bir **olaya** çevrilir, olay
 * sağlayıcıya (`OperatorEventProvider`) yayımlanır, sağlayıcı güncel listeyi
 * geri verir. Ekranlar durumu doğrudan değiştirmez. Gerçek bir MES bağlantısı
 * geldiğinde değişen tek şey sağlayıcı olacak; ekranların hiçbiri
 * değişmeyecek.
 *
 * Geniş ekranda uygulama bir telefon çerçevesi içinde gösterilir. Bu bir
 * süs değildir: operatör arayüzü 375 piksele göre tasarlandı ve masaüstünde
 * tüm genişliğe yayılsaydı, ekranı onaylayan kişi sahadakinden bambaşka bir
 * yerleşim görürdü.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SimulationConfig } from "../../types/simulationTypes";
import {
  LocalOperatorProvider,
  haptic,
  type OperatorEvent,
  type OperatorEventProvider,
  type OperatorTask,
  type ScrapReason,
} from "../../lib/operator";
import { AlertsScreen } from "./AlertsScreen";
import { BottomNav } from "./BottomNav";
import { useMonitoring } from "../monitoring/useMonitoring";
import { OperatorHome } from "./OperatorHome";
import { ProfileScreen } from "./ProfileScreen";
import { QrScannerScreen } from "./QrScannerScreen";
import { ScrapEntryScreen } from "./ScrapEntryScreen";
import { ShiftSummaryScreen } from "./ShiftSummaryScreen";
import { TaskDetailScreen } from "./TaskDetailScreen";
import { TaskListScreen } from "./TaskListScreen";
import { SourceBanner } from "./operatorUi";
import { tabOfScreen, type OperatorScreen } from "./navigation";

interface OperatorAppProps {
  /** Açık fabrikanın modeli; görev adları buradan alınır. */
  config: SimulationConfig | null;
  operatorName: string;
  orgName: string;
  factoryName: string | null;
  onExit: () => void;
  /** Testler ve ileride MES bağlantısı için değiştirilebilir. */
  provider?: OperatorEventProvider;
}

export function OperatorApp({
  config,
  operatorName,
  orgName,
  factoryName,
  onExit,
  provider,
}: OperatorAppProps) {
  const stationNames = useMemo(
    () => config?.stations.map((station) => station.name) ?? [],
    [config],
  );

  const activeProvider = useMemo(
    () => provider ?? new LocalOperatorProvider(stationNames, operatorName),
    [provider, stationNames, operatorName],
  );

  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [screen, setScreen] = useState<OperatorScreen>({ name: "home" });

  /*
   * Hattın gerçek durumu. Yalnızca ana ekran açıkken yoklanır: görünmeyen bir
   * ekran için sunucuya on saniyede bir istek atmak, telefonun pilini boşuna
   * tüketirdi.
   */
  const monitoring = useMonitoring({ enabled: screen.name === "home" });

  useEffect(() => {
    let cancelled = false;
    void activeProvider.listTasks().then((loaded) => {
      if (!cancelled) {
        setTasks(loaded);
      }
    });
    const unsubscribe = activeProvider.subscribe(setTasks);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeProvider]);

  const publish = useCallback(
    (event: OperatorEvent) => {
      void activeProvider.publish(event);
    },
    [activeProvider],
  );

  const openTask = useCallback((taskId: string) => {
    setScreen({ name: "task", taskId });
  }, []);

  /*
   * Görev detayında gösterilecek kayıt her karede listeden yeniden okunur.
   * Ekran açılırken bir kopya saklansaydı, olay yayımlandıktan sonra ekrandaki
   * adet güncellenmez ve operatör dokunduğu düğmenin işe yaramadığını sanardı.
   */
  const openedTask =
    screen.name === "task" || screen.name === "scrap"
      ? (tasks.find((task) => task.id === screen.taskId) ?? null)
      : null;

  const now = () => new Date().toISOString();

  const body = (() => {
    if ((screen.name === "task" || screen.name === "scrap") && !openedTask) {
      // Görev kaybolduysa (sağlayıcı listeyi değiştirdi) listeye düş.
      return <TaskListScreen tasks={tasks} onOpenTask={openTask} />;
    }

    switch (screen.name) {
      case "home":
        return (
          <OperatorHome
            tasks={tasks}
            operatorName={operatorName}
            productionStatus={monitoring.status}
            onOpenTask={openTask}
            onOpenTasks={() => setScreen({ name: "tasks" })}
            onOpenShift={() => setScreen({ name: "shift" })}
          />
        );

      case "tasks":
        return <TaskListScreen tasks={tasks} onOpenTask={openTask} />;

      case "scan":
        return <QrScannerScreen tasks={tasks} onOpenTask={openTask} />;

      case "alerts":
        return <AlertsScreen tasks={tasks} onOpenTask={openTask} />;

      case "profile":
        return (
          <ProfileScreen
            operatorName={operatorName}
            orgName={orgName}
            factoryName={factoryName}
            sourceName={activeProvider.name}
            sourceDescription={activeProvider.description}
            isLive={activeProvider.isLive}
            tasks={tasks}
            onExit={onExit}
            onOpenShift={() => setScreen({ name: "shift" })}
          />
        );

      case "shift":
        return (
          <ShiftSummaryScreen tasks={tasks} onBack={() => setScreen({ name: "home" })} />
        );

      case "task":
        return (
          <TaskDetailScreen
            task={openedTask!}
            onBack={() => setScreen({ name: "tasks" })}
            onStart={() => {
              haptic("transition");
              publish({ type: "task_started", taskId: openedTask!.id, at: now() });
            }}
            onPause={() => {
              haptic("transition");
              publish({ type: "task_paused", taskId: openedTask!.id, at: now() });
            }}
            onComplete={() => {
              haptic("success");
              publish({ type: "task_completed", taskId: openedTask!.id, at: now() });
            }}
            onReportUnit={(quantity) => {
              haptic("tap");
              publish({
                type: "unit_produced",
                taskId: openedTask!.id,
                at: now(),
                quantity,
              });
            }}
            onOpenScrap={() =>
              setScreen({ name: "scrap", taskId: openedTask!.id })
            }
          />
        );

      case "scrap":
        return (
          <ScrapEntryScreen
            task={openedTask!}
            onBack={() => setScreen({ name: "task", taskId: openedTask!.id })}
            onSubmit={(input: {
              reason: ScrapReason;
              quantity: number;
              photoCount: number;
              note: string | null;
            }) => {
              haptic("success");
              publish({
                type: "scrap_recorded",
                taskId: openedTask!.id,
                at: now(),
                ...input,
              });
              setScreen({ name: "task", taskId: openedTask!.id });
            }}
          />
        );
    }
  })();

  return (
    <div className="flex h-full justify-center overflow-hidden bg-canvas md:items-center md:py-5">
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-slate-50 md:h-[min(100%,812px)] md:max-w-[400px] md:rounded-[2rem] md:border md:border-slate-200 md:shadow-xl lg:border-[10px]">
        {/* Sağlayıcı canlı değilken şerit kalıcıdır ve kapatılamaz. */}
        {!activeProvider.isLive && (
          <SourceBanner text="Örnek vardiya verisi — üretim sistemine bağlanılmadı." />
        )}

        <main className="min-h-0 flex-1 overflow-y-auto">{body}</main>

        <BottomNav
          active={tabOfScreen(screen)}
          onSelect={(tab) => {
            haptic("tap");
            setScreen({ name: tab });
          }}
        />
      </div>
    </div>
  );
}
