"""SlurSearchSM — поиск твитов, которые могут быть расценены как «разжигание ненависти».

Источник данных:
  * архив аккаунта X/Twitter (папка или .zip, «Скачать архив данных»);
  * экспорт Telegram Desktop в JSON (result.json) — свои сообщения в чатах;
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
import unicodedata
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
DEFAULT_RULES = [ROOT / "rules" / "default.json", ROOT / "rules" / "ja.json"]

# Латинские буквы, которыми маскируют кириллицу ("xoхлы", "pyсские").
HOMOGLYPHS = str.maketrans("aceopxykmthb", "асеорхукмтнв")
CYRILLIC = re.compile(r"[а-яё]")
WORD = re.compile(r"\w+")
# Японские буквы (кана, иероглифы): пробелов между словами нет, поэтому после них левая граница слова не нужна.
JAPANESE = r"\u3005\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
BOUNDARY = rf"(?:(?<!\w)|(?<=[{JAPANESE}]))"


# ---------------------------------------------------------------- языки

# Тексты отчётов совпадают с STRINGS в web/slur_search_sm.js (отчёты скрипта и сайта должны быть одинаковыми),
# cli.* и help.* — только для скрипта.
STRINGS = {
    "ru": {
        "report.title": "Отчёт по аккаунту @{user}",
        "report.net": "Отчёт: {net}",
        "report.netUser": "Отчёт: {net}, {user}",
        "report.summary": "Проверено записей: {total}. Найдено: {found} (высокий риск — {high}, средний — {medium}, низкий — {low}). "
                          "Найденные слова выделены (в TXT — квадратными скобками). Это поиск по словарю, а не оценка модерации: смотрите контекст.",
        "report.risk": "Риск: {level} ({n})",
        "report.noDate": "дата неизвестна",
        "report.points": "{n} б.",
        "report.combo": "сочетание: {combo}",
        "level.high": "высокий", "level.medium": "средний", "level.low": "низкий",
        "kind.tweet": "твит", "kind.reply": "ответ", "kind.retweet": "ретвит", "kind.like": "лайк",
        "kind.post": "пост", "kind.comment": "комментарий", "kind.repost": "репост", "kind.message": "сообщение",
        "csv.columns": "id|дата|тип|баллы|риск|категории|найдено|текст|ссылка",
        "search.title": "Поиск по @{user}",
        "search.note": "Откройте каждую ссылку в браузере, где вы вошли в X. Пустой результат — хорошо. Поиск X находит только "
                       "точные словоформы и не всегда показывает очень старые записи, поэтому полную проверку даёт только архив.",
        "warn.owner": "Внимание: архив принадлежит @{user}, а не @{wanted}.",
        "err.noTweets": "В архиве не найден data/tweets.js — это точно архив X/Twitter?",

        "help.description": "Поиск рискованных записей в архиве X/Twitter или экспорте Telegram.",
        "help.source": "папка/zip архива X, экспорт Telegram (result.json или его папка) или CSV/JSON с записями",
        "help.account": "проверять только этот аккаунт (для CSV/JSON с несколькими авторами и экспорта одного чата Telegram)",
        "help.name": "ИМЯ",
        "help.searchLinks": "без архива: сделать ссылки на поиск X по своему аккаунту",
        "help.rules": "файл словаря, можно несколько (по умолчанию rules/default.json и rules/ja.json)",
        "help.onlyReplies": "проверять только ответы — по ним чаще всего ищут жалобщики",
        "help.out": "папка для отчёта",
        "help.format": "форматы отчёта через запятую: txt, pdf (по умолчанию оба)",
        "help.minScore": "минимальный балл для попадания в отчёт",
        "help.since": "с даты YYYY-MM-DD",
        "help.until": "по дату YYYY-MM-DD",
        "help.likes": "проверять и лайкнутые твиты (из архива)",
        "help.noRetweets": "не проверять ретвиты и репосты",
        "help.ignore": "файл с id записей, уже проверенных вручную (по одному на строку)",
        "help.lang": "язык сообщений и отчёта: ru, en, ja (по умолчанию — язык системы)",
        "cli.formatError": "--format: допустимы txt и pdf",
        "cli.searchDone": "Ссылок на поиск: {n}. Откройте, войдя в X:",
        "cli.needSource": "укажите архив/файл с записями или --search-links ИМЯ",
        "cli.notFound": "Не найдено: {path}",
        "cli.tgHtml": "Это экспорт Telegram в формате HTML (export_results.html, messages.html) — его проверить нельзя. Повторите экспорт и внизу окна экспорта в поле «Формат» выберите «Машиночитаемый JSON» (или «Оба»): тогда появится result.json.",
        "cli.tgNoOwner": "Внимание: в экспорте одного чата нет данных о владельце — проверяются сообщения всех участников. "
                         'Чтобы проверить только свои, укажите --account "ваше имя в Telegram".',
        "cli.summary": "Аккаунт: @{user}; проверено: {total}; найдено: {found} (высокий {high}, средний {medium}, низкий {low})",
        "cli.report": "Отчёт:",
        "cli.noFpdf": "PDF пропущен: установите библиотеку командой  pip install fpdf2",
        "cli.noFont": "PDF пропущен: не найден шрифт с кириллицей (Arial или DejaVu Sans).",
        "cli.noCjkFont": "PDF: не найден японский шрифт (Yu Gothic, MS Gothic, Noto Sans CJK, Hiragino) — японский текст в PDF не отобразится.",
    },
    "en": {
        "report.title": "Report for @{user}",
        "report.net": "Report: {net}",
        "report.netUser": "Report: {net}, {user}",
        "report.summary": "Posts checked: {total}. Found: {found} (high risk — {high}, medium — {medium}, low — {low}). "
                          "Matched words are highlighted (in square brackets in TXT). This is a dictionary search, not a moderation verdict: check the context.",
        "report.risk": "Risk: {level} ({n})",
        "report.noDate": "date unknown",
        "report.points": "{n} pts",
        "report.combo": "combination: {combo}",
        "level.high": "high", "level.medium": "medium", "level.low": "low",
        "kind.tweet": "tweet", "kind.reply": "reply", "kind.retweet": "retweet", "kind.like": "like",
        "kind.post": "post", "kind.comment": "comment", "kind.repost": "repost", "kind.message": "message",
        "csv.columns": "id|date|type|score|risk|categories|matches|text|link",
        "search.title": "Search for @{user}",
        "search.note": "Open each link in a browser where you are logged in to X. An empty result is good. X search finds only "
                       "exact word forms and does not always show very old posts, so only the archive gives a complete check.",
        "warn.owner": "Warning: the archive belongs to @{user}, not @{wanted}.",
        "err.noTweets": "data/tweets.js not found in the archive — is this really an X/Twitter archive?",

        "help.description": "Find risky posts in an X/Twitter archive or a Telegram export.",
        "help.source": "X archive folder/zip, Telegram export (result.json or its folder), or CSV/JSON with posts",
        "help.account": "check only this account (for CSV/JSON with several authors and single-chat Telegram exports)",
        "help.name": "NAME",
        "help.searchLinks": "no archive: make X search links for your account",
        "help.rules": "dictionary file, can be repeated (default: rules/default.json and rules/ja.json)",
        "help.onlyReplies": "check replies only — mass reporters search these most often",
        "help.out": "report folder",
        "help.format": "report formats, comma-separated: txt, pdf (default: both)",
        "help.minScore": "minimum score to include in the report",
        "help.since": "from date YYYY-MM-DD",
        "help.until": "to date YYYY-MM-DD",
        "help.likes": "also check liked tweets (from the archive)",
        "help.noRetweets": "skip retweets and reposts",
        "help.ignore": "file with ids already reviewed manually (one per line)",
        "help.lang": "message and report language: ru, en, ja (default: system language)",
        "cli.formatError": "--format: allowed values are txt and pdf",
        "cli.searchDone": "Search links: {n}. Open them while logged in to X:",
        "cli.needSource": "specify an archive/file with posts or --search-links NAME",
        "cli.notFound": "Not found: {path}",
        "cli.tgHtml": "This is a Telegram export in HTML format (export_results.html, messages.html), which cannot be checked. Export again and at the bottom of the export window set “Format” to “Machine-readable JSON” (or “Both”) to get result.json.",
        "cli.tgNoOwner": "Warning: a single-chat export has no owner info, so messages from all participants are checked. "
                         'To check only yours, add --account "your Telegram name".',
        "cli.summary": "Account: @{user}; checked: {total}; found: {found} (high {high}, medium {medium}, low {low})",
        "cli.report": "Report:",
        "cli.noFpdf": "PDF skipped: install the library with  pip install fpdf2",
        "cli.noFont": "PDF skipped: no font with Cyrillic found (Arial or DejaVu Sans).",
        "cli.noCjkFont": "PDF: no Japanese font found (Yu Gothic, MS Gothic, Noto Sans CJK, Hiragino) — Japanese text will not show in the PDF.",
    },
    "ja": {
        "report.title": "@{user} のレポート",
        "report.net": "レポート: {net}",
        "report.netUser": "レポート: {net}、{user}",
        "report.summary": "チェックした投稿: {total}件。検出: {found}件（高リスク {high}、中リスク {medium}、低リスク {low}）。"
                          "該当語は強調表示されます（TXTでは [ ] で囲みます）。これは辞書による検索で、モデレーションの判定ではありません。必ず文脈を確認してください。",
        "report.risk": "リスク: {level}（{n}件）",
        "report.noDate": "日付不明",
        "report.points": "{n}点",
        "report.combo": "組み合わせ: {combo}",
        "level.high": "高", "level.medium": "中", "level.low": "低",
        "kind.tweet": "ツイート", "kind.reply": "返信", "kind.retweet": "リツイート", "kind.like": "いいね",
        "kind.post": "投稿", "kind.comment": "コメント", "kind.repost": "リポスト", "kind.message": "メッセージ",
        "csv.columns": "id|日時|種類|点数|リスク|カテゴリ|検出語|本文|リンク",
        "search.title": "@{user} の検索",
        "search.note": "Xにログインしているブラウザで各リンクを開いてください。結果が空なら問題ありません。Xの検索は完全一致の語形しか見つけず、"
                       "古い投稿は表示されないこともあるため、完全なチェックにはアーカイブが必要です。",
        "warn.owner": "注意: このアーカイブは @{wanted} ではなく @{user} のものです。",
        "err.noTweets": "アーカイブに data/tweets.js がありません。X/Twitterのアーカイブで間違いありませんか？",

        "help.description": "X/Twitterのアーカイブ、またはTelegramのエクスポートから危険な投稿を探します。",
        "help.source": "Xのアーカイブ（フォルダ/zip）、Telegramのエクスポート（result.jsonまたはそのフォルダ）、または投稿のCSV/JSON",
        "help.account": "このアカウントのみチェック（複数の投稿者を含むCSV/JSONや、Telegramの1チャットのエクスポート用）",
        "help.name": "名前",
        "help.searchLinks": "アーカイブなし: 自分のアカウントのX検索リンクを作成",
        "help.rules": "辞書ファイル、複数指定可（既定: rules/default.json と rules/ja.json）",
        "help.onlyReplies": "返信のみチェック（通報者が最もよく探す対象）",
        "help.out": "レポートの保存先フォルダ",
        "help.format": "レポート形式（カンマ区切り）: txt, pdf（既定: 両方）",
        "help.minScore": "レポートに含める最低点数",
        "help.since": "開始日 YYYY-MM-DD",
        "help.until": "終了日 YYYY-MM-DD",
        "help.likes": "いいねしたツイートもチェック（アーカイブから）",
        "help.noRetweets": "リツイート・リポストを除外",
        "help.ignore": "手動で確認済みのIDのファイル（1行に1つ）",
        "help.lang": "メッセージとレポートの言語: ru, en, ja（既定: システムの言語）",
        "cli.formatError": "--format: 指定できるのは txt と pdf です",
        "cli.searchDone": "検索リンク: {n}件。Xにログインした状態で開いてください:",
        "cli.needSource": "投稿のアーカイブ/ファイル、または --search-links 名前 を指定してください",
        "cli.notFound": "見つかりません: {path}",
        "cli.tgHtml": "これはHTML形式のTelegramエクスポート（export_results.html、messages.html）のため、チェックできません。もう一度エクスポートし、エクスポート画面下部の「形式」で「JSON（機械可読）」（または「両方」）を選ぶと result.json が作成されます。",
        "cli.tgNoOwner": "注意: 1つのチャットのエクスポートには所有者の情報がないため、全参加者のメッセージをチェックします。"
                         '自分のメッセージだけにするには --account "Telegramの表示名" を指定してください。',
        "cli.summary": "アカウント: @{user}。チェック: {total}件、検出: {found}件（高 {high}、中 {medium}、低 {low}）",
        "cli.report": "レポート:",
        "cli.noFpdf": "PDFを省略しました: pip install fpdf2 でライブラリをインストールしてください",
        "cli.noFont": "PDFを省略しました: キリル文字を含むフォント（Arial または DejaVu Sans）が見つかりません。",
        "cli.noCjkFont": "PDF: 日本語フォント（Yu Gothic、MS Gothic、Noto Sans CJK、ヒラギノ）が見つからないため、PDFに日本語が表示されません。",
    },
}
LANG = "ru"  # main() ставит язык системы или --lang


def system_lang() -> str:
    """Язык системы: ru или ja, для остальных — en. В Windows — язык интерфейса, иначе — переменные LC_ALL/LANG и локаль."""
    import locale

    names = []
    if sys.platform == "win32":
        import ctypes

        names.append(locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage(), ""))
    names += [os.environ.get(v, "") for v in ("LC_ALL", "LC_MESSAGES", "LANG")]
    names.append(locale.getlocale()[0] or "")
    for name in names:
        code = name.lower()[:2]  # ru_RU, ja_JP.UTF-8, Russian_Russia
        if code in STRINGS:
            return code
        if code and code != "c.":
            return "en"
    return "en"


def tr(key: str, **params) -> str:
    """Текст по ключу на языке LANG с подстановкой {имя}."""
    text = STRINGS[LANG].get(key) or STRINGS["ru"][key]
    return text.format(**params) if params else text


def localized(obj: dict) -> str:
    """Название из словаря на языке отчёта: titles[язык], иначе title."""
    return (obj.get("titles") or {}).get(LANG) or obj["title"]


# ---------------------------------------------------------------- данные

@dataclass
class Tweet:
    id: str
    text: str
    created_at: datetime | None
    username: str
    kind: str  # tweet | reply | retweet | like | message | repost
    url: str | None = ""  # "" — ссылка на X по id, None — ссылки нет (личные чаты Telegram)
    chat: str = ""  # название чата Telegram


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
        sys.exit(f"{path}: {tr('err.noTweets')}")

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


# Чаты, у которых есть ссылки вида t.me/c/<id чата>/<id сообщения> (открываются у участников чата).
# Страницы экспорта в формате HTML: export_results.html (весь аккаунт), messages.html, messages2.html… (чат).
TG_HTML = re.compile(r"(?:export_results|messages\d*)\.html", re.IGNORECASE)
TG_LINKED = {"private_supergroup", "public_supergroup", "private_channel", "public_channel"}


def read_telegram(path: Path) -> dict | None:
    """result.json экспорта Telegram Desktop: сам файл, папка экспорта или zip с ней. None — это не Telegram.
    Экспорт в HTML (формат по умолчанию) не разбирается — выходим с подсказкой, как переэкспортировать в JSON."""
    if path.is_dir():
        found = next(path.rglob("result.json"), None)
        if not found and any(TG_HTML.fullmatch(p.name) for p in path.rglob("*.html")):
            sys.exit(tr("cli.tgHtml"))
        return json.loads(found.read_text(encoding="utf-8-sig")) if found else None
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            name = next((n for n in names if n.split("/")[-1] == "result.json"), None)
            if not name and any(TG_HTML.fullmatch(n.split("/")[-1]) for n in names):
                sys.exit(tr("cli.tgHtml"))
            return json.loads(z.read(name).decode("utf-8-sig")) if name else None
    if TG_HTML.fullmatch(path.name):
        sys.exit(tr("cli.tgHtml"))
    if path.suffix.lower() != ".json":
        return None
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    return data if isinstance(data, dict) and ("chats" in data or "messages" in data) else None


def tg_text(text) -> str:
    """Текст сообщения: строка или список кусков (строки и {"type": "bold", "text": ...})."""
    if isinstance(text, str):
        return text
    return "".join(p if isinstance(p, str) else p.get("text", "") for p in text or [])


def load_telegram(data: dict) -> tuple[str, list[Tweet], bool]:
    """Свои сообщения из экспорта Telegram (полного или одного чата, включая группы, из которых вы вышли).
    В экспорте одного чата владелец неизвестен — тогда берутся все сообщения, а имя автора кладётся в username,
    чтобы свои можно было отобрать через --account. Третье значение — известен ли владелец."""
    info = data.get("personal_information") or {}
    me = f"user{info['user_id']}" if info.get("user_id") else None
    username = (info.get("username") or "").lstrip("@") or " ".join(filter(None, [info.get("first_name"), info.get("last_name")]))
    if "messages" in data:
        chats = [data]
    else:
        chats = (data.get("chats") or {}).get("list", []) + (data.get("left_chats") or {}).get("list", [])
    tweets = []
    for chat in chats:
        chat_id = str(chat.get("id", "")).removeprefix("-100").lstrip("-")
        for m in chat.get("messages", []):
            text = tg_text(m.get("text"))
            if m.get("type") != "message" or not text or (me and m.get("from_id") != me):
                continue
            tweets.append(Tweet(
                f"{chat_id}_{m['id']}",
                text,
                parse_twitter_date((m.get("date") or "").replace("T", " ")),
                "" if me else (m.get("from") or ""),
                "repost" if m.get("forwarded_from") else "reply" if m.get("reply_to_message_id") else "message",
                f"https://t.me/c/{chat_id}/{m['id']}" if chat.get("type") in TG_LINKED else None,
                chat.get("name") or "",
            ))
    return username, tweets, bool(me)


# ---------------------------------------------------------------- анализ

def unwiden(c: str) -> str:
    n = unicodedata.normalize("NFKC", c)
    return n if len(n) == 1 else c


def normalize(text: str) -> str:
    """Нормализация без изменения длины строки — чтобы позиции совпадений подходили к исходному тексту.
    Полуширинные и полноширинные формы (ｼﾈ, ＫＹＳ) приводятся к обычным."""
    width = "".join(unwiden(c) if "\uff01" <= c <= "\uffef" else c for c in text)
    lowered = "".join(c.lower() if len(c.lower()) == 1 else c for c in width).replace("ё", "е")
    return WORD.sub(lambda m: m.group().translate(HOMOGLYPHS) if CYRILLIC.search(m.group()) else m.group(), lowered)


class Rules:
    def __init__(self, paths: list[Path]):
        self.categories = {}
        self.search_terms: dict[str, list[str]] = {}
        self.combos = []
        self.levels = {"high": 6, "medium": 3}
        # Категории с одним ключом из разных словарей объединяются (default.json + ja.json); название и вес — из первого.
        merged: dict[str, tuple[dict, int, list[str]]] = {}
        for path in paths:
            data = json.loads(path.read_text(encoding="utf-8"))
            for key, cat in data["categories"].items():
                merged.setdefault(key, (cat, cat["weight"], []))[2].extend(cat["patterns"])
                if cat.get("search_terms"):
                    self.search_terms.setdefault(key, []).extend(cat["search_terms"])
            self.combos += data.get("combos", [])
            self.levels.update(data.get("levels", {}))
        for key, (cat, weight, patterns) in merged.items():
            pattern = "|".join(f"(?:{p})" for p in patterns)
            self.categories[key] = (cat, weight, re.compile(rf"{BOUNDARY}(?:{pattern})"))

    def title(self, key: str) -> str:
        return localized(self.categories[key][0])

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
                finding.combos.append(localized(combo))
        if finding.score >= self.levels["high"]:
            finding.level = "high"
        elif finding.score >= self.levels["medium"]:
            finding.level = "medium"
        return finding


# ---------------------------------------------------------------- отчёты

LEVELS = ("high", "medium", "low")

# Шрифты с кириллицей для PDF: (обычный, жирный).
FONT_CANDIDATES = [
    (Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arial.ttf", Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arialbd.ttf"),
    (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    (Path("/System/Library/Fonts/Supplemental/Arial.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")),
]
# Шрифты с японскими иероглифами и каной — запасные: из них берутся символы, которых нет в основном шрифте.
CJK_FONT_CANDIDATES = [
    Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / name for name in ("YuGothR.ttc", "meiryo.ttc", "msgothic.ttc")
] + [
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    Path("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"),
    Path("/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc"),
    Path("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"),
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
    Path("/Library/Fonts/Arial Unicode.ttf"),
]


def tweet_url(t: Tweet) -> str | None:
    return f"https://x.com/{t.username or 'i/web'}/status/{t.id}" if t.url == "" else t.url


def kind_label(t: Tweet) -> str:
    kind = tr(f"kind.{t.kind}")
    return f"{kind} · {t.chat}" if t.chat else kind


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
            print(tr("cli.noFpdf"), file=sys.stderr)
            return False
        fonts = next(((r, b) for r, b in FONT_CANDIDATES if r.exists()), None)
        if not fonts:
            print(tr("cli.noFont"), file=sys.stderr)
            return False

        logging.getLogger("fpdf").setLevel(logging.ERROR)  # не шуметь про эмодзи, которых нет в шрифте
        pdf = FPDF()
        pdf.set_title(self.title)
        pdf.set_auto_page_break(True, margin=15)
        pdf.add_font("main", "", str(fonts[0]))
        pdf.add_font("main", "B", str(fonts[1] if fonts[1].exists() else fonts[0]))
        if re.search(f"[{JAPANESE}]", self.title + repr(self.items)):
            cjk = next((p for p in CJK_FONT_CANDIDATES if p.exists()), None)
            if cjk:
                pdf.add_font("cjk", "", str(cjk))
                pdf.set_fallback_fonts(["cjk"], exact_match=False)
            else:
                print(tr("cli.noCjkFont"), file=sys.stderr)
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


def report_doc(findings: list[Finding], rules: Rules, username: str, total: int, title: str | None = None) -> Doc:
    counts = {lvl: sum(f.level == lvl for f in findings) for lvl in LEVELS}
    doc = Doc(title or tr("report.title", user=username or "—"))
    doc.note(tr("report.summary", total=total, found=len(findings), **counts))
    for level in LEVELS:
        group = [f for f in findings if f.level == level]
        if not group:
            continue
        doc.heading(tr("report.risk", level=tr(f"level.{level}"), n=len(group)))
        for i, fd in enumerate(group):
            t = fd.tweet
            date = t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else tr("report.noDate")
            if i:
                doc.separator()
            doc.line(f"{date} · {kind_label(t)} · {tr('report.points', n=fd.score)}", bold=True)
            doc.marked(split_marked(t.text, fd.spans))
            doc.note("; ".join([rules.title(k) for k in fd.categories] + [tr("report.combo", combo=c) for c in fd.combos]))
            if url := tweet_url(t):
                doc.link(url, url)
    return doc


def write_csv(path: Path, findings: list[Finding], rules: Rules) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(tr("csv.columns").split("|"))
        for fd in findings:
            t = fd.tweet
            w.writerow([
                t.id,
                t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "",
                kind_label(t),
                fd.score,
                tr(f"level.{fd.level}"),
                ", ".join(rules.title(k) for k in fd.categories),
                ", ".join(w for words in fd.categories.values() for w in words),
                t.text,
                tweet_url(t) or "",
            ])


def search_doc(rules: Rules, username: str, only_replies: bool) -> tuple[Doc, int]:
    """Ссылки на поиск X по аккаунту — проверка без архива (открывать, войдя в X)."""
    base = f"from:{username}" + (" filter:replies" if only_replies else "")
    doc = Doc(tr("search.title", user=username))
    doc.note(tr("search.note"))
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
    global LANG
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    # Язык нужен до разбора аргументов — на нём выводится --help.
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--lang", choices=list(STRINGS))
    LANG = pre.parse_known_args()[0].lang or system_lang()

    ap = argparse.ArgumentParser(description=tr("help.description"))
    ap.add_argument("source", type=Path, nargs="?", help=tr("help.source"))
    ap.add_argument("--account", help=tr("help.account"))
    ap.add_argument("--search-links", metavar=tr("help.name"), help=tr("help.searchLinks"))
    ap.add_argument("--rules", type=Path, action="append", help=tr("help.rules"))
    ap.add_argument("--only-replies", action="store_true", help=tr("help.onlyReplies"))
    ap.add_argument("--out", type=Path, default=Path("report"), help=tr("help.out"))
    ap.add_argument("--format", default="txt,pdf", help=tr("help.format"))
    ap.add_argument("--min-score", type=int, default=2, help=tr("help.minScore"))
    ap.add_argument("--since", help=tr("help.since"))
    ap.add_argument("--until", help=tr("help.until"))
    ap.add_argument("--include-likes", action="store_true", help=tr("help.likes"))
    ap.add_argument("--no-retweets", action="store_true", help=tr("help.noRetweets"))
    ap.add_argument("--ignore", type=Path, help=tr("help.ignore"))
    ap.add_argument("--lang", choices=list(STRINGS), help=tr("help.lang"))
    args = ap.parse_args()
    rules = Rules(args.rules or DEFAULT_RULES)
    formats = {f.strip().lower() for f in args.format.split(",")}
    if not formats <= {"txt", "pdf"}:
        ap.error(tr("cli.formatError"))
    args.out.mkdir(parents=True, exist_ok=True)

    if args.search_links:
        doc, count = search_doc(rules, args.search_links.lstrip("@"), args.only_replies)
        saved = save_doc(doc, args.out, "search", formats)
        print(tr("cli.searchDone", n=count))
        for p in saved:
            print(f"  {p.resolve()}")
        return

    if not args.source:
        ap.error(tr("cli.needSource"))
    if not args.source.exists():
        sys.exit(tr("cli.notFound", path=args.source))

    title = None
    telegram = read_telegram(args.source)
    if telegram is not None:
        username, tweets, owner_known = load_telegram(telegram)
        title = tr("report.netUser" if username else "report.net", net="Telegram", user=username)
        if not owner_known and not args.account:
            print(tr("cli.tgNoOwner"), file=sys.stderr)
    elif args.source.is_dir() or args.source.suffix.lower() == ".zip":
        username, tweets = load_archive(args.source, args.include_likes)
    else:
        tweets = load_table(args.source)
        username = args.account or ""

    if args.account:
        wanted = args.account.lstrip("@").lower()
        if username and username.lower() != wanted and not any(t.username for t in tweets if t.username.lower() == wanted):
            print(tr("warn.owner", user=username, wanted=wanted), file=sys.stderr)
        tweets = [t for t in tweets if not t.username or t.username.lower() == wanted]
        username = username or wanted

    since = datetime.fromisoformat(args.since).date() if args.since else None
    until = datetime.fromisoformat(args.until).date() if args.until else None
    ignored = set(args.ignore.read_text(encoding="utf-8").split()) if args.ignore else set()

    def keep(t: Tweet) -> bool:
        if t.id in ignored or (args.no_retweets and t.kind in ("retweet", "repost")):
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

    saved = save_doc(report_doc(findings, rules, username, len(tweets), title), args.out, "report", formats)
    write_csv(args.out / "report.csv", findings, rules)
    (args.out / "ids.txt").write_text("\n".join(f.tweet.id for f in findings), encoding="utf-8")

    by_level = {lvl: sum(f.level == lvl for f in findings) for lvl in LEVELS}
    print(tr("cli.summary", user=username or "—", total=len(tweets), found=len(findings), **by_level))
    print(tr("cli.report"))
    for p in saved:
        print(f"  {p.resolve()}")


if __name__ == "__main__":
    main()
