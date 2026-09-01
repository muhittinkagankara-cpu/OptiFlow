"""Doğrulama test paketi — Şartname Bölüm 4.

Modüller:
    test_mm1_analytical.py    TEST 1 — M/M/1 analitik vs. simülasyon
    test_littles_law.py       TEST 2 — L = lambda * W tutarlılık testi
    test_bottleneck.py        TEST 4 — darboğaz tespiti ve Drum-Buffer-Rope
    test_known_scenarios.py   TEST 4 — literatürdeki bilinen vaka çalışmaları
    test_queueing_theory.py   Bölüm 3.1-3.2 — M/M/1 ve Erlang-C
    test_oee.py               Bölüm 3.4 — OEE bileşenleri
    test_takt_time.py         Bölüm 3.5 — takt time ve RPW hat dengeleme
    test_monte_carlo.py       Bölüm 3.7 — güven aralığı ve kapsama
    test_api.py               Bölüm 5 — FastAPI uçları

TEST 3 (kararlılık kontrolü) `test_queueing_theory.py` ve motorun kararlılık
ön denetiminde, TEST 5 (reprodüktibilite) ise `test_monte_carlo.py`,
`test_oee.py` ve `test_api.py` içinde doğrulanır.

`test_known_scenarios.py` özel bir yer tutar: motoru, `analytics/` katmanının
uygulamadığı kapalı formlarla (Erlang-B kayıp sistemi, M/M/1/K, Pollaczek-
Khinchine, Burke/Jackson ağı) karşılaştırır. Referans formüller o modülün
içinde bağımsız olarak yazılmıştır; böylece motor ve referans ortak bir hatayı
paylaşamaz.

Tümünü çalıştırmak için:

    python -m pytest simulation_engine/validation/ -v

Rapor tablolarını da görmek için `-s` bayrağı eklenmelidir.
"""
