"""Fabrika sürümlemesi: anlık görüntü özeti, yinelenme engeli, değişmezlik.

Sürümlemenin iki karşıt görevi vardır ve bu dosya ikisini de sınar.

Geçmiş korunmalıdır: bir simülasyon sonucunun hangi modelden üretildiği üç ay
sonra da kesin olarak okunabilmelidir. Bunun için sürümler **değişmezdir**;
model değiştiğinde yenisi yazılır, eskisine dokunulmaz.

Geçmiş okunabilir kalmalıdır: her "Kaydet" yeni bir sürüm üretseydi, kullanıcının
arka arkaya üç kez kaydetmesi üç özdeş sürüm bırakır ve sürüm listesi işe
yaramaz hâle gelirdi. Bunun için `config` ve `layout` üzerinden bir SHA-256
özeti hesaplanır ve aynı içerik ikinci kez sürüm yaratmaz.

Bu iki kural birlikte şu anlama gelir: **sürüm sayısı, kaydetme sayısına değil
gerçek değişiklik sayısına eşittir.**
"""

from __future__ import annotations

from typing import Any, Dict

import pytest

from simulation_engine.api.factory_storage import (
    InMemoryFactoryStore,
    compute_snapshot_hash,
    summarize_version,
)
from simulation_engine.models.schemas import (
    FactoryCreateRequest,
    FactoryLayout,
    FactorySaveRequest,
    SimulationConfig,
)
from simulation_engine.validation.test_factory_crud import config, layout


def model(**overrides: Any) -> SimulationConfig:
    return SimulationConfig.model_validate(config(**overrides))


def positions(**overrides: Any) -> FactoryLayout:
    payload: Dict[str, Any] = layout()
    payload.update(overrides)
    return FactoryLayout.model_validate(payload)


@pytest.fixture
def store() -> InMemoryFactoryStore:
    return InMemoryFactoryStore()


# --------------------------------------------------------------------------- #
# 1. Anlık görüntü özeti
# --------------------------------------------------------------------------- #


def test_same_content_gives_the_same_hash() -> None:
    """Ayni model iki kez ozetlendiginde ayni sonucu vermelidir.

    Vermeseydi sürüm enflasyonunu engellemenin hiçbir yolu kalmazdı.
    """
    assert compute_snapshot_hash(model(), positions()) == compute_snapshot_hash(
        model(), positions()
    )


def test_hash_is_independent_of_field_order() -> None:
    """Alanlarin sirasi ozeti degistirmemelidir.

    Python sözlükleri ekleme sırasını korur ve aynı model farklı yollardan
    kurulduğunda (şablondan, editörden, API'den) alanlar farklı sırada gelebilir.
    Sıralama yapılmasaydı, hiç değişmemiş bir model yeni sürüm yaratırdı.
    """
    ordered = config()
    shuffled = {key: ordered[key] for key in reversed(list(ordered))}

    assert compute_snapshot_hash(
        SimulationConfig.model_validate(ordered), None
    ) == compute_snapshot_hash(SimulationConfig.model_validate(shuffled), None)


def test_hash_is_64_hex_characters() -> None:
    digest = compute_snapshot_hash(model(), None)
    assert len(digest) == 64
    assert all(character in "0123456789abcdef" for character in digest)


@pytest.mark.parametrize(
    ("label", "changed"),
    [
        ("makine sayisi", {"num_servers": 3}),
        ("tampon kapasitesi", {"buffer_capacity_before": 25}),
        ("fire orani", {"scrap_rate": 0.09}),
        ("ariza orani", {"failure_rate": 0.05}),
        ("istasyon adi", {"name": "Montaj 2"}),
        ("hat adi", {"line_name": "Ikinci Hat"}),
    ],
)
def test_any_model_change_changes_the_hash(label: str, changed: Dict[str, Any]) -> None:
    """Modelde herhangi bir sey degistiginde ozet de degismelidir.

    Değişmeseydi gerçek bir değişiklik sessizce kaybolur ve kullanıcı
    kaydettiğini sandığı ayarı sürüm geçmişinde bulamazdı.
    """
    modified = config()
    modified["stations"][1].update(changed)

    assert compute_snapshot_hash(
        SimulationConfig.model_validate(modified), None
    ) != compute_snapshot_hash(model(), None), f"{label} ozeti degistirmedi"


