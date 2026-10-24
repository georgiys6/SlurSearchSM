/* SlurSearchSM — браузерная версия slur_search_sm.py: та же логика поиска, словари rules/*.json, те же форматы отчётов.
 * Работает целиком на стороне клиента: файлы архива никуда не отправляются.
 * Модуль без зависимостей (JSZip нужен только для чтения .zip и передаётся снаружи), подключается и в Node для проверки. */

(function (root) {
  "use strict";

  // Латинские буквы, которыми маскируют кириллицу ("xoхлы", "pyсские").
  const HOMOGLYPHS = new Map([..."aceopxykmthb"].map((c, i) => [c, "асеорхукмтнв"[i]]));
  const CYRILLIC = /[а-яё]/;
  // \w в Python юникодный, в JS — нет, поэтому буквы и цифры задаём явно.
  const W = "\\p{L}\\p{N}_";
  const WORD = new RegExp(`[${W}]+`, "gu");
  // Японские буквы (кана, иероглифы): пробелов между словами нет, поэтому после них левая граница слова не нужна.
  const JAPANESE = "\\u3005\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
  const BOUNDARY = `(?:(?<![${W}])|(?<=[${JAPANESE}]))`;

  // ---------------------------------------------------------------- данные

  function unescapeHtml(s) {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return named[e.toLowerCase()] ?? m;
    });
  }

  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  /** Дата как «настенное» время (без пересчёта часового пояса, как strftime в Python), хранится в UTC-полях Date. */
  function parseTwitterDate(value) {
    if (!value) return null;
    let m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) [+-]\d{4} (\d{4})$/.exec(value);
    if (m && m[1] in MONTHS) return new Date(Date.UTC(+m[6], MONTHS[m[1]], +m[2], +m[3], +m[4], +m[5]));
    m = /^(\d{4})-(\d{2})-(\d{2})(?:(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z)|(?: (\d{2}):(\d{2}):(\d{2})))?$/.exec(value);
    if (m) {
      const [h, mi, s] = m[4] ? [m[4], m[5], m[6]] : m[7] ? [m[7], m[8], m[9]] : [0, 0, 0];
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +h, +mi, +s));
    }
    return null;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const fmtDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const fmtDate = (d) => `${fmtDay(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

  /** Файлы архива имеют вид `window.YTD.tweets.part0 = [...]`. */
  function readYtd(raw) {
    return JSON.parse(raw.slice(raw.indexOf("=") + 1));
  }

  const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

  /** Байты файла в строку (BOM отбрасывается). */
  const decode = (bytes, encoding = "utf-8") => new TextDecoder(encoding).decode(bytes);

  /**
   * Архив X: files — Map «data/имя.js» → функция, возвращающая Promise<Uint8Array>.
   * Собирается из zip (JSZip) или из выбранной папки (см. archiveFromZip / archiveFromFiles).
   */
  async function loadArchive(files, includeLikes) {
    const read = async (name) => decode(await files.get(name)());

    let username = "";
    if (files.has("data/account.js")) {
      const account = readYtd(await read("data/account.js"));
      username = account[0].account.username || "";
    }

    const tweetFiles = [...files.keys()].filter((n) => /^data\/tweets?(-part\d+)?\.js$/.test(n)).sort();
    if (!tweetFiles.length) throw new Error("В архиве не найден data/tweets.js — это точно архив X/Twitter?");

    const tweets = [];
    for (const name of tweetFiles) {
      for (const item of readYtd(await read(name))) {
        const t = item.tweet || item;
        const text = t.full_text || t.text || "";
        const kind = text.startsWith("RT @") ? "retweet" : t.in_reply_to_status_id_str ? "reply" : "tweet";
        tweets.push({ id: t.id_str, text: unescapeHtml(text), createdAt: parseTwitterDate(t.created_at), username, kind });
      }
    }

    if (includeLikes && files.has("data/like.js")) {
      for (const item of readYtd(await read("data/like.js"))) {
        const like = item.like || item;
        if (like.fullText) tweets.push({ id: like.tweetId, text: unescapeHtml(like.fullText), createdAt: null, username: "", kind: "like" });
      }
    }

    return { username, tweets };
  }

  // Архив иногда распаковывают/запаковывают с лишней папкой сверху — ищем data/ на любом уровне.
  const DATA_FILE = /(?:^|\/)(data\/[^/]+\.js)$/;

  /** Какие файлы архива нужны и под каким именем: путь → ключ или null. По умолчанию — архив X. */
  const xArchivePath = (path) => (DATA_FILE.exec(path) || [])[1] || null;

  function archiveFromZip(zip, accept = xArchivePath) {
    const files = new Map();
    zip.forEach((path, entry) => {
      const key = entry.dir ? null : accept(path);
      if (key && !files.has(key)) files.set(key, () => entry.async("uint8array"));
    });
    return files;
  }

  /** fileList — файлы из <input webkitdirectory> или drag-and-drop папки (с полем relativePath/webkitRelativePath). */
  function archiveFromFiles(fileList, accept = xArchivePath) {
    const files = new Map();
    for (const f of fileList) {
      const key = accept(f.relativePath || f.webkitRelativePath || f.name);
      if (key && !files.has(key)) files.set(key, async () => new Uint8Array(await f.arrayBuffer()));
    }
    return files;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const [header, ...body] = rows.filter((r) => r.length > 1 || r[0]);
    return (body || []).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  }

  function loadTable(text, isCsv) {
    text = stripBom(text);
    const rows = isCsv ? parseCsv(text) : JSON.parse(text);
    return rows.map((r, i) => ({
      id: String(r.id ?? i),
      text: unescapeHtml(r.text || r.full_text || ""),
      createdAt: parseTwitterDate(r.created_at || r.date),
      username: (r.username || "").replace(/^@+/, ""),
      kind: (r.text || "").startsWith("RT @") ? "retweet" : "tweet",
    }));
  }

  // ---------------------------------------------------------------- анализ

  /** Нормализация без изменения длины строки — чтобы позиции совпадений подходили к исходному тексту.
   * Полуширинные и полноширинные формы (ｼﾈ, ＫＹＳ) приводятся к обычным. */
  function normalize(text) {
    let lowered = "";
    for (let c of text) {
      if (c >= "！" && c <= "￯") {
        const n = c.normalize("NFKC");
        if (n.length === 1) c = n;
      }
      const l = c.toLowerCase();
      lowered += l.length === c.length ? l : c;
    }
    lowered = lowered.replace(/ё/g, "е");
    return lowered.replace(WORD, (w) => (CYRILLIC.test(w) ? [...w].map((c) => HOMOGLYPHS.get(c) || c).join("") : w));
  }

  /** Перевод регулярки из словаря (Python re) в JS: \w/\W делаем юникодными, как в Python. */
  function pyRegex(pattern) {
    let out = "", inClass = false;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "\\") {
        const n = pattern[++i];
        if (n === "w") out += inClass ? W : `[${W}]`;
        else if (n === "W") out += inClass ? "\\P{L}" : `[^${W}]`; // \W внутри [] в словарях не встречается
        else out += c + n;
        continue;
      }
      if (c === "[" && !inClass) inClass = true;
      else if (c === "]" && inClass) inClass = false;
      out += c;
    }
    return out;
  }

  class Rules {
    /** datas — разобранные JSON-словари в порядке подключения. */
    constructor(datas) {
      this.categories = new Map();
      this.searchTerms = new Map();
      this.combos = [];
      this.levels = { high: 6, medium: 3 };
      // Категории с одним ключом из разных словарей объединяются (default.json + ja.json); название и вес — из первого.
      const merged = new Map();
      for (const data of datas) {
        for (const [key, cat] of Object.entries(data.categories)) {
          if (!merged.has(key)) merged.set(key, { title: cat.title, weight: cat.weight, patterns: [] });
          merged.get(key).patterns.push(...cat.patterns);
          if (cat.search_terms && cat.search_terms.length) this.searchTerms.set(key, [...(this.searchTerms.get(key) || []), ...cat.search_terms]);
        }
        this.combos.push(...(data.combos || []));
        Object.assign(this.levels, data.levels || {});
      }
      for (const [key, { title, weight, patterns }] of merged) {
        const pattern = patterns.map((p) => `(?:${pyRegex(p)})`).join("|");
        this.categories.set(key, { title, weight, regex: new RegExp(`${BOUNDARY}(?:${pattern})`, "gu") });
      }
    }

    title(key) {
      return this.categories.get(key).title;
    }

    check(tweet) {
      const norm = normalize(tweet.text);
      const finding = { tweet, score: 0, level: "low", categories: new Map(), combos: [], spans: [] };
      for (const [key, { weight, regex }] of this.categories) {
        const matches = [...norm.matchAll(regex)];
        if (!matches.length) continue;
        const spans = matches.map((m) => [m.index, m.index + m[0].length]);
        finding.categories.set(key, [...new Set(spans.map(([s, e]) => tweet.text.slice(s, e)))].sort());
        finding.spans.push(...spans);
        finding.score += weight;
      }
      for (const combo of this.combos) {
        if (combo.if_all.every((k) => finding.categories.has(k))) {
          finding.score += combo.bonus;
          finding.combos.push(combo.title);
        }
      }
      if (finding.score >= this.levels.high) finding.level = "high";
      else if (finding.score >= this.levels.medium) finding.level = "medium";
      return finding;
    }
  }

  // ---------------------------------------------------------------- отчёты

  const LEVEL_RU = { high: "высокий", medium: "средний", low: "низкий" };
  const KIND_RU = {
    tweet: "твит", reply: "ответ", retweet: "ретвит", like: "лайк",
    post: "пост", comment: "комментарий", repost: "репост", message: "сообщение",
  };
  const REPLY_KINDS = new Set(["reply", "comment"]);
  const REPOST_KINDS = new Set(["retweet", "repost"]);

  // У записей из других соцсетей ссылка приходит готовой (url), а может и отсутствовать (url: null).
  const tweetUrl = (t) => (t.url !== undefined ? t.url : `https://x.com/${t.username || "i/web"}/status/${t.id}`);
  // У сообщений Telegram рядом с типом — название чата.
  const kindLabel = (t) => (t.chat ? `${KIND_RU[t.kind]} · ${t.chat}` : KIND_RU[t.kind]);

  /** Текст, разбитый на куски: [кусок, найденное_слово]. */
  function splitMarked(text, spans) {
    const merged = [];
    for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    const parts = [];
    let pos = 0;
    for (const [start, end] of merged) {
      parts.push([text.slice(pos, start), false], [text.slice(start, end), true]);
      pos = end;
    }
    parts.push([text.slice(pos), false]);
    return parts.filter((p) => p[0]);
  }

  /** Простой документ: сохраняется в TXT и показывается на странице (оттуда — печать в PDF). */
  class Doc {
    constructor(title) {
      this.title = title;
      this.items = [];
    }
    heading(text) { this.items.push(["heading", text]); }
    note(text) { this.items.push(["note", text]); }
    line(text, bold = false) { this.items.push(["line", text, bold]); }
    marked(parts) { this.items.push(["marked", parts]); }
    link(label, url) { this.items.push(["link", label, url]); }
    separator() { this.items.push(["sep"]); }

    toTxt() {
      const out = [this.title, "=".repeat(this.title.length), ""];
      for (const [kind, ...rest] of this.items) {
        if (kind === "heading") out.push("", rest[0], "-".repeat(rest[0].length));
        else if (kind === "note" || kind === "line") out.push(rest[0]);
        else if (kind === "marked") out.push(rest[0].map(([s, hit]) => (hit ? `[${s}]` : s)).join(""));
        else if (kind === "link") out.push(...(rest[0] !== rest[1] ? [rest[0], rest[1]] : [rest[1]]));
        else if (kind === "sep") out.push("", "-".repeat(60));
      }
      return "﻿" + out.join("\n") + "\n";
    }
  }

  function reportDoc(findings, rules, username, total, title) {
    const counts = Object.fromEntries(Object.keys(LEVEL_RU).map((l) => [l, findings.filter((f) => f.level === l).length]));
    const doc = new Doc(title || `Отчёт по аккаунту @${username || "—"}`);
    doc.note(`Проверено записей: ${total}. Найдено: ${findings.length} (высокий риск — ${counts.high}, ` +
      `средний — ${counts.medium}, низкий — ${counts.low}). Найденные слова выделены` +
      " (в TXT — квадратными скобками). Это поиск по словарю, а не оценка модерации: смотрите контекст.");
    for (const level of Object.keys(LEVEL_RU)) {
      const group = findings.filter((f) => f.level === level);
      if (!group.length) continue;
      doc.heading(`Риск: ${LEVEL_RU[level]} (${group.length})`);
      group.forEach((fd, i) => {
        const t = fd.tweet;
        if (i) doc.separator();
        doc.line(`${t.createdAt ? fmtDate(t.createdAt) : "дата неизвестна"} · ${kindLabel(t)} · ${fd.score} б.`, true);
        doc.marked(splitMarked(t.text, fd.spans));
        doc.note([...[...fd.categories.keys()].map((k) => rules.title(k)), ...fd.combos.map((c) => `сочетание: ${c}`)].join("; "));
        if (tweetUrl(t)) doc.link(tweetUrl(t), tweetUrl(t));
      });
    }
    return doc;
  }

  function toCsv(findings, rules) {
    const cell = (v) => {
      v = String(v);
      return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const rows = [["id", "дата", "тип", "баллы", "риск", "категории", "найдено", "текст", "ссылка"]];
    for (const fd of findings) {
      const t = fd.tweet;
      rows.push([
        t.id,
        t.createdAt ? fmtDate(t.createdAt) : "",
        kindLabel(t),
        fd.score,
        LEVEL_RU[fd.level],
        [...fd.categories.keys()].map((k) => rules.title(k)).join(", "),
        [...fd.categories.values()].flat().join(", "),
        t.text,
        tweetUrl(t) || "",
      ]);
    }
    return "﻿" + rows.map((r) => r.map(cell).join(";") + "\r\n").join("");
  }

  // Как urllib.parse.quote: дополнительно кодируем !'()*, которые encodeURIComponent оставляет.
  const quote = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

  /** Ссылки на поиск X по аккаунту — проверка без архива (открывать, войдя в X). */
  function searchDoc(rules, username, onlyReplies) {
    const base = `from:${username}` + (onlyReplies ? " filter:replies" : "");
    const doc = new Doc(`Поиск по @${username}`);
    doc.note("Откройте каждую ссылку в браузере, где вы вошли в X. Пустой результат — хорошо. Поиск X находит только " +
      "точные словоформы и не всегда показывает очень старые записи, поэтому полную проверку даёт только архив.");
    let total = 0;
    for (const [key, terms] of rules.searchTerms) {
      doc.heading(rules.title(key));
      // X обрезает слишком длинные запросы — режем список слов на части.
      for (let i = 0; i < terms.length; i += 8) {
        const chunk = terms.slice(i, i + 8);
        const query = `${base} (` + chunk.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ") + ")";
        total += 1;
        doc.link(`${total}. ${chunk.join(", ")}`, "https://x.com/search?f=live&q=" + quote(query));
      }
    }
    return { doc, total };
  }

  // ---------------------------------------------------------------- проверка целиком

  /**
   * То же, что main() в slur_search_sm.py после загрузки данных.
   * opts: account, onlyReplies, noRetweets, since, until (YYYY-MM-DD), minScore, ignore (Set id),
   * title — заголовок отчёта для соцсетей, кроме X.
   */
  function analyze(rules, username, tweets, opts) {
    const warnings = [];
    if (opts.account) {
      const wanted = opts.account.replace(/^@+/, "").toLowerCase();
      if (username && username.toLowerCase() !== wanted && !tweets.some((t) => t.username && t.username.toLowerCase() === wanted)) {
        warnings.push(`Внимание: архив принадлежит @${username}, а не @${wanted}.`);
      }
      tweets = tweets.filter((t) => !t.username || t.username.toLowerCase() === wanted);
      username = username || wanted;
    }

    const ignore = opts.ignore || new Set();
    tweets = tweets.filter((t) => {
      if (ignore.has(t.id) || (opts.noRetweets && REPOST_KINDS.has(t.kind))) return false;
      if (opts.onlyReplies && !REPLY_KINDS.has(t.kind)) return false;
      if (t.createdAt && opts.since && fmtDay(t.createdAt) < opts.since) return false;
      if (t.createdAt && opts.until && fmtDay(t.createdAt) > opts.until) return false;
      return true;
    });

    const minScore = opts.minScore ?? 2;
    const findings = tweets.map((t) => rules.check(t)).filter((f) => f.score >= minScore);
    const ts = (f) => (f.tweet.createdAt ? f.tweet.createdAt.getTime() : 0);
    findings.sort((a, b) => b.score - a.score || ts(b) - ts(a));

    const byLevel = Object.fromEntries(Object.keys(LEVEL_RU).map((l) => [l, findings.filter((f) => f.level === l).length]));
    return {
      username,
      total: tweets.length,
      findings,
      byLevel,
      warnings,
      doc: reportDoc(findings, rules, username, tweets.length, opts.title),
      csv: toCsv(findings, rules),
      ids: findings.map((f) => f.tweet.id).join("\n"),
    };
  }

  const SlurSearchSM = {
    LEVEL_RU, KIND_RU, Rules, Doc, normalize, pyRegex, parseTwitterDate, splitMarked, decode, unescapeHtml,
    loadArchive, archiveFromZip, archiveFromFiles, loadTable, analyze, searchDoc, tweetUrl,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = SlurSearchSM;
  else root.SlurSearchSM = SlurSearchSM;
})(typeof self !== "undefined" ? self : this);
