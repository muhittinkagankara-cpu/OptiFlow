"""Yedekleme ve geri yükleme komut satırı aracı.

Neden API değil de komut satırı
-------------------------------
Yedek almanın en çok ihtiyaç duyulduğu an, uygulamanın açılamadığı andır. API
üzerinden yedek almak, o anda çalışmayan bir bileşene bağımlı olmak demektir.
Bu araç yalnızca veritabanına bağlanır; uygulamanın ayakta olması gerekmez.

Kullanım
--------
    python -m simulation_engine.runtime.ops.cli backup  --org <kimlik> --out yedek.json
    python -m simulation_engine.runtime.ops.cli verify  --file yedek.json
    python -m simulation_engine.runtime.ops.cli restore --file yedek.json --org <kimlik>

`DATABASE_URL` tanımlı değilse araç **çalışmaz** ve bunu söyler: bellek
deposundan yedek almak, boş bir dosya üretip "yedek alındı" demek olurdu.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Optional

from simulation_engine.api.storage import DATABASE_URL_ENV
from simulation_engine.runtime.ops.backup import (
    create_backup,
    restore_backup,
    summarize_backup,
    verify_backup,
)

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_FAILED = 1


def _repository(database_url: Optional[str]):
    """Veritabanı deposunu kurar; adres yoksa `None`."""
    url = database_url or os.environ.get(DATABASE_URL_ENV)
    if not url:
        return None

    from simulation_engine.runtime.persistence.repository import (
        DatabaseRuntimeRepository,
    )

    return DatabaseRuntimeRepository(url)


def run_backup(args: argparse.Namespace, out=sys.stdout) -> int:
    repository = _repository(args.database_url)
    if repository is None:
        print(
            f"{DATABASE_URL_ENV} tanimli degil; bellek deposundan yedek alinamaz.",
            file=out,
        )
        return EXIT_USAGE

    payload = create_backup(repository, args.org)
    summary = summarize_backup(payload)

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    print(
        f"Yedek alindi: {args.out} ({summary.total_rows} satir, "
        f"saglama {summary.checksum[:12]})",
        file=out,
    )
    return EXIT_OK


def run_verify(args: argparse.Namespace, out=sys.stdout) -> int:
    with open(args.file, encoding="utf-8") as handle:
        payload = json.load(handle)

    problems = verify_backup(payload)
    if problems:
        print("Yedek dogrulanamadi:", file=out)
        for problem in problems:
            print(f"  - {problem}", file=out)
        return EXIT_FAILED

    summary = summarize_backup(payload)
    print(
        f"Yedek saglam: {summary.total_rows} satir, "
        f"kiraci {summary.org_id}, saglama {summary.checksum[:12]}",
        file=out,
    )
    return EXIT_OK


def run_restore(args: argparse.Namespace, out=sys.stdout) -> int:
    repository = _repository(args.database_url)
    if repository is None:
        print(f"{DATABASE_URL_ENV} tanimli degil; geri yukleme yapilamaz.", file=out)
        return EXIT_USAGE

    with open(args.file, encoding="utf-8") as handle:
        payload = json.load(handle)

    problems = verify_backup(payload)
    if problems:
        # Bozuk bir yedegi yuklemek, veriyi kaybetmenin en sessiz yoludur.
        print("Yedek dogrulanamadi; geri yukleme yapilmadi:", file=out)
        for problem in problems:
            print(f"  - {problem}", file=out)
        return EXIT_FAILED

    result = restore_backup(repository, payload, org_id=args.org)
    if not result.ok:
        print(f"Geri yukleme basarisiz: {result.error}", file=out)
        return EXIT_FAILED

    print(
        f"Geri yuklendi: {result.total_restored} satir "
        f"(kiraci {result.org_id})",
        file=out,
    )
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="optiflow-backup",
        description="OptiFlow runtime yedekleme ve geri yukleme araci",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help=f"Veritabani adresi; verilmezse {DATABASE_URL_ENV} okunur.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    backup = sub.add_parser("backup", help="Yedek al")
    backup.add_argument("--org", required=True, help="Organizasyon kimligi")
    backup.add_argument("--out", required=True, help="Yazilacak dosya")

    verify = sub.add_parser("verify", help="Yedegi dogrula")
    verify.add_argument("--file", required=True, help="Yedek dosyasi")

    restore = sub.add_parser("restore", help="Yedegi geri yukle")
    restore.add_argument("--file", required=True, help="Yedek dosyasi")
    restore.add_argument(
        "--org",
        default=None,
        help="Hedef kiraci; verilmezse yedegin kendi kiracisi kullanilir.",
    )

    return parser


def main(argv: Optional[List[str]] = None, out=sys.stdout) -> int:
    args = build_parser().parse_args(argv)
    handlers = {"backup": run_backup, "verify": run_verify, "restore": run_restore}
    return handlers[args.command](args, out=out)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