def test_distribution_parameter_change_changes_the_hash() -> None:
    modified = config()
    modified["stations"][0]["service_time_distribution"]["params"]["mean"] = 2.5
    assert compute_snapshot_hash(
        SimulationConfig.model_validate(modified), None
    ) != compute_snapshot_hash(model(), None)


def test_routing_change_changes_the_hash() -> None:
    modified = config()
    modified["connections"][0]["routing_probability"] = 0.5
    assert compute_snapshot_hash(
        SimulationConfig.model_validate(modified), None
    ) != compute_snapshot_hash(model(), None)


def test_layout_is_part_of_the_snapshot() -> None:
    """Yerlesim de ozete girer.

    Kullanıcı yalnızca kutuları taşıyıp kaydettiğinde bu da bir değişikliktir ve
    saklanmalıdır. Sürüm bir bütünün anlık görüntüsüdür; yarısı sürümlenip
    yarısı yerinde güncellenseydi "sürüm 3'ü aç" belirsiz bir istek olurdu.
    """
    moved = positions(stations={"kesim": {"x": 999.0, "y": 100.0}})
    assert compute_snapshot_hash(model(), positions()) != compute_snapshot_hash(
        model(), moved
    )


def test_absent_layout_differs_from_empty_layout() -> None:
    """Yerlesim yoklugu ile bos yerlesim ayni sey degildir."""
    assert compute_snapshot_hash(model(), None) != compute_snapshot_hash(
        model(), FactoryLayout()
    )


# --------------------------------------------------------------------------- #
# 2. Yinelenme engeli
# --------------------------------------------------------------------------- #


def test_saving_the_same_model_twice_creates_one_version(
    store: InMemoryFactoryStore,
) -> None:
    """Ayni modeli iki kez kaydetmek gecmiste iz birakmaz.

    "Kaydet" düğmesine yanlışlıkla iki kez basmak bir sürüm yaratmamalıdır.
    """
    created = store.create(
        FactoryCreateRequest(name="Hat", config=model(), layout=positions())
    )
    factory_id = created.factory.id

    for _ in range(5):
        saved = store.save(
            factory_id, FactorySaveRequest(config=model(), layout=positions())
        )

    assert saved.current_version is not None
    assert saved.current_version.version_number == 1
    assert saved.factory.version_count == 1
    assert len(store.list_versions(factory_id)) == 1


def test_duplicate_save_returns_the_existing_version(
    store: InMemoryFactoryStore,
) -> None:
    created = store.create(FactoryCreateRequest(name="Hat", config=model()))
    assert created.current_version is not None
    original_id = created.current_version.id

    repeated = store.save(created.factory.id, FactorySaveRequest(config=model()))
    assert repeated.current_version is not None
    assert repeated.current_version.id == original_id


def test_duplicate_save_does_not_move_the_factory_in_the_list(
    store: InMemoryFactoryStore,
) -> None:
    """Hicbir sey degismediyse `updated_at` de degismemelidir.

    Değişseydi liste sırası oynar ve kullanıcıya yanlış biçimde "kaydedildi"
    izlenimi verirdi.
    """
    created = store.create(FactoryCreateRequest(name="Hat", config=model()))
    before = created.factory.updated_at

    store.save(created.factory.id, FactorySaveRequest(config=model()))
    assert store.get(created.factory.id).factory.updated_at == before


def test_rename_does_not_create_a_version(store: InMemoryFactoryStore) -> None:
    created = store.create(FactoryCreateRequest(name="Ilk", config=model()))
    store.save(created.factory.id, FactorySaveRequest(name="Ikinci"))
    store.save(created.factory.id, FactorySaveRequest(name="Ucuncu"))

    assert len(store.list_versions(created.factory.id)) == 1
    assert store.get(created.factory.id).factory.name == "Ucuncu"


