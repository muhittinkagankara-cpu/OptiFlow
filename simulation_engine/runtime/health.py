"""Bağlantı sağlığı ölçümü.

Her bağlantı için gecikme, yeniden bağlanma sayısı, paket sayısı, hata sayısı
ve çalışma süresi tutulur. Ölçülemeyen alan `None` döner — arayüz bunu
"Doğrulanmadı" olarak yazar.

Gecikme neden ortalama **ve** yüzdelik?
--------------------------------------
Ortalama tek başına yanıltıcıdır: on ölçümün dokuzu 5 ms, biri 900 ms ise
ortalama 94 ms çıkar ve ne tipik davranışı ne de kötü durumu anlatır. Bu yüzden
ortalamanın yanında en kötü ölçüm (`max`) ve medyan da tutulur.

Sayaçlar süreç belleğinde yaşar; sunucu yeniden başladığında sıfırlanır ve bu
`uptime_ms`'in yanında açıkça görünür (ilk ölçüm anı da döner).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

#: Gecikme penceresi: son bu kadar ölçüm saklanır.
#:
#: Sınırsız tutulsaydı uzun süre açık kalan bir bağlantının belleği sürekli
#: büyürdü; yüz ölçüm, dakikalık bir eğilimi göstermeye yeter.
LATENCY_WINDOW = 100


@dataclass
class HealthMonitor:
    """Tek bir bağlantının ölçümleri."""

    #: Başarılı ölçümler (ms).
    latencies: List[float] = field(default_factory=list)
    reconnects: int = 0
    packets: int = 0
    errors: int = 0
    #: Bağlantının kurulduğu an (epoch ms); hiç kurulmadıysa `None`.
    connected_at_ms: Optional[int] = None
    #: Son başarılı veri anı; hiç veri alınmadıysa `None`.
    last_packet_at_ms: Optional[int] = None
    #: Son hatanın metni; hiç hata olmadıysa `None`.
    last_error: Optional[str] = None

    def record_latency(self, latency_ms: Optional[float]) -> None:
        """Ölçülen gecikmeyi kaydeder.

        `None` gelirse hiçbir şey kaydedilmez: ölçülemeyen bir denemeyi sıfır
        gecikmeyle kaydetmek, ortalamayı gerçekte olmayan bir iyimserliğe
        çekerdi.
        """
        if latency_ms is None:
            return
        self.latencies.append(float(latency_ms))
        if len(self.latencies) > LATENCY_WINDOW:
            del self.latencies[0 : len(self.latencies) - LATENCY_WINDOW]

    def record_packet(self, at_ms: Optional[int] = None) -> None:
        self.packets += 1
        self.last_packet_at_ms = at_ms if at_ms is not None else int(time.time() * 1000)

    def record_error(self, message: str) -> None:
        self.errors += 1
        self.last_error = message

    def record_reconnect(self) -> None:
        self.reconnects += 1

    def mark_connected(self, at_ms: Optional[int] = None) -> None:
        self.connected_at_ms = at_ms if at_ms is not None else int(time.time() * 1000)

    def mark_disconnected(self) -> None:
        """Bağlantı kapandığında çalışma süresi sayacı durur."""
        self.connected_at_ms = None

    # -- Türetilmiş ölçüler -------------------------------------------------

    def avg_latency_ms(self) -> Optional[float]:
        """Ortalama gecikme; hiç ölçüm yoksa `None`."""
        if not self.latencies:
            return None
        return sum(self.latencies) / len(self.latencies)

    def max_latency_ms(self) -> Optional[float]:
        return max(self.latencies) if self.latencies else None

    def median_latency_ms(self) -> Optional[float]:
        """Medyan gecikme; tek bir uç değerin gizlediği tipik davranış."""
        if not self.latencies:
            return None
        ordered = sorted(self.latencies)
        middle = len(ordered) // 2
        if len(ordered) % 2 == 1:
            return ordered[middle]
        return (ordered[middle - 1] + ordered[middle]) / 2

    def uptime_ms(self, now_ms: Optional[int] = None) -> Optional[int]:
        """Bağlantının ne kadardır açık olduğu; bağlı değilse `None`."""
        if self.connected_at_ms is None:
            return None
        current = now_ms if now_ms is not None else int(time.time() * 1000)
        return max(0, current - self.connected_at_ms)

    def error_rate(self) -> Optional[float]:
        """Hata / (paket + hata); hiç deneme yoksa `None`."""
        total = self.packets + self.errors
        if total == 0:
            return None
        return self.errors / total

    def snapshot(self, now_ms: Optional[int] = None) -> Dict[str, Optional[float]]:
        """Ölçümlerin API'ye giden hâli.

        Ölçülemeyen her alan `None` olarak döner ve arayüz onu "Doğrulanmadı"
        yazar; hiçbir alan varsayılan bir sayıya çevrilmez.
        """
        return {
            "avg_latency_ms": self.avg_latency_ms(),
            "median_latency_ms": self.median_latency_ms(),
            "max_latency_ms": self.max_latency_ms(),
            "samples": len(self.latencies),
            "reconnects": self.reconnects,
            "packets": self.packets,
            "errors": self.errors,
            "error_rate": self.error_rate(),
            "uptime_ms": self.uptime_ms(now_ms),
            "last_packet_at_ms": self.last_packet_at_ms,
            "last_error": self.last_error,
        }


def retry_delay_ms(attempt: int, base_ms: int = 500, cap_ms: int = 30_000) -> int:
    """Yeniden deneme gecikmesi — üstel geri çekilme.

    İlk deneme (`attempt=0`) hemen yapılır. Sonrakiler ikişer kat artar ve bir
    tavanla sınırlanır: sabit aralıklı deneme, kapalı bir cihazı saniyede
    onlarca kez yoklar ve ağdaki sorunu büyütürdü.

    Rastgele bir sapma (jitter) **eklenmez**: birden çok bağlantının aynı anda
    denemesi bu ölçekte sorun değildir ve rastgelelik testleri belirsizleştirirdi.
    """
    if attempt <= 0:
        return 0
    delay = base_ms * (2 ** (attempt - 1))
    return min(delay, cap_ms)


def should_retry(attempt: int, max_retries: int) -> bool:
    """Bir deneme daha yapılmalı mı?"""
    return attempt < max_retries
