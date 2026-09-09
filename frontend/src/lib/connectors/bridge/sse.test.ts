import { describe, expect, it } from "vitest";
import { SseBuffer, parseFrame, parseFrameData, splitFrames } from "./sse";

describe("splitFrames", () => {
  it("tam cerceveyi ayirir", () => {
    const { frames, rest } = splitFrames("data: a\n\n");
    expect(frames).toEqual(["data: a"]);
    expect(rest).toBe("");
  });

  it("iki cerceveyi ayirir", () => {
    const { frames } = splitFrames("data: a\n\ndata: b\n\n");
    expect(frames).toHaveLength(2);
  });

  it("yarim kalan kismi geri verir", () => {
    // Tasinmasaydi ikiye bolunen bir olay sessizce kaybolurdu.
    const { frames, rest } = splitFrames("data: a\n\ndata: yar");
    expect(frames).toEqual(["data: a"]);
    expect(rest).toBe("data: yar");
  });

  it("bos girdide cerceve yok", () => {
    expect(splitFrames("").frames).toEqual([]);
  });

  it("yalnizca bosluk iceren cerceveler atilir", () => {
    expect(splitFrames("\n\n\n\n").frames).toEqual([]);
  });
});

describe("parseFrame", () => {
  it("veri satirini okur", () => {
    expect(parseFrame("data: merhaba")?.data).toBe("merhaba");
  });

  it("alan adindan sonraki tek boslugu atar", () => {
    expect(parseFrame("data:  iki bosluk")?.data).toBe(" iki bosluk");
  });

  it("olay turunu okur", () => {
    expect(parseFrame("event: probe\ndata: x")?.event).toBe("probe");
  });

  it("tur yoksa message olur", () => {
    expect(parseFrame("data: x")?.event).toBe("message");
  });

  it("kimligi sayiya cevirir", () => {
    expect(parseFrame("id: 42\ndata: x")?.id).toBe(42);
  });

  it("sayisal olmayan kimlik null olur", () => {
    expect(parseFrame("id: abc\ndata: x")?.id).toBeNull();
  });

  it("cok satirli veriyi birlestirir", () => {
    expect(parseFrame("data: bir\ndata: iki")?.data).toBe("bir\niki");
  });

  it("yorum satirini yok sayar", () => {
    // Canli tutma sinyalleri veri tasimaz.
    expect(parseFrame(": bekleniyor")).toBeNull();
  });

  it("verisiz cerceve null doner", () => {
    expect(parseFrame("event: probe")).toBeNull();
  });

  it("yorum ve veri birlikteyse veri okunur", () => {
    expect(parseFrame(": nabiz\ndata: x")?.data).toBe("x");
  });
});

describe("parseFrameData", () => {
  it("gecerli JSON cozulur", () => {
    const frame = parseFrame('data: {"a":1}');
    expect(parseFrameData(frame!)).toEqual({ a: 1 });
  });

  it("bozuk JSON null doner", () => {
    const frame = parseFrame("data: {bozuk");
    expect(parseFrameData(frame!)).toBeNull();
  });

  it("turkce karakterler korunur", () => {
    const frame = parseFrame('data: {"m":"bağlantı doğrulandı"}');
    expect(parseFrameData(frame!)).toEqual({ m: "bağlantı doğrulandı" });
  });
});

describe("SseBuffer", () => {
  it("tam cerceveyi hemen verir", () => {
    const buffer = new SseBuffer();
    expect(buffer.push("data: a\n\n")).toHaveLength(1);
  });

  it("yarim cerceve beklemede kalir", () => {
    const buffer = new SseBuffer();
    expect(buffer.push("data: ya")).toHaveLength(0);
    expect(buffer.pendingLength).toBeGreaterThan(0);
  });

  it("ikiye bolunen cerceve birlestirilir", () => {
    const buffer = new SseBuffer();
    buffer.push("data: mer");
    const frames = buffer.push("haba\n\n");
    expect(frames[0].data).toBe("merhaba");
  });

  it("kimlik takip edilir", () => {
    const buffer = new SseBuffer();
    buffer.push("id: 7\ndata: a\n\n");
    expect(buffer.lastEventId).toBe(7);
  });

  it("kimliksiz cerceve son kimligi bozmaz", () => {
    const buffer = new SseBuffer();
    buffer.push("id: 7\ndata: a\n\n");
    buffer.push("data: b\n\n");
    expect(buffer.lastEventId).toBe(7);
  });

  it("baslangicta kimlik yok", () => {
    expect(new SseBuffer().lastEventId).toBeNull();
  });

  it("sifirlama yarim cerceveyi atar", () => {
    const buffer = new SseBuffer();
    buffer.push("data: yarim");
    buffer.reset();
    expect(buffer.pendingLength).toBe(0);
  });

  it("yorum cerceveleri olay uretmez", () => {
    const buffer = new SseBuffer();
    expect(buffer.push(": akis acildi\n\n")).toHaveLength(0);
  });

  it("art arda gelen cerceveler sirayla doner", () => {
    const buffer = new SseBuffer();
    const frames = buffer.push("data: a\n\ndata: b\n\n");
    expect(frames.map((frame) => frame.data)).toEqual(["a", "b"]);
  });
});
