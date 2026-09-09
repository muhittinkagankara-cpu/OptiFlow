"""Testler için gerçek bir PostgreSQL sunucusu.

Neden gerekli
-------------
SALES-11'de kalıcılık yalnızca SQLite ile doğrulanmıştı ve rapora "PostgreSQL:
Doğrulanmadı" yazılmıştı. İki veritabanı aynı SQLAlchemy modelini kullansa da
aynı şey değildir: `JSONB`, `BigInteger`, birincil anahtar çakışması ve işlem
davranışı yalnızca gerçek sunucuda görülür.

Nasıl çalışır
-------------
`pgserver` paketi PostgreSQL ikililerini taşır; burada bir veri dizini
hazırlanır (`initdb`), sunucu boş bir portta başlatılır ve testler bitince
durdurulur. Sunucu kurulamıyorsa testler **atlanır** — geçmiş sayılmaz.
Atlanan bir test "doğrulandı" diye raporlanamaz.

Yerel ayar (locale) neden `C`
-----------------------------
Windows'ta Türkçe yerel ayarıyla `initdb`, son başlatma adımında yığın taşması
(0xC0000409) ile çöküyor. `--locale=C` bu çökmeyi ortadan kaldırır ve test
verisi için sıralama davranışının önemi yoktur.
"""

from __future__ import annotations

import atexit
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

#: Sunucunun hazır olması için beklenecek en fazla süre (sn).
STARTUP_TIMEOUT_S = 40


