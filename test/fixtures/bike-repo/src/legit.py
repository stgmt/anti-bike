"""Законная новая работа: разбор аргументов командной строки. Аналога в проекте нет."""

from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    """Собирает разбор аргументов команды."""
    parser = argparse.ArgumentParser(prog="carousel")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="сделать карусель из поста")
    run.add_argument("url", help="ссылка на пост блога")
    run.add_argument("--cards", type=int, default=None, help="сколько карточек")
    run.add_argument("--blind", action="store_true", help="скрыть судью до ответа автора")

    status = sub.add_parser("status", help="показать состояние прогона")
    status.add_argument("run", help="имя прогона")

    return parser
