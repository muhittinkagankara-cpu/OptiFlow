#!/usr/bin/env node
/**
 * Sprint kabul kontrol listesi.
 *
 * Amaç, sprint sonunda "bitti" demeden önce mekanik olarak doğrulanabilecek her
 * şeyi doğrulamaktır. Elle doğrulanması gereken tek madde (mobil taşma) burada
 * **kendiliğinden geçmiş sayılmaz**: `--browser-verified` bayrağı verilmediği
 * sürece "doğrulanmadı" olarak raporlanır ve liste başarısız olur.
 *
 * Kullanım:
 *   npm run acceptance                      → mobil madde doğrulanmadı sayılır
 *   npm run acceptance -- --browser-verified → tarayıcıda 375px kontrol edildi
 *
 * Çıkış kodu: hepsi geçtiyse 0, aksi hâlde 1.
 */

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const SRC_DIR = join(FRONTEND_DIR, "src");

const browserVerified = process.argv.includes("--browser-verified");

/**
 * Backend koşumunun üst sınırı (ms).
 *
 * Sınırsız bırakıldığında kontrol listesi askıda kaldı: gömülü PostgreSQL ve
 * yerel protokol sunucuları başlatan testler, betiğin altında bazen
 * ilerlemiyor. Zaman aşımı, listeyi sonsuza kadar bekletmek yerine **düşürür**
 * ve nedenini yazar; sessizce beklemek, koşumun geçtiği izlenimini verirdi.
 */
const BACKEND_TIMEOUT_MS = 30 * 60_000;

/** Tek bir kontrolün sonucu. */
const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
}

/**
 * Komutu çalıştırır; çıktıyı ve başarısını döndürür.
 *
 * Hata fırlatmaz — bir kontrolün düşmesi listenin geri kalanını durdurmamalıdır;
 * kullanıcı tek koşumda bütün resmi görmelidir.
 */
function run(command, args, cwd) {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return { ok: true, output };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error),
    };
  }
}

/**
 * Çıktısı **dosyaya** yazılan koşum.
 *
 * Neden boru değil
 * ----------------
 * `execFileSync` çocuğun çıktısını bir boruya bağlar ve bu boru, çocuğun
 * başlattığı süreçlere miras kalır. Backend testleri gömülü bir PostgreSQL
 * sunucusu başlatıyor; sunucu ayakta kaldığı sürece boru açık kalıyor ve
 * `execFileSync` süreç bitse bile okumayı bitiremiyor. Bu, kabul listesini
 * yirmi dakikadan uzun süre askıda bıraktı.
 *
 * Dosya tanıtıcısı aynı sorunu doğurmaz: sunucu onu miras alsa da okuyan
 * taraf beklemez.
 */
function runToFile(command, args, cwd, timeoutMs = BACKEND_TIMEOUT_MS) {
  const logPath = join(tmpdir(), `optiflow-acceptance-${Date.now()}.log`);
  const handle = openSync(logPath, "w");
  try {
    /*
     * Kabuk **kullanılmaz**. `shell: true` araya `cmd.exe` sokar; zaman aşımı
     * dolduğunda öldürülen taraf kabuk olur ve asıl süreç (pytest) yetim
     * kalarak çalışmaya devam eder. Kabuk zaten gereksiz: `python` doğrudan
     * çalıştırılabilen bir program.
     */
    execFileSync(command, args, {
      cwd,
      stdio: ["ignore", handle, handle],
      timeout: timeoutMs,
    });
    return { ok: true, output: readLog(logPath), timedOut: false };
  } catch (error) {
    const timedOut = error?.code === "ETIMEDOUT" || error?.signal === "SIGTERM";
    return {
      ok: false,
      output: timedOut
        ? `Koşum ${Math.round(timeoutMs / 60_000)} dakikada bitmedi ve durduruldu. ` +
          `Son çıktı: ${tail(readLog(logPath), 1)}`
        : readLog(logPath),
      timedOut,
    };
  } finally {
    closeSync(handle);
  }
}

function readLog(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function git(args) {
  return run("git", args, REPO_DIR);
}

/** Son satırların özeti; uzun çıktılar raporu boğmasın. */
function tail(text, lines = 3) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(-lines)
    .join(" | ");
}

/** Dizin ağacındaki dosyalar. */
function walk(dir, filter) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full, filter));
    } else if (filter(full)) {
      found.push(full);
    }
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* 1. tsc -b                                                                   */
/* -------------------------------------------------------------------------- */