def test_returning_to_a_previous_model_still_creates_a_version(
    store: InMemoryFactoryStore,
) -> None:
    """Eski bir modele geri donmek yeni bir surumdur.

    Özet yalnızca **güncel** sürümle karşılaştırılır, tüm geçmişle değil. Aksi
    hâlde "sürüm 2'ye geri döndüm" işlemi hiçbir iz bırakmaz ve sürüm listesi
    kullanıcının ne zaman ne yaptığını anlatmaz hâle gelirdi.
    """
    created = store.create(FactoryCreateRequest(name="Hat", config=model()))
    factory_id = created.factory.id

    changed = config()
    changed["stations"][1]["num_servers"] = 5
    store.save(
        factory_id,
        FactorySaveRequest(config=SimulationConfig.model_validate(changed)),
    )
    back = store.save(factory_id, FactorySaveRequest(config=model()))

    assert back.current_version is not None
    assert back.current_version.version_number == 3
    assert len(store.list_versions(factory_id)) == 3


# --------------------------------------------------------------------------- #
# 3. Sürüm numaralandırma ve sıralama
# --------------------------------------------------------------------------- #


def test_version_numbers_increase_by_one(store: InMemoryFactoryStore) -> None:
    """Her gercek degisiklik numarayi bir artirir.

    Taban model `montaj` istasyonunu iki makineyle tanımlar; bu yüzden döngü
    üçten başlar. İkiyle başlasaydı ilk kaydetme yinelenen bir anlık görüntü
    olur ve sürüm yaratmazdı — sayıların ondan sonra kaymaması, numaralandırma
    ile yinelenme engelinin birbirini bozmadığının da kanıtıdır.
    """
    created = store.create(FactoryCreateRequest(name="Hat", config=model()))
    factory_id = created.factory.id

    for servers in (3, 4, 5, 6):
        changed = config()
        changed["stations"][1]["num_servers"] = servers
        store.save(
            factory_id,
            FactorySaveRequest(config=SimulationConfig.model_validate(changed)),
        )

    numbers = [item.version_number for item in store.list_versions(factory_id)]
    assert numbers == [5, 4, 3, 2, 1]


def test_history_is_newest_first(store: InMemoryFactoryStore) -> None:
    """Surum gecmisi en yeniden en eskiye siralanir.

    Kullanıcının aradığı neredeyse her zaman son değişikliktir.
    """
    created = store.create(
        FactoryCreateRequest(name="Hat", config=model(), note="ilk")
    )
    changed = config()
    changed["stations"][1]["num_servers"] = 7
    store.save(
        created.factory.id,
        FactorySaveRequest(
            config=SimulationConfig.model_validate(changed), note="montaj buyudu"
        ),
    )

    history = store.list_versions(created.factory.id)
    assert [item.note for item in history] == ["montaj buyudu", "ilk"]


def test_version_numbering_is_per_factory(store: InMemoryFactoryStore) -> None:
    """Iki fabrikanin surum numaralari birbirinden bagimsizdir."""
    first = store.create(FactoryCreateRequest(name="A", config=model()))
    second = store.create(FactoryCreateRequest(name="B", config=model()))

    assert first.current_version is not None
    assert second.current_version is not None
    assert first.current_version.version_number == 1
    assert second.current_version.version_number == 1


def test_summary_omits_the_model_but_keeps_the_station_count(
    store: InMemoryFactoryStore,
) -> None:
    created = store.create(FactoryCreateRequest(name="Hat", config=model()))
    assert created.current_version is not None

    summary = summarize_version(created.current_version)
    assert summary.station_count == 2
    assert summary.snapshot_hash == created.current_version.snapshot_hash
    assert not hasattr(summary, "config")


# --------------------------------------------------------------------------- #
# 4. Değişmezlik
# --------------------------------------------------------------------------- #