def _binary(name: str) -> Optional[Path]:
    """`pgserver` içindeki PostgreSQL ikilisi; paket yoksa `None`."""
    try:
        import pgserver  # type: ignore import-not-found
    except ImportError:
        return None

    root = Path(pgserver.__file__).parent / "pginstall" / "bin"
    candidate = root / (f"{name}.exe" if sys.platform == "win32" else name)
    return candidate if candidate.exists() else None


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class PostgresServer:
    """Test süresince yaşayan yerel PostgreSQL sunucusu."""

    def __init__(self) -> None:
        self.data_dir: Optional[str] = None
        self.port: Optional[int] = None
        self.log_path: Optional[str] = None

    @property
    def url(self) -> str:
        """SQLAlchemy bağlantı adresi."""
        return f"postgresql+psycopg2://postgres@127.0.0.1:{self.port}/postgres"

    def start(self) -> "PostgresServer":
        initdb = _binary("initdb")
        pg_ctl = _binary("pg_ctl")
        if initdb is None or pg_ctl is None:
            raise RuntimeError("pgserver kurulu degil; PostgreSQL sunucusu baslatilamaz.")

        self.data_dir = tempfile.mkdtemp(prefix="optiflow_pg_")
        self.port = free_port()
        self.log_path = os.path.join(self.data_dir, "server.log")

        init = subprocess.run(
            [
                str(initdb),
                "-D",
                self.data_dir,
                "--auth=trust",
                "--auth-local=trust",
                "--encoding=UTF8",
                # Bkz. modül başlığı: Türkçe yerel ayarında initdb çöküyor.
                "--locale=C",
                "-U",
                "postgres",
            ],
            capture_output=True,
            text=True,
        )
        if init.returncode != 0:
            raise RuntimeError(f"initdb basarisiz: {init.stderr[-400:]}")

        # Çıktı **yakalanmaz** ve `-w` kullanılmaz.
        #
        # Windows'ta `capture_output=True` ile açılan borular sunucu sürecine
        # miras kalır; `pg_ctl` bitse bile borular açık kaldığı için
        # `subprocess.run` sonsuza kadar bekler. Bu, ilk denemede süreci
        # dakikalarca askıda bıraktı. Sunucunun kendi günlüğü zaten `-l` ile
        # dosyaya yazılıyor; hazır olması `_wait_ready` ile yoklanır.
        with open(os.devnull, "wb") as sink:
            start = subprocess.run(
                [
                    str(pg_ctl),
                    "-D",
                    self.data_dir,
                    "-l",
                    self.log_path,
                    "-o",
                    f"-p {self.port}",
                    "-W",
                    "start",
                ],
                stdout=sink,
                stderr=sink,
                timeout=STARTUP_TIMEOUT_S,
            )
        if start.returncode != 0:
            raise RuntimeError(f"pg_ctl start basarisiz (kod {start.returncode}).")

        self._wait_ready()
        atexit.register(self.stop)
        return self

    def _wait_ready(self) -> None:
        """Sunucu bağlantı kabul edene kadar bekler."""
        import psycopg2

        deadline = time.time() + STARTUP_TIMEOUT_S
        last_error: Optional[Exception] = None
        while time.time() < deadline:
            try:
                connection = psycopg2.connect(
                    host="127.0.0.1", port=self.port, user="postgres", dbname="postgres"
                )
                connection.close()
                return
            except Exception as error:  # noqa: BLE001 — sunucu henüz açılmamış olabilir
                last_error = error
                time.sleep(0.5)
        raise RuntimeError(f"PostgreSQL hazir olmadi: {last_error}")

    def stop(self) -> None:
        """Sunucuyu durdurur ve veri dizinini siler.

        Neden önce süreç kimliği, sonra `pg_ctl`
        ----------------------------------------
        Yalnızca `pg_ctl stop` kullanılıyordu ve bu, art arda yapılan test
        koşularında **çalışan sunucuları geride bıraktı**: makinede beş ayrı
        PostgreSQL kümesi birikmişti. Windows'ta `pg_ctl stop` sunucunun
        kapanmasını bekler, beklerken zaman aşımına uğrar ve `atexit` içinden
        çağrıldığı için hata sessizce yutulur — sunucu ayakta kalır.

        Bu yüzden önce `postmaster.pid` dosyasındaki süreç doğrudan
        sonlandırılır; postmaster kapanınca çocuk süreçleri de kapanır.
        `pg_ctl` yalnızca dosya okunamadığında yedek olarak denenir ve kısa bir
        zaman aşımıyla sınırlanır.
        """
        if self.data_dir is None:
            return

        data_dir = self.data_dir
        # Dizin bir daha temizlenmeye çalışılmasın: `atexit` ile açık
        # çağrının aynı anda çalışması mümkündür.
        self.data_dir = None

        if not self._terminate_postmaster(data_dir):
            self._pg_ctl_stop(data_dir)

        shutil.rmtree(data_dir, ignore_errors=True)

    @staticmethod
    def _terminate_postmaster(data_dir: str) -> bool:
        """`postmaster.pid` dosyasındaki süreci sonlandırır.

        Dosyanın ilk satırı postmaster'ın süreç kimliğidir. Sonlandırma
        başarılıysa `True` döner; dosya yoksa, okunamıyorsa ya da süreç zaten
        kapalıysa `False`.
        """
        pid_file = Path(data_dir) / "postmaster.pid"
        try:
            pid = int(pid_file.read_text(encoding="utf-8").splitlines()[0].strip())
        except (OSError, ValueError, IndexError):
            return False

        try:
            if sys.platform == "win32":
                # `taskkill /T` çocuk süreçleri de kapatır; postmaster
                # arkasında yazıcı, denetim noktası ve arka plan süreçleri
                # bırakır ve bunlar tek başına sonlandırılmazsa portu tutar.
                with open(os.devnull, "wb") as sink:
                    subprocess.run(
                        ["taskkill", "/PID", str(pid), "/T", "/F"],
                        stdout=sink,
                        stderr=sink,
                        timeout=15,
                    )
            else:
                import signal

                os.kill(pid, signal.SIGQUIT)
        except Exception:  # noqa: BLE001 — kapatma hiçbir zaman testi düşürmemeli
            return False
        return True

    @staticmethod
    def _pg_ctl_stop(data_dir: str) -> None:
        """Yedek yol: `pg_ctl` ile durdurma; kısa zaman aşımıyla."""
        pg_ctl = _binary("pg_ctl")
        if pg_ctl is None:
            return
        try:
            with open(os.devnull, "wb") as sink:
                subprocess.run(
                    [str(pg_ctl), "-D", data_dir, "-m", "immediate", "-W", "stop"],
                    stdout=sink,
                    stderr=sink,
                    timeout=15,
                )
        except Exception:  # noqa: BLE001
            return


#: Süreç başına tek sunucu; her test dosyası için yeniden kurmak pahalıdır.
_server: Optional[PostgresServer] = None
_failure: Optional[str] = None


def postgres_url() -> Optional[str]:
    """Çalışan bir PostgreSQL adresi; kurulamıyorsa `None`.

    `None` dönmesi testlerin **atlanması** demektir; sessizce SQLite'a düşmek,
    "PostgreSQL doğrulandı" diye rapor edilen bir yalana yol açardı.
    """
    global _server, _failure

    if _failure is not None:
        return None
    if _server is not None:
        return _server.url

    try:
        _server = PostgresServer().start()
        return _server.url
    except Exception as error:  # noqa: BLE001
        _failure = str(error)
        return None


def skip_reason() -> str:
    """Sunucu kurulamadıysa nedeni."""
    return _failure or "PostgreSQL sunucusu kurulamadi."