const tsc = run("npx", ["tsc", "-b", "--pretty", "false"], FRONTEND_DIR);
record(
  "tsc -b temiz",
  tsc.ok ? "pass" : "fail",
  tsc.ok ? "tip hatası yok" : tail(tsc.output, 4),
);

/* -------------------------------------------------------------------------- */
/* 2. Frontend testleri                                                        */
/* -------------------------------------------------------------------------- */

const vitest = run("npx", ["vitest", "run"], FRONTEND_DIR);
const testSummary =
  vitest.output.match(/Tests\s+.*$/m)?.[0]?.trim() ?? tail(vitest.output, 2);
record(
  "Frontend testleri geçti",
  vitest.ok ? "pass" : "fail",
  testSummary,
);

/* -------------------------------------------------------------------------- */
/* 3. Backend testleri (yalnızca değiştiyse)                                   */
/* -------------------------------------------------------------------------- */

const backendDirty = git(["status", "--porcelain", "--", "simulation_engine"]);
const backendChanged =
  backendDirty.ok && backendDirty.output.trim() !== "";

if (!backendChanged) {
  record(
    "Backend testleri (değiştiyse)",
    "skip",
    "simulation_engine/ değişmedi; koşum gerekmiyor",
  );
} else {
  const pytest = runToFile(
    "python",
    ["-m", "pytest", "simulation_engine", "-q"],
    REPO_DIR,
  );
  record(
    "Backend testleri geçti",
    pytest.ok ? "pass" : "fail",
    tail(pytest.output, 2),
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Mobil 375px taşma (elle doğrulanır)                                      */
/* -------------------------------------------------------------------------- */

record(
  "Mobil 375px taşma yok",
  browserVerified ? "pass" : "fail",
  browserVerified
    ? "tarayıcıda doğrulandı (--browser-verified)"
    : "TARAYICIDA DOĞRULANMADI — 375px'te yatay taşma kontrol edilmeli",
);

/* -------------------------------------------------------------------------- */
/* 5. Yeni mantık lib/ altında                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Bileşen dosyaları (.tsx) yalnızca bileşen dışa aktarmalıdır. Küçük harfle
 * başlayan bir dışa aktarım, bileşenin içine karar mantığı sızdığının en
 * güvenilir işaretidir — bu mantık `lib/` altında, sınanabilir bir yerde
 * durmalıdır.
 */
const componentFiles = walk(
  join(SRC_DIR, "components"),
  (file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"),
);

/*
 * Yalnızca bu sprintte değişen dosyalar listeyi düşürür. Depoda önceden duran
 * ihlaller "dikkat" olarak raporlanır: her koşumda eski kodu kırmızı yakmak,
 * listeyi kısa sürede görmezden gelinen bir gürültüye çevirirdi.
 *
 * `use...` ile başlayan dışa aktarımlar hook'tur ve bileşen dosyasında durması
 * doğrudur; kural karar mantığı içindir.
 */
const changedFiles = new Set(
  (git(["status", "--porcelain"]).output || "")
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
    .filter((path) => path !== "")
    .map((path) => join(REPO_DIR, path.split("/").join(sep))),
);

/** Dosya bu sprintte eklendi ya da değiştirildi mi? */
function isChanged(file) {
  if (changedFiles.has(file)) {
    return true;
  }
  // Yeni klasörler `git status`'ta tek satır olarak görünür (ör. "src/lib/x/").
  for (const changed of changedFiles) {
    if (changed.endsWith(sep) && file.startsWith(changed)) {
      return true;
    }
  }
  return false;
}

const leakedNew = [];
const leakedOld = [];
for (const file of componentFiles) {
  const source = readFileSync(file, "utf8");
  const matches = source.match(/^export\s+(?:async\s+)?function\s+([a-z]\w*)/gm) ?? [];
  for (const match of matches) {
    const name = match.split(/\s+/).pop();
    if (/^use[A-Z]/.test(name)) {
      continue;
    }
    const entry = `${relative(SRC_DIR, file)} → ${name}`;
    (isChanged(file) ? leakedNew : leakedOld).push(entry);
  }
}

record(
  "Yeni mantık lib/ altında",
  leakedNew.length > 0 ? "fail" : leakedOld.length > 0 ? "warn" : "pass",
  leakedNew.length > 0
    ? `Bu sprintte bileşene sızan mantık: ${leakedNew.join(", ")}`
    : leakedOld.length > 0
      ? `Bu sprintte sızıntı yok; devralınan ihlaller: ${leakedOld.join(", ")}`
      : `${componentFiles.length} bileşen dosyası yalnızca bileşen dışa aktarıyor`,
);

/* -------------------------------------------------------------------------- */
/* 6. Simülasyon gerçek bağlantı diye sunulmamış                               */
/* -------------------------------------------------------------------------- */

/*
 * İki yönlü kontrol:
 *
 * a) Bağlayıcı katmanında gerçek bir ağ çağrısı var mı? (fetch, WebSocket,
 *    mqtt istemcisi) Varsa bu artık benzetim değildir ve raporda ayrı
 *    anlatılmalıdır; betik bunu "dikkat" olarak işaretler.
 * b) Arayüzde benzetim uyarısı duruyor mu? Uyarı silinmişse kullanıcı sahte
 *    veriyi gerçek sanabilir — bu, listenin düşmesi gereken bir durumdur.
 */
const connectorFiles = existsSync(join(SRC_DIR, "lib", "connectors"))
  ? walk(join(SRC_DIR, "lib", "connectors"), (file) => file.endsWith(".ts"))
  : [];

const networkCalls = [];
for (const file of connectorFiles) {
  const source = readFileSync(file, "utf8");
  /*
   * Kalıp bilinçli olarak geniştir. İlk yazımda yalnızca `fetch(` aranıyordu ve
   * REST runtime `this.fetchImpl(...)` biçiminde çağırdığı için gerçek ağ
   * çağrısı gözden kaçtı — kontrol listesi "gerçek ağ çağrısı yok" diyordu.
   * Tanımlayıcının kendisi aranınca (`fetch`, `WebSocket`, `XMLHttpRequest`,
   * `EventSource`) takma adla saklanan çağrılar da yakalanır.
   */
  if (/\bfetch\b|\bWebSocket\b|\bXMLHttpRequest\b|\bEventSource\b|mqtt\.connect/.test(source)) {
    networkCalls.push(relative(SRC_DIR, file));
  }
}

const centerPath = join(SRC_DIR, "components", "connectors", "ConnectorCenter.tsx");
const disclosurePresent =
  existsSync(centerPath) &&
  /benzetim/i.test(readFileSync(centerPath, "utf8"));

let connectionStatus = "pass";
let connectionDetail =
  "Bağlayıcı katmanında gerçek ağ çağrısı yok; arayüzde benzetim uyarısı duruyor";

if (!disclosurePresent) {
  connectionStatus = "fail";
  connectionDetail =
    "Bağlayıcı ekranında benzetim uyarısı bulunamadı — sahte veri gerçek sanılabilir";
} else if (networkCalls.length > 0) {
  connectionStatus = "warn";
  connectionDetail = `Gerçek ağ çağrısı içeren dosyalar: ${networkCalls.join(", ")} — raporda benzetimden ayrı anlatılmalı`;
}

record(
  "Gerçek bağlantı simülasyon diye gizlenmedi",
  connectionStatus,
  connectionDetail,
);

/* -------------------------------------------------------------------------- */
/* 7. Kalıcılık, kurtarma ve yeniden oynatma etkin                             */
/* -------------------------------------------------------------------------- */

/*
 * Üç yetenek de kodda **bağlı** olmalı. SALES-11'de kalıcılık yazıldı ama
 * kurtarma elle bir düğmeye bağlıydı; sunucu yeniden başladığında ekranı ilk
 * açan kişiye kadar hiçbir alarm değerlendirilmiyordu. Bu kontrol o boşluğun
 * geri gelmediğini doğrular.
 */
const runtimeDir = join(REPO_DIR, "simulation_engine", "runtime");
const serviceFile = join(REPO_DIR, "simulation_engine", "api", "simulation_service.py");

function fileHas(path, pattern) {
  return existsSync(path) && pattern.test(readFileSync(path, "utf8"));
}

const persistenceWired = fileHas(
  join(runtimeDir, "persistence", "repository.py"),
  /class DatabaseRuntimeRepository/,
);
const recoveryWired =
  fileHas(join(runtimeDir, "manager.py"), /def recover_all/) &&
  fileHas(serviceFile, /recover_on_startup/);
const replayWired = fileHas(join(runtimeDir, "api.py"), /"\/replay"/);

const wiringMissing = [
  persistenceWired ? null : "kalıcılık",
  recoveryWired ? null : "otomatik kurtarma",
  replayWired ? null : "yeniden oynatma",
].filter((item) => item !== null);

record(
  "Kalıcılık, kurtarma ve yeniden oynatma etkin",
  wiringMissing.length === 0 ? "pass" : "fail",
  wiringMissing.length === 0
    ? "Üçü de kodda bağlı; kurtarma sunucu açılışında kendiliğinden çalışıyor"
    : `Bağlı olmayanlar: ${wiringMissing.join(", ")}`,
);

/* -------------------------------------------------------------------------- */
/* 8. Alarm mükerrerliği ve NaN/Infinity                                       */
/* -------------------------------------------------------------------------- */

/*
 * Motorların kendi testleri bu iki kuralı zaten sınar; kabul listesi de
 * doğrudan çalıştırır ki bir sonraki sprintte testler sessizce atlanırsa
 * burada görünsün.
 *
 * `-k` ile süzme denendi ve **çalışmadı**: ifade boşluklardan bölünüp ayrı
 * argümanlara dağıldı ve pytest "or" adında bir dosya aradı. Üç dosyanın
 * tamamı bir saniyenin altında koştuğu için süzmeye gerek de yok.
 */
const guardTests = runToFile(
  "python",
  [
    "-m",
    "pytest",
    "simulation_engine/validation/test_runtime_alarms.py",
    "simulation_engine/validation/test_runtime_kpi.py",
    "simulation_engine/validation/test_runtime_oee.py",
    "-q",
  ],
  REPO_DIR,
);

record(
  "Mükerrer alarm yok, NaN/Infinity sızmıyor, OEE 0-100 arasında",
  guardTests.ok ? "pass" : "fail",
  tail(guardTests.output, 2),
);

/* -------------------------------------------------------------------------- */
/* 9. Ölçülmeyen değer sıfır gösterilmiyor                                     */
/* -------------------------------------------------------------------------- */

/*
 * `?? 0` kalıbı, ölçülmemiş bir değeri sessizce sıfıra çeviren en yaygın
 * yazımdır. İzleme katmanında bulunması, "ölçülmedi" ile "ölçüldü ve sıfır"
 * ayrımının kaybolduğu anlamına gelir.
 */
const monitoringDir = join(SRC_DIR, "lib", "monitoring");
const zeroFallbacks = [];

if (existsSync(monitoringDir)) {
  for (const file of walk(monitoringDir, (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    const source = readFileSync(file, "utf8");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (/\?\?\s*0\b/.test(line) && !/numberOr\(/.test(line)) {
        zeroFallbacks.push(`${relative(SRC_DIR, file)}:${index + 1}`);
      }
    }
  }
}

record(
  "Ölçülmeyen değer sıfıra düşmüyor",
  zeroFallbacks.length === 0 ? "pass" : "fail",
  zeroFallbacks.length === 0
    ? "İzleme katmanında sessiz sıfır yedeği yok"
    : `Sıfıra düşen satırlar: ${zeroFallbacks.join(", ")}`,
);

/* -------------------------------------------------------------------------- */
/* 10. Commit yapılmamış                                                       */
/* -------------------------------------------------------------------------- */

const head = git(["log", "-1", "--oneline"]);
const dirty = git(["status", "--porcelain"]);
const hasUncommitted = dirty.ok && dirty.output.trim() !== "";

record(
  "Commit yapılmadı",
  hasUncommitted ? "pass" : "warn",
  hasUncommitted
    ? `Değişiklikler çalışma ağacında duruyor · HEAD: ${head.output.trim()}`
    : `Çalışma ağacı temiz — sprint değişiklikleri commit'lenmiş olabilir · HEAD: ${head.output.trim()}`,
);

/* -------------------------------------------------------------------------- */
/* Rapor                                                                       */
/* -------------------------------------------------------------------------- */

const ICON = { pass: "[gecti]", fail: "[DUSTU]", warn: "[dikkat]", skip: "[atlandi]" };

process.stdout.write("\nSprint kabul kontrol listesi\n");
process.stdout.write("=".repeat(60) + "\n");
for (const item of results) {
  process.stdout.write(`${ICON[item.status]} ${item.name}\n        ${item.detail}\n`);
}

const failed = results.filter((item) => item.status === "fail");
process.stdout.write("=".repeat(60) + "\n");
process.stdout.write(
  failed.length === 0
    ? "Tum zorunlu kontroller gecti.\n"
    : `${failed.length} kontrol dustu.\n`,
);

process.exit(failed.length === 0 ? 0 : 1);
