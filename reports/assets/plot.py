"""Графики замера детектора: четыре картинки из одного measure.json.

Ничего не зовёт модель и не читает репозитории. Вход — measure.json, который
считает measure.mjs из отчётов scan-all и arbitrate.
"""

import json
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).parent
DATA = json.loads((HERE / "measure.json").read_text(encoding="utf-8"))

INK = "#1a1a1a"
MUTED = "#6b6b6b"
FOUND = "#1d6f42"
NOISE = "#b3261e"
SOFT = "#c9c9c9"
GRID = "#e6e6e6"

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "axes.edgecolor": GRID,
        "axes.labelcolor": INK,
        "text.color": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
    }
)


def style(ax, title, subtitle=""):
    ax.set_title(title, fontsize=13, fontweight="bold", loc="left", pad=20 if subtitle else 8)
    if subtitle:
        ax.text(0, 1.015, subtitle, transform=ax.transAxes, fontsize=9, color=MUTED, va="bottom")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(GRID)
    ax.spines["bottom"].set_color(GRID)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def funnel():
    f = DATA["funnel"]
    steps = [
        ("Транскриптов прочитано", 1205),
        ("Окон, где писали код", f["windows"]),
        ("Находок формы", f["hits"]),
        ("Уникальных пар «своё → готовое»", f["pairs"]),
        ("После правила подключённости", f["afterRule"]),
        ("Проверено моделью", f["arbitrated"]),
        ("Подтверждено велосипедов", f["confirmed"]),
    ]
    labels = [s[0] for s in steps]
    values = [s[1] for s in steps]
    fig, ax = plt.subplots(figsize=(9, 4.4))
    colors = [SOFT] * (len(values) - 1) + [FOUND]
    bars = ax.barh(range(len(values)), values, color=colors, height=0.62)
    ax.set_yticks(range(len(values)))
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    for bar, value in zip(bars, values):
        ax.text(
            bar.get_width() + max(values) * 0.012,
            bar.get_y() + bar.get_height() / 2,
            str(value),
            va="center",
            fontsize=11,
            fontweight="bold",
            color=INK,
        )
    ax.set_xlim(0, max(values) * 1.12)
    style(ax, "Воронка: 1205 транскриптов → 1 велосипед", "все сессии автора, прогон 2026-11-02")
    ax.set_xlabel("сколько осталось")
    fig.tight_layout()
    fig.savefig(HERE / "funnel.png", dpi=170)
    plt.close(fig)


def separation():
    neg = DATA["negatives"]
    pos = DATA["positives"]
    values = neg["values"]

    fig, ax = plt.subplots(figsize=(9, 3.8))
    # Каждая отвергнутая пара — точка; равные значения поднимаются друг над другом.
    counts = Counter(round(v, 3) for v in values)
    for value, n in counts.items():
        for i in range(n):
            y = i * 0.16
            ax.scatter([value], [y], s=42, color=NOISE, alpha=0.75, zorder=3, linewidth=0)
    ax.scatter(
        [p["shape"] for p in pos],
        [-0.55],
        s=190,
        color=FOUND,
        zorder=5,
        edgecolor="white",
        linewidth=1.5,
    )
    for p in pos:
        ax.annotate(
            "TeamOperationQueue → KeyedMutex",
            xy=(p["shape"], -0.55),
            xytext=(p["shape"], -1.15),
            ha="center",
            fontsize=9,
            fontweight="bold",
            color=FOUND,
        )
    ax.text(
        neg["median"],
        max(counts.values()) * 0.16 + 0.42,
        f"{neg['n']} отвергнутых пар: медиана {neg['median']:.2f}, максимум {neg['max']:.2f}",
        ha="center",
        fontsize=9,
        color=NOISE,
    )
    ax.axhline(-0.32, color=GRID, linewidth=0.8)
    ax.set_ylim(-1.45, max(counts.values()) * 0.16 + 0.8)
    ax.set_yticks([])
    ax.set_xlim(0.49, 1.02)
    ax.set_xlabel("сходство формы: Жаккар с весом по редкости токена")
    style(ax, "Форма сама не отделяет велосипед", "настоящий — 0,602, ниже максимума шума 1,000")
    ax.grid(axis="y", visible=False)
    fig.tight_layout()
    fig.savefig(HERE / "separation.png", dpi=170)
    plt.close(fig)


def threshold():
    rows = DATA["thresholds"]
    xs = [r["threshold"] for r in rows]
    kept = [r["kept"] for r in rows]
    found = [r["found"] for r in rows]
    fig, ax = plt.subplots(figsize=(9, 4.2))
    ax.plot(xs, kept, color=MUTED, marker="o", linewidth=2, label="пар остаётся проверить")
    ax.plot(xs, found, color=FOUND, marker="s", linewidth=2, label="велосипедов найдено")
    ax.axvline(0.65, color=NOISE, linestyle="--", linewidth=1.2, alpha=0.8)
    ax.text(0.657, max(kept) * 0.80, "порог 0,65:\nвелосипед пропадает", fontsize=9, color=NOISE, va="top")
    for x, y in zip(xs, kept):
        ax.annotate(str(y), (x, y), textcoords="offset points", xytext=(0, 9), ha="center", fontsize=8, color=MUTED)
    ax.set_xlabel("порог сходства")
    ax.set_ylabel("пар")
    ax.set_ylim(-3, max(kept) * 1.15)
    ax.legend(frameon=False, loc="upper right")
    style(ax, "Поднять порог нельзя", "велосипед лежит ниже 22 посторонних пар")
    fig.tight_layout()
    fig.savefig(HERE / "threshold.png", dpi=170)
    plt.close(fig)


def ablate():
    runs = DATA["runs"]
    labels = [r["name"] for r in runs]
    pairs = [r["pairs"] for r in runs]
    confirmed = [r["confirmed"] for r in runs]
    false_pos = [len(r["falsePositives"]) for r in runs]

    x = np.arange(len(labels))
    width = 0.26
    fig, ax = plt.subplots(figsize=(8, 4.6))
    ax.bar(x - width, pairs, width, color=SOFT, label="пар на проверку")
    ax.bar(x, confirmed, width, color=FOUND, label="подтверждено моделью")
    ax.bar(x + width, false_pos, width, color=NOISE, label="из них ложных")
    for i, (a, b, c) in enumerate(zip(pairs, confirmed, false_pos)):
        ax.text(i - width, a + 1.5, str(a), ha="center", fontsize=10, color=MUTED)
        ax.text(i, b + 1.5, str(b), ha="center", fontsize=10, fontweight="bold", color=FOUND)
        ax.text(i + width, c + 1.5, str(c), ha="center", fontsize=10, fontweight="bold", color=NOISE)
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylabel("пар")
    ax.set_ylim(0, max(pairs) * 1.32)
    ax.legend(frameon=False, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.02))
    style(ax, "Что дали починки", "до: «велосипед», которого не было, — код дописан позже окна")
    fig.tight_layout()
    fig.savefig(HERE / "ablation.png", dpi=170)
    plt.close(fig)


funnel()
separation()
threshold()
ablate()
print("готово:", sorted(p.name for p in HERE.glob("*.png")))
