"""SlurSearchSM — поиск твитов, которые могут быть расценены как «разжигание ненависти».

Источник данных:
  * архив аккаунта X/Twitter (папка или .zip, «Скачать архив данных»);
  * либо CSV/JSON с полями id, text, created_at, username.

Результат: report.txt и report.pdf (кликабельные ссылки), report.csv, ids.txt.
Это эвристика по словарю, а не юридическое заключение — каждый результат нужно смотреть глазами.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import logging
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
DEFAULT_RULES = ROOT / "rules" / "default.json"

# Латинские буквы, которыми маскируют кириллицу ("xoхлы", "pyсские").
HOMOGLYPHS = str.maketrans("aceopxykmthb", "асеорхукмтнв")
CYRILLIC = re.compile(r"[а-яё]")
WORD = re.compile(r"\w+")


# ---------------------------------------------------------------- данные

@dataclass
class Tweet:
    id: str
    text: str
    created_at: datetime | None
    username: str
    kind: str  # tweet | reply | retweet | like


@dataclass
class Finding:
    tweet: Tweet
    score: int
    level: str
    categories: dict[str, list[str]] = field(default_factory=dict)
    combos: list[str] = field(default_factory=list)
    spans: list[tuple[int, int]] = field(default_factory=list)


def parse_twitter_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def read_ytd(raw: str) -> list:
    """Файлы архива имеют вид `window.YTD.tweets.part0 = [...]`."""
    return json.loads(raw[raw.index("=") + 1:])


class ArchiveReader:
    def __init__(self, path: Path):
        self.path = path
        self.zip = zipfile.ZipFile(path) if path.suffix.lower() == ".zip" else None

    def names(self) -> list[str]:
        if self.zip:
            return [n for n in self.zip.namelist() if n.startswith("data/")]
        return [p.relative_to(self.path).as_posix() for p in (self.path / "data").glob("*.js")]

    def read(self, name: str) -> str:
        if self.zip:
            return self.zip.read(name).decode("utf-8-sig")
        return (self.path / name).read_text(encoding="utf-8-sig")


def load_archive(path: Path, include_likes: bool) -> tuple[str, list[Tweet]]:
    reader = ArchiveReader(path)
    names = reader.names()

    username = ""
    if "data/account.js" in names:
        account = read_ytd(reader.read("data/account.js"))
        username = account[0]["account"].get("username", "")

    tweet_files = sorted(n for n in names if re.fullmatch(r"data/tweets?(-part\d+)?\.js", n))
    if not tweet_files:
        sys.exit(f"В архиве {path} не найден data/tweets.js — это точно архив X/Twitter?")

    tweets: list[Tweet] = []
    for name in tweet_files:
        for item in read_ytd(reader.read(name)):
            t = item.get("tweet", item)
            text = t.get("full_text") or t.get("text") or ""
            if text.startswith("RT @"):
                kind = "retweet"
            elif t.get("in_reply_to_status_id_str"):
                kind = "reply"
            else:
                kind = "tweet"
            tweets.append(Tweet(t["id_str"], html.unescape(text), parse_twitter_date(t.get("created_at")), username, kind))

    if include_likes and "data/like.js" in names:
        for item in read_ytd(reader.read("data/like.js")):
            like = item.get("like", item)
            if like.get("fullText"):
                tweets.append(Tweet(like["tweetId"], html.unescape(like["fullText"]), None, "", "like"))

    return username, tweets


def load_table(path: Path) -> list[Tweet]:
    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
    else:
        rows = json.loads(path.read_text(encoding="utf-8-sig"))
    return [
        Tweet(
            str(r.get("id", i)),
            html.unescape(r.get("text") or r.get("full_text") or ""),
            parse_twitter_date(r.get("created_at") or r.get("date")),
            (r.get("username") or "").lstrip("@"),
            "retweet" if (r.get("text") or "").startswith("RT @") else "tweet",
        )
        for i, r in enumerate(rows)
    ]


# ---------------------------------------------------------------- анализ

def normalize(text: str) -> str:
    """Нормализация без изменения длины строки — чтобы позиции совпадений подходили к исходному тексту."""
    lowered = "".join(c.lower() if len(c.lower()) == 1 else c for c in text).replace("ё", "е")
    return WORD.sub(lambda m: m.group().translate(HOMOGLYPHS) if CYRILLIC.search(m.group()) else m.group(), lowered)


class Rules:
    def __init__(self, paths: list[Path]):
        self.categories = {}
        self.search_terms: dict[str, list[str]] = {}
        self.combos = []
        self.levels = {"high": 6, "medium": 3}
        for path in paths:
            data = json.loads(path.read_text(encoding="utf-8"))
            for key, cat in data["categories"].items():
                pattern = "|".join(f"(?:{p})" for p in cat["patterns"])
                self.categories[key] = (cat["title"], cat["weight"], re.compile(rf"(?<!\w)(?:{pattern})"))
                if cat.get("search_terms"):
                    self.search_terms[key] = cat["search_terms"]
            self.combos += data.get("combos", [])
            self.levels.update(data.get("levels", {}))

    def title(self, key: str) -> str:
        return self.categories[key][0]

    def check(self, tweet: Tweet) -> Finding:
        norm = normalize(tweet.text)
        finding = Finding(tweet, 0, "low")
        for key, (_, weight, regex) in self.categories.items():
            matches = list(regex.finditer(norm))
            if not matches:
                continue
            finding.categories[key] = sorted({tweet.text[m.start():m.end()] for m in matches})
            finding.spans += [m.span() for m in matches]
            finding.score += weight
        for combo in self.combos:
            if all(k in finding.categories for k in combo["if_all"]):
                finding.score += combo["bonus"]
                finding.combos.append(combo["title"])
        if finding.score >= self.levels["high"]:
            finding.level = "high"
        elif finding.score >= self.levels["medium"]:
            finding.level = "medium"
        return finding


# ---------------------------------------------------------------- отчёты

LEVEL_RU = {"high": "высокий", "medium": "средний", "low": "низкий"}
KIND_RU = {"tweet": "твит", "reply": "ответ", "retweet": "ретвит", "like": "лайк"}

# Шрифты с кириллицей для PDF: (обычный, жирный).
FONT_CANDIDATES = [
    (Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arial.ttf", Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arialbd.ttf"),
    (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    (Path("/System/Library/Fonts/Supplemental/Arial.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")),
]


def tweet_url(t: Tweet) -> str:
    return f"https://x.com/{t.username or 'i/web'}/status/{t.id}"


def split_marked(text: str, spans: list[tuple[int, int]]) -> list[tuple[str, bool]]:
    """Текст, разбитый на куски: (кусок, найденное_слово)."""
    merged: list[list[int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    parts, pos = [], 0
    for start, end in merged:
        parts += [(text[pos:start], False), (text[start:end], True)]
        pos = end
    parts.append((text[pos:], False))
    return [p for p in parts if p[0]]


class Doc:
    """Простой документ, который умеет сохраняться в TXT и PDF."""

    def __init__(self, title: str):
        self.title = title
        self.items: list[tuple] = []

    def heading(self, text: str) -> None:
        self.items.append(("heading", text))

    def note(self, text: str) -> None:
        self.items.append(("note", text))

    def line(self, text: str, bold: bool = False) -> None:
        self.items.append(("line", text, bold))

    def marked(self, parts: list[tuple[str, bool]]) -> None:
        self.items.append(("marked", parts))

    def link(self, label: str, url: str) -> None:
        self.items.append(("link", label, url))

    def separator(self) -> None:
        self.items.append(("sep",))

    def save_txt(self, path: Path) -> None:
        out = [self.title, "=" * len(self.title), ""]
        for kind, *rest in self.items:
            if kind == "heading":
                out += ["", rest[0], "-" * len(rest[0])]
            elif kind in ("note", "line"):
                out.append(rest[0])
            elif kind == "marked":
                out.append("".join(f"[{s}]" if hit else s for s, hit in rest[0]))
            elif kind == "link":
                out += [rest[0], rest[1]] if rest[0] != rest[1] else [rest[1]]
            elif kind == "sep":
                out += ["", "-" * 60]
        path.write_text("\n".join(out) + "\n", encoding="utf-8-sig")

    def save_pdf(self, path: Path) -> bool:
        try:
            from fpdf import FPDF
        except ImportError:
            print("PDF пропущен: установите библиотеку командой  pip install fpdf2", file=sys.stderr)
            return False
        fonts = next(((r, b) for r, b in FONT_CANDIDATES if r.exists()), None)
        if not fonts:
            print("PDF пропущен: не найден шрифт с кириллицей (Arial или DejaVu Sans).", file=sys.stderr)
            return False

        logging.getLogger("fpdf").setLevel(logging.ERROR)  # не шуметь про эмодзи, которых нет в шрифте
        pdf = FPDF()
        pdf.set_title(self.title)
        pdf.set_auto_page_break(True, margin=15)
        pdf.add_font("main", "", str(fonts[0]))
        pdf.add_font("main", "B", str(fonts[1] if fonts[1].exists() else fonts[0]))
        pdf.add_page()
        pdf.set_font("main", "B", 16)
        pdf.multi_cell(0, 8, self.title, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

        black, gray, red, blue = (20, 20, 20), (110, 110, 110), (200, 30, 30), (20, 90, 200)
        for kind, *rest in self.items:
            pdf.set_text_color(*black)
            if kind == "heading":
                pdf.ln(4)
                pdf.set_font("main", "B", 13)
                pdf.multi_cell(0, 7, rest[0], new_x="LMARGIN", new_y="NEXT")
            elif kind == "note":
                pdf.set_font("main", "", 9)
                pdf.set_text_color(*gray)
                pdf.multi_cell(0, 5, rest[0], new_x="LMARGIN", new_y="NEXT")
            elif kind == "line":
                pdf.set_font("main", "B" if rest[1] else "", 10)
                pdf.multi_cell(0, 5, rest[0], new_x="LMARGIN", new_y="NEXT")
            elif kind == "marked":
                for text, hit in rest[0]:
                    pdf.set_font("main", "B" if hit else "", 10)
                    pdf.set_text_color(*(red if hit else black))
                    pdf.write(5, text)
                pdf.ln(6)
            elif kind == "link":
                pdf.set_font("main", "", 10)
                pdf.set_text_color(*blue)
                pdf.write(5, rest[0], link=rest[1])
                pdf.ln(6)
            elif kind == "sep":
                pdf.ln(2)
                pdf.set_draw_color(220, 220, 220)
                pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
                pdf.ln(3)
        pdf.output(str(path))
        return True


def save_doc(doc: Doc, out_dir: Path, name: str, formats: set[str]) -> list[Path]:
    saved = []
    if "txt" in formats:
        doc.save_txt(out_dir / f"{name}.txt")
        saved.append(out_dir / f"{name}.txt")
    if "pdf" in formats and doc.save_pdf(out_dir / f"{name}.pdf"):
        saved.append(out_dir / f"{name}.pdf")
    return saved


def report_doc(findings: list[Finding], rules: Rules, username: str, total: int) -> Doc:
    counts = {lvl: sum(f.level == lvl for f in findings) for lvl in LEVEL_RU}
    doc = Doc(f"Отчёт по аккаунту @{username or '—'}")
    doc.note(f"Проверено записей: {total}. Найдено: {len(findings)} (высокий риск — {counts['high']}, "
             f"средний — {counts['medium']}, низкий — {counts['low']}). Найденные слова выделены"
             " (в TXT — квадратными скобками). Это поиск по словарю, а не оценка модерации: смотрите контекст.")
    for level in LEVEL_RU:
        group = [f for f in findings if f.level == level]
        if not group:
            continue
        doc.heading(f"Риск: {LEVEL_RU[level]} ({len(group)})")
        for i, fd in enumerate(group):
            t = fd.tweet
            date = t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "дата неизвестна"
            if i:
                doc.separator()
            doc.line(f"{date} · {KIND_RU[t.kind]} · {fd.score} б.", bold=True)
            doc.marked(split_marked(t.text, fd.spans))
            doc.note("; ".join([rules.title(k) for k in fd.categories] + [f"сочетание: {c}" for c in fd.combos]))
            doc.link(tweet_url(t), tweet_url(t))
    return doc


def write_csv(path: Path, findings: list[Finding], rules: Rules) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id", "дата", "тип", "баллы", "риск", "категории", "найдено", "текст", "ссылка"])
        for fd in findings:
            t = fd.tweet
            w.writerow([
                t.id,
                t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "",
                KIND_RU[t.kind],
                fd.score,
                LEVEL_RU[fd.level],
                ", ".join(rules.title(k) for k in fd.categories),
                ", ".join(w for words in fd.categories.values() for w in words),
                t.text,
                tweet_url(t),
            ])


def search_doc(rules: Rules, username: str, only_replies: bool) -> tuple[Doc, int]:
    """Ссылки на поиск X по аккаунту — проверка без архива (открывать, войдя в X)."""
    base = f"from:{username}" + (" filter:replies" if only_replies else "")
    doc = Doc(f"Поиск по @{username}")
    doc.note("Откройте каждую ссылку в браузере, где вы вошли в X. Пустой результат — хорошо. Поиск X находит только "
             "точные словоформы и не всегда показывает очень старые записи, поэтому полную проверку даёт только архив.")
    total = 0
    for key, terms in rules.search_terms.items():
        doc.heading(rules.title(key))
        # X обрезает слишком длинные запросы — режем список слов на части.
        for i in range(0, len(terms), 8):
            chunk = terms[i:i + 8]
            query = f"{base} (" + " OR ".join(f'"{t}"' if " " in t else t for t in chunk) + ")"
            total += 1
            doc.link(f"{total}. {', '.join(chunk)}", "https://x.com/search?f=live&q=" + quote(query))
    return doc, total


# ---------------------------------------------------------------- CLI

def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Поиск рискованных твитов в аккаунте X/Twitter.")
    ap.add_argument("source", type=Path, nargs="?", help="папка/zip архива X или CSV/JSON с твитами")
    ap.add_argument("--account", help="проверять только этот аккаунт (для CSV/JSON с несколькими авторами)")
    ap.add_argument("--search-links", metavar="ИМЯ", help="без архива: сделать ссылки на поиск X по своему аккаунту")
    ap.add_argument("--rules", type=Path, action="append", help="файл словаря, можно несколько (по умолчанию rules/default.json)")
    ap.add_argument("--only-replies", action="store_true", help="проверять только ответы — по ним чаще всего ищут жалобщики")
    ap.add_argument("--out", type=Path, default=Path("report"), help="папка для отчёта")
    ap.add_argument("--format", default="txt,pdf", help="форматы отчёта через запятую: txt, pdf (по умолчанию оба)")
    ap.add_argument("--min-score", type=int, default=2, help="минимальный балл для попадания в отчёт")
    ap.add_argument("--since", help="с даты YYYY-MM-DD")
    ap.add_argument("--until", help="по дату YYYY-MM-DD")
    ap.add_argument("--include-likes", action="store_true", help="проверять и лайкнутые твиты (из архива)")
    ap.add_argument("--no-retweets", action="store_true", help="не проверять ретвиты")
    ap.add_argument("--ignore", type=Path, help="файл с id твитов, уже проверенных вручную (по одному на строку)")
    args = ap.parse_args()
    rules = Rules(args.rules or [DEFAULT_RULES])
    formats = {f.strip().lower() for f in args.format.split(",")}
    if not formats <= {"txt", "pdf"}:
        ap.error("--format: допустимы txt и pdf")
    args.out.mkdir(parents=True, exist_ok=True)

    if args.search_links:
        doc, count = search_doc(rules, args.search_links.lstrip("@"), args.only_replies)
        saved = save_doc(doc, args.out, "search", formats)
        print(f"Ссылок на поиск: {count}. Откройте, войдя в X:")
        for p in saved:
            print(f"  {p.resolve()}")
        return

    if not args.source:
        ap.error("укажите архив/файл с твитами или --search-links ИМЯ")
    if not args.source.exists():
        sys.exit(f"Не найдено: {args.source}")

    if args.source.is_dir() or args.source.suffix.lower() == ".zip":
        username, tweets = load_archive(args.source, args.include_likes)
    else:
        tweets = load_table(args.source)
        username = args.account or ""

    if args.account:
        wanted = args.account.lstrip("@").lower()
        if username and username.lower() != wanted and not any(t.username for t in tweets if t.username.lower() == wanted):
            print(f"Внимание: архив принадлежит @{username}, а не @{wanted}.", file=sys.stderr)
        tweets = [t for t in tweets if not t.username or t.username.lower() == wanted]
        username = username or wanted

    since = datetime.fromisoformat(args.since).date() if args.since else None
    until = datetime.fromisoformat(args.until).date() if args.until else None
    ignored = set(args.ignore.read_text(encoding="utf-8").split()) if args.ignore else set()

    def keep(t: Tweet) -> bool:
        if t.id in ignored or (args.no_retweets and t.kind == "retweet"):
            return False
        if args.only_replies and t.kind != "reply":
            return False
        if t.created_at and since and t.created_at.date() < since:
            return False
        if t.created_at and until and t.created_at.date() > until:
            return False
        return True

    tweets = [t for t in tweets if keep(t)]
    findings = [f for f in map(rules.check, tweets) if f.score >= args.min_score]
    findings.sort(key=lambda f: (-f.score, -(f.tweet.created_at.timestamp() if f.tweet.created_at else 0)))

    saved = save_doc(report_doc(findings, rules, username, len(tweets)), args.out, "report", formats)
    write_csv(args.out / "report.csv", findings, rules)
    (args.out / "ids.txt").write_text("\n".join(f.tweet.id for f in findings), encoding="utf-8")

    by_level = {lvl: sum(f.level == lvl for f in findings) for lvl in LEVEL_RU}
    print(f"Аккаунт: @{username or '—'}; проверено: {len(tweets)}; найдено: {len(findings)} "
          f"(высокий {by_level['high']}, средний {by_level['medium']}, низкий {by_level['low']})")
    print("Отчёт:")
    for p in saved:
        print(f"  {p.resolve()}")


if __name__ == "__main__":
    main()