def test_editing_the_factory_does_not_alter_earlier_versions(
    store: InMemoryFactoryStore,
) -> None:
    """Gecmis surumler sonradan yeniden yorumlanamaz.

    Bu, kalıcı fabrika modelinin varlık sebebidir: bir koşumun hangi tampon
    boyutlarıyla üretildiği, fabrika o tarihten sonra ne kadar değişirse
    değişsin kesin olarak okunabilmelidir.
    """
    created = store.create(
        FactoryCreateRequest(name="Hat", config=model(), layout=positions())
    )
    assert created.current_version is not None
    first_id = created.current_version.id
    first_hash = created.current_version.snapshot_hash

    for servers in (4, 6, 8):
        changed = config()
        changed["stations"][1]["num_servers"] = servers
        store.save(
            created.factory.id,
            FactorySaveRequest(config=SimulationConfig.model_validate(changed)),
        )

    original = store.get_version(created.factory.id, first_id)
    assert original.snapshot_hash == first_hash
    assert original.config.stations[1].num_servers == 2
    assert original.version_number == 1
    assert original.layout is not None
    assert original.layout.stations["kesim"].x == 0.0


def test_current_version_pointer_follows_the_newest(
    store: InMemoryFactoryStore,
) -> None:
    created = store.create(FactoryCreateRequest(name="Hat", config=model()))
    changed = config()
    changed["stations"][1]["num_servers"] = 9
    saved = store.save(
        created.factory.id,
        FactorySaveRequest(config=SimulationConfig.model_validate(changed)),
    )

    assert saved.current_version is not None
    assert saved.factory.current_version_id == saved.current_version.id
    assert store.current_version(created.factory.id).id == saved.current_version.id


# --------------------------------------------------------------------------- #
# 5. Model yeniden kurulumu
# --------------------------------------------------------------------------- #


def test_stored_version_reconstructs_the_exact_config(
    store: InMemoryFactoryStore,
) -> None:
    """Kaydedilen model, motora giden modelle birebir aynidir.

    Bu, uyarlayıcı (adapter) yaklaşımının şartıdır: kalıcı sürümden okunan
    `SimulationConfig`, kullanıcının editörde kurduğu modelden hiçbir alanda
    ayrılmamalıdır — aksi hâlde kaydedilmiş bir modelden alınan sonuç,
    kaydedilmeden alınandan farklı çıkardı.
    """
    original = model()
    created = store.create(FactoryCreateRequest(name="Hat", config=original))
    assert created.current_version is not None

    restored = store.current_version(created.factory.id).config
    assert restored.model_dump() == original.model_dump()


def test_all_simulation_relevant_fields_survive(store: InMemoryFactoryStore) -> None:
    """Sartnamede sayilan her alan kaydedilip geri okunur."""
    created = store.create(
        FactoryCreateRequest(name="Hat", config=model(), layout=positions())
    )
    version = store.current_version(created.factory.id)

    montaj = version.config.stations[1]
    assert montaj.id == "montaj"
    assert montaj.name == "Montaj"
    assert montaj.line_name == "Ana Hat"
    assert montaj.num_servers == 2
    assert montaj.service_time_distribution.params["mean"] == 3.0
    assert montaj.service_time_distribution.params["std"] == 0.5
    assert montaj.failure_rate == 0.002
    assert montaj.repair_time_distribution is not None
    assert montaj.repair_time_distribution.params["mean"] == 15.0
    assert montaj.buffer_capacity_before == 10
    assert montaj.scrap_rate == 0.02

    assert version.config.connections[0].routing_probability == 1.0
    assert version.config.arrival_process.entry_station_id == "kesim"
    assert version.config.simulation_duration_minutes == 1000.0
    assert version.config.warmup_period_minutes == 100.0
    assert version.config.num_replications == 3
    assert version.config.random_seed == 42

    assert version.layout is not None
    assert version.layout.stations["montaj"].x == 320.0
    assert version.layout.arrival is not None
    assert version.layout.arrival.x == -260.0
