import { describe, expect, it, vi } from "vitest";
import { LiveFactoryStore } from "./store";
import { SCENARIOS, scenarioById } from "./scenarios";
import { START, seeds, state, stationOf } from "./fixtures";
import type { LiveEvent } from "./events";

describe("LiveFactoryStore", () => {
  it("olay uygular ve abonelere haber verir", () => {
    const store = new LiveFactoryStore(state());
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({
      type: "part_completed",
      atMinutes: START,
      stationId: "s1",
      quantity: 3,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(stationOf(store.getState(), "s1").completed).toBe(3);
  });

  it("yuz olayi tek bildirimle uygular", () => {
    // Yuz olay icin yuz render, tarayiciyi kilitlerdi; gercek bir OPC UA
    // aboneligi toplu paket gonderir.
    const store = new LiveFactoryStore(state());
    const listener = vi.fn();
    store.subscribe(listener);

    const events: LiveEvent[] = Array.from({ length: 100 }, (_, i) => ({
      type: "part_completed",
      atMinutes: START + i,
      stationId: "s1",
      quantity: 1,
    }));
    store.dispatch(events);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(stationOf(store.getState(), "s1").completed).toBe(100);
  });

  it("durum degismediyse bildirim gondermez", () => {
    const store = new LiveFactoryStore(state());
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({ type: "station_started", atMinutes: START, stationId: "yok" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("bos olay dizisinde bildirim gondermez", () => {
    const store = new LiveFactoryStore(state());
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("abonelik iptal edilince haber vermez", () => {
    const store = new LiveFactoryStore(state());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.dispatch({ type: "tick", atMinutes: START + 5 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("reset durumu bastan kurar", () => {
    const store = new LiveFactoryStore(state());
    store.dispatch({
      type: "part_completed",
      atMinutes: START,
      stationId: "s1",
      quantity: 9,
    });
    store.reset(state());
    expect(stationOf(store.getState(), "s1").completed).toBe(0);
  });

  it("getState her cagride ayni nesneyi verir", () => {
    // useSyncExternalStore, kararsiz bir anlik goruntude sonsuz donguye girer.
    const store = new LiveFactoryStore(state());
    expect(store.getState()).toBe(store.getState());
  });
});

describe("Senaryolar", () => {
  it("bes hazir akis vardir", () => {
    expect(SCENARIOS.map((item) => item.id)).toEqual([
      "normal",
      "bottleneck",
      "fault",
      "handoff",
      "setup",
    ]);
  });

  it("bilinmeyen kimlikte normal uretime duser", () => {
    expect(scenarioById("yok" as never).id).toBe("normal");
  });

  it("istasyon yoksa bos akis uretir", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.build([], START)).toEqual([]);
    }
  });

  it("deterministiktir", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.build(seeds(), START)).toEqual(scenario.build(seeds(), START));
    }
  });

  it("tek istasyonlu hatta da calisir", () => {
    // pick() basa sardigi icin ikinci istasyonu isteyen senaryolar da
    // cokmemeli.
    for (const scenario of SCENARIOS) {
      expect(scenario.build([seeds()[0]], START).length).toBeGreaterThan(0);
    }
  });

  it("darbogaz senaryosu kritik alarm uretir", () => {
    const steps = scenarioById("bottleneck").build(seeds(), START);
    const events = steps.flatMap((step) => step.events);
    const store = new LiveFactoryStore(state());
    store.dispatch(events);
    expect(
      store.getState().alarms.some((alarm) => alarm.level === "critical"),
    ).toBe(true);
  });

  it("ariza senaryosu once arizalanir sonra toparlanir", () => {
    const steps = scenarioById("fault").build(seeds(), START);
    const store = new LiveFactoryStore(state());
    store.dispatch(steps.flatMap((step) => step.events));

    const current = store.getState();
    expect(current.alarms.some((alarm) => alarm.id.startsWith("fault:"))).toBe(true);
    // Vardiya sonunda ariza kapali ve hat yeniden uretiyor olmali.
    expect(current.alarms.every((alarm) => alarm.resolvedAtMinutes !== null)).toBe(
      true,
    );
    expect(stationOf(current, "s2").status).toBe("running");
  });

  it("setup senaryosu setup'a girip cikar", () => {
    const steps = scenarioById("setup").build(seeds(), START);
    const store = new LiveFactoryStore(state());
    store.dispatch(steps.flatMap((step) => step.events));
    const station = store.getState().stations.find((item) => item.setupProduct !== null);
    expect(station).toBeUndefined();
  });

  it("operator senaryosu istasyonu bosta ve operatorsuz birakir", () => {
    const steps = scenarioById("handoff").build(seeds(), START);
    const store = new LiveFactoryStore(state());
    store.dispatch(steps.flatMap((step) => step.events));
    const station = stationOf(store.getState(), "s1");
    expect(station.status).toBe("idle");
    expect(station.operatorName).toBeNull();
    expect(station.queue).toBe(0);
  });
});
