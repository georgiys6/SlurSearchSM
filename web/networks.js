/* Другие соцсети: откуда брать записи и как их превратить в общий вид { id, text, createdAt, username, kind, url }.
 * Проверка и отчёты — общие, из slur_search_sm.js. X описан здесь же, но читается старым загрузчиком SlurSearchSM.loadArchive. */

(function (root) {
  "use strict";

  const SlurSearchSM = root.SlurSearchSM || (typeof require !== "undefined" ? require("./slur_search_sm.js") : null);
  const I18N = root.I18N || (typeof require !== "undefined" ? require("./i18n.js") : null);
  const t = (key, params) => I18N.t(key, params);

  // ---------------------------------------------------------------- общее

  const fromUnix = (sec) => (sec ? new Date(sec * 1000) : null);

  function fromIso(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Обход JSON: fn вызывается для каждого объекта (не массива) на любой глубине. */
  function walk(node, fn) {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, fn);
    } else if (node && typeof node === "object") {
      fn(node);
      for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, fn);
    }
  }

  async function readJson(files, key) {
    try {
      return JSON.parse(SlurSearchSM.decode(await files.get(key)()));
    } catch (e) {
      return null; // не JSON или битый файл — пропускаем, в архивах Meta много служебных файлов
    }
  }

  /**
   * Facebook и Instagram пишут UTF-8 как latin-1 escape-последовательности («Ð¿Ñ\u0080Ð¸Ð²ÐµÑ\u0082» вместо «привет»).
   * Если строка похожа на такую кашу — перекодируем.
   */
  function fixMeta(s) {
    if (typeof s !== "string" || !/[À-ÿ][\u0080-¿]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    } catch (e) {
      return s;
    }
  }

  /** Ключи для записей без своих id: стабильные между запусками, чтобы работал список уже проверенных. */
  function idMaker(prefix) {
    const seen = new Map();
    return (ts, text) => {
      const base = `${prefix}-${String(ts || 0).replace(/\W+/g, "")}`; // без пробелов: ids.txt делится по пробелам
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      return n ? `${base}-${n}` : base;
    };
  }

  const jsonPath = (path) => (/\.json$/i.test(path) && !/(^|\/)messages\//i.test(path) ? path : null);

  // ---------------------------------------------------------------- Bluesky (открытый API, без входа)

  async function fetchBluesky(handle, onProgress) {
    const base = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
    const tweets = [];
    const seen = new Set();
    let username = handle;
    let cursor = "";
    for (;;) {
      const url = `${base}?actor=${encodeURIComponent(handle)}&limit=100&filter=posts_with_replies` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      let resp;
      try {
        resp = await fetch(url);
      } catch (e) {
        throw new Error(t("bsky.offline"));
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error === "InvalidRequest" || resp.status === 400
          ? t("bsky.notFound", { handle })
          : `Bluesky: ${data.message || resp.status}`);
      }
      for (const item of data.feed || []) {
        const p = item.post;
        const isRepost = !!(item.reason && String(item.reason.$type).includes("reasonRepost"));
        const key = (isRepost ? "repost:" : "") + p.uri;
        if (seen.has(key)) continue; // закреплённый пост приходит дважды
        seen.add(key);
        const rkey = p.uri.split("/").pop();
        if (!isRepost) username = p.author.handle;
        const record = p.record || {};
        tweets.push({
          id: isRepost ? `repost-${rkey}` : rkey,
          text: record.text || "",
          createdAt: fromIso(isRepost ? item.reason.indexedAt : record.createdAt),
          username: p.author.handle,
          kind: isRepost ? "repost" : record.reply ? "reply" : "post",
          url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
        });
      }
      if (onProgress) onProgress(tweets.length);
      cursor = data.cursor;
      if (!cursor || !(data.feed || []).length) break;
    }
    // Чужие репосты не отбрасываются фильтром «только аккаунт» — у них свой автор.
    for (const t of tweets) if (t.kind === "repost") t.username = "";
    return { username, tweets };
  }

  // ---------------------------------------------------------------- Facebook

  async function loadFacebook(files) {
    let username = "";
    const tweets = [];
    const makeId = idMaker("fb");
    const dedupe = new Set();
    const add = (kind, ts, text) => {
      text = fixMeta(text);
      if (!text || dedupe.has(`${kind}|${ts}|${text}`)) return;
      dedupe.add(`${kind}|${ts}|${text}`);
      tweets.push({ id: makeId(ts, text), text, createdAt: fromUnix(ts), username: "", kind, url: null });
    };

    for (const key of [...files.keys()].sort()) {
      const data = await readJson(files, key);
      if (!data) continue;
      if (/profile_information\.json$/i.test(key)) {
        const p = data.profile_v2 || data.profile || {};
        username = fixMeta((p.name && p.name.full_name) || "") || username;
        continue;
      }
      // Посты: { timestamp, data: [{ post }] }; комментарии: { timestamp, data: [{ comment: { comment, timestamp } }] }.
      walk(data, (obj) => {
        if (!Array.isArray(obj.data)) return;
        for (const d of obj.data) {
          if (!d || typeof d !== "object") continue;
          if (typeof d.post === "string") add("post", obj.timestamp, d.post);
          if (d.comment && typeof d.comment.comment === "string") add("comment", d.comment.timestamp || obj.timestamp, d.comment.comment);
        }
      });
    }
    return { username, tweets };
  }

  // ---------------------------------------------------------------- Instagram

  async function loadInstagram(files) {
    let username = "";
    const tweets = [];
    const makeId = idMaker("ig");
    const dedupe = new Set();
    const add = (kind, ts, text) => {
      text = fixMeta(text);
      if (!text || dedupe.has(`${kind}|${ts}|${text}`)) return;
      dedupe.add(`${kind}|${ts}|${text}`);
      tweets.push({ id: makeId(ts, text), text, createdAt: fromUnix(ts), username: "", kind, url: null });
    };

    for (const key of [...files.keys()].sort()) {
      const data = await readJson(files, key);
      if (!data) continue;
      const isComments = /comments/i.test(key);
      const isPosts = /(posts|reels|igtv|stories|archived)[^/]*\.json$/i.test(key);
      walk(data, (obj) => {
        const map = obj.string_map_data;
        if (map && map.Username && map.Username.value && !username) username = fixMeta(map.Username.value);
        // Новый формат комментариев: { string_map_data: { Comment: { value }, Time: { timestamp } } }.
        if (map && map.Comment && map.Comment.value) add("comment", map.Time && map.Time.timestamp, map.Comment.value);
        // Старый формат: { string_list_data: [{ value, timestamp }] } в файлах комментариев.
        if (isComments && Array.isArray(obj.string_list_data)) {
          for (const s of obj.string_list_data) if (s && s.value) add("comment", s.timestamp, s.value);
        }
        // Посты: { media: [{ uri, creation_timestamp, title }], title, creation_timestamp } — подпись в title.
        if (isPosts && Array.isArray(obj.media)) {
          const text = obj.title || obj.media.map((m) => m && m.title).find(Boolean);
          const ts = obj.creation_timestamp || (obj.media[0] && obj.media[0].creation_timestamp);
          if (text) add("post", ts, text);
        }
      });
    }
    return { username, tweets };
  }

  // ---------------------------------------------------------------- ВКонтакте (архив в HTML, обычно windows-1251)

  const RU_MONTHS = { янв: 0, фев: 1, мар: 2, апр: 3, мая: 4, май: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11 };
  const RU_DATE = /(\d{1,2})\s+(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\.?\s+(\d{4})(?:\s+(?:в\s+)?(\d{1,2}):(\d{2}))?/i;
  const VK_LINK = /vk\.com\/(wall-?\d+_\d+)(?:\?reply=(\d+))?/;

  function parseRuDate(text) {
    const m = RU_DATE.exec(text);
    if (!m) return null;
    return new Date(Date.UTC(+m[3], RU_MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0)));
  }

  function decodeHtml(bytes) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    const m = /charset=["']?([\w-]+)/i.exec(head);
    try {
      return SlurSearchSM.decode(bytes, m ? m[1] : "windows-1251");
    } catch (e) {
      return SlurSearchSM.decode(bytes);
    }
  }

  async function loadVk(files) {
    if (typeof DOMParser === "undefined") throw new Error(t("vk.browserOnly"));
    const tweets = [];
    const makeId = idMaker("vk");
    for (const key of [...files.keys()].sort()) {
      const kind = /^comments\//.test(key) ? "comment" : "post";
      const doc = new DOMParser().parseFromString(decodeHtml(await files.get(key)()), "text/html");
      // Каждая запись — блок .item; если разметка другая, берём самые вложенные блоки со ссылкой на запись.
      let items = [...doc.querySelectorAll(".item")];
      if (!items.length) {
        items = [...doc.querySelectorAll("div")].filter((d) => d.querySelector('a[href*="vk.com/wall"]') &&
          ![...d.querySelectorAll("div")].some((c) => c.querySelector('a[href*="vk.com/wall"]')));
      }
      for (const item of items) {
        const link = [...item.querySelectorAll("a[href]")].map((a) => VK_LINK.exec(a.getAttribute("href"))).find(Boolean);
        const raw = item.textContent || "";
        const createdAt = parseRuDate(raw);
        const text = raw
          .replace(RU_DATE, "")
          .replace(/https?:\/\/\S+/g, "")
          .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
        if (!text) continue;
        const id = link ? (link[2] ? `${link[1]}_r${link[2]}` : link[1]) : makeId(createdAt && createdAt.getTime() / 1000, text);
        tweets.push({
          id, text, createdAt, username: "", kind,
          url: link ? `https://vk.com/${link[1]}${link[2] ? `?reply=${link[2]}` : ""}` : null,
        });
      }
    }
    return { username: "", tweets };
  }

  // ---------------------------------------------------------------- Snapchat (только свои сообщения в чатах)

  const snapDate = (s) => (s ? SlurSearchSM.parseTwitterDate(String(s).replace(/ UTC$/, "")) : null);

  async function loadSnapchat(files) {
    let username = "";
    const account = files.has("account.json") ? await readJson(files, "account.json") : null;
    if (account && account["Basic Information"]) username = account["Basic Information"].Username || "";

    const chat = files.has("chat_history.json") ? await readJson(files, "chat_history.json") : null;
    if (!chat) throw new Error(t("snap.noChat"));

    const tweets = [];
    const makeId = idMaker("snap");
    const add = (created, text) => {
      if (!text || typeof text !== "string") return;
      tweets.push({ id: makeId(created, text), text, createdAt: snapDate(created), username: "", kind: "message", url: null });
    };
    if (Array.isArray(chat["Sent Saved Chat History"])) {
      // Старый формат: отдельный список отправленных.
      for (const m of chat["Sent Saved Chat History"]) add(m.Created, m.Text || m.Content);
    } else {
      // Новый формат: { собеседник: [{ From, Content, Created, IsSender }] }.
      for (const list of Object.values(chat)) {
        if (!Array.isArray(list)) continue;
        for (const m of list) {
          const mine = m.IsSender === true || (username && m.From === username);
          if (mine) add(m.Created, m.Content || m.Text);
        }
      }
    }
    return { username, tweets };
  }

  // ---------------------------------------------------------------- Telegram (экспорт Telegram Desktop в JSON или HTML)

  // Чаты, у которых есть ссылки вида t.me/c/<id чата>/<id сообщения> (открываются у участников чата).
  const TG_LINKED = new Set(["private_supergroup", "public_supergroup", "private_channel", "public_channel"]);
  // Страницы экспорта в формате HTML (формат по умолчанию): export_results.html — данные владельца,
  // chats/chat_001/messages.html, messages2.html… — чаты; в экспорте одного чата — просто messages.html, messages2.html…
  const TG_INDEX = "export_results.html";
  const TG_PAGE = /(?:^|\/)((?:chats\/chat_\d+\/)?messages\d*\.html)$/;

  function telegramPath(path) {
    if (/(?:^|\/)result\.json$/i.test(path)) return "result.json";
    if (path === TG_INDEX || path.endsWith(`/${TG_INDEX}`)) return TG_INDEX;
    const m = TG_PAGE.exec(path);
    return m ? m[1] : null;
  }

  /** Текст сообщения: строка или список кусков (строки и { type: "bold", text }). */
  const tgText = (text) => (typeof text === "string" ? text : (text || []).map((p) => (typeof p === "string" ? p : p.text || "")).join(""));

  /**
   * Свои сообщения из экспорта (полного или одного чата, включая группы, из которых вы вышли).
   * В экспорте одного чата владелец неизвестен — тогда берутся все сообщения, а имя автора кладётся в username,
   * чтобы свои можно было отобрать полем «только аккаунт».
   */
  async function loadTelegram(files) {
    if (!files.has("result.json") && [...files.keys()].some((k) => TG_PAGE.test(k))) return loadTelegramHtml(files);
    const data = files.has("result.json") ? await readJson(files, "result.json") : null;
    if (!data || (!data.chats && !data.messages)) {
      throw new Error(t("tg.noResult"));
    }
    const info = data.personal_information || {};
    const me = info.user_id ? `user${info.user_id}` : null;
    const username = (info.username || "").replace(/^@+/, "") || [info.first_name, info.last_name].filter(Boolean).join(" ");
    const chats = data.messages ? [data] : [...((data.chats || {}).list || []), ...((data.left_chats || {}).list || [])];
    const tweets = [];
    for (const chat of chats) {
      const chatId = String(chat.id ?? "").replace(/^-100/, "").replace(/^-+/, "");
      for (const m of chat.messages || []) {
        const text = tgText(m.text);
        if (m.type !== "message" || !text || (me && m.from_id !== me)) continue;
        tweets.push({
          id: `${chatId}_${m.id}`,
          text,
          createdAt: SlurSearchSM.parseTwitterDate((m.date || "").replace("T", " ")),
          username: me ? "" : m.from || "",
          kind: m.forwarded_from ? "repost" : m.reply_to_message_id ? "reply" : "message",
          url: TG_LINKED.has(chat.type) ? `https://t.me/c/${chatId}/${m.id}` : null,
          chat: chat.name || "",
        });
      }
    }
    const warnings = me ? [] : [t("tg.noOwner")];
    return { username, tweets, warnings };
  }

  // Разбор HTML-экспорта: страницы формирует Telegram Desktop по одному шаблону, поэтому хватает регулярных выражений.
  // Та же логика — в load_telegram_html (slur_search_sm.py).
  const TG_MESSAGE = /<div class="message ([^"]*)" id="message(-?\d+)">/g;
  const TG_DATE = /class="pull_right date details" title="(\d\d)\.(\d\d)\.(\d{4}) (\d\d:\d\d:\d\d)/;

  /** Текст из разметки: <br> — перевод строки, остальные теги убираются. */
  const tgHtmlText = (fragment) =>
    SlurSearchSM.unescapeHtml(fragment.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();

  /** Имя и фамилия владельца (так подписаны его сообщения) и @ник — из блока personal_info в export_results.html. */
  function tgHtmlOwner(index) {
    const m = /class="personal_info([\s\S]*?)class="sections/.exec(index);
    if (!m) return ["", ""];
    const block = m[1];
    const names = /class="rows names"([\s\S]*?)class="rows info"/.exec(block);
    const values = (part) => [...part.matchAll(/<div class="value bold">([\s\S]*?)<\/div>/g)].map((v) => tgHtmlText(v[1]));
    const fullName = (names ? values(names[1]) : []).filter(Boolean).join(" ");
    const nick = values(block).find((v) => v.startsWith("@")) || "";
    return [fullName, nick.replace(/^@+/, "")];
  }

  /**
   * Сообщения из HTML-экспорта. Своё сообщение — то, у которого автор подписан именем владельца; у идущих подряд
   * сообщений одного автора (класс joined) подписи нет — автор берётся из предыдущего. Ссылок нет: в HTML нет id чатов.
   */
  async function loadTelegramHtml(files) {
    const index = files.has(TG_INDEX) ? SlurSearchSM.decode(await files.get(TG_INDEX)()) : "";
    const [owner, nick] = tgHtmlOwner(index);
    const chats = new Map(); // папка чата → [[номер страницы, ключ]]
    for (const key of files.keys()) {
      if (!TG_PAGE.test(key)) continue;
      const cut = key.lastIndexOf("/");
      const folder = cut < 0 ? "" : key.slice(0, cut);
      if (!chats.has(folder)) chats.set(folder, []);
      chats.get(folder).push([Number(key.slice(cut + 1).replace(/\D/g, "")) || 1, key]);
    }
    const tweets = [];
    for (const folder of [...chats.keys()].sort()) {
      const keys = chats.get(folder).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
      const prefix = folder.slice(folder.lastIndexOf("/") + 1) || "chat";
      let chat = "";
      let sender = "";
      for (const [n, key] of keys.entries()) {
        const page = SlurSearchSM.decode(await files.get(key)());
        if (!n) {
          const header = /<div class="page_header">[\s\S]*?<div class="text bold">([\s\S]*?)<\/div>/.exec(page);
          chat = header ? tgHtmlText(header[1]) : "";
        }
        const starts = [...page.matchAll(TG_MESSAGE)];
        starts.forEach((m, i) => {
          if (m[1].split(" ").includes("service")) return;
          const block = page.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : page.length);
          const fwd = block.indexOf('class="forwarded body"');
          const head = fwd < 0 ? block : block.slice(0, fwd);
          const author = /<div class="from_name">([\s\S]*?)<\/div>/.exec(head);
          if (author) sender = tgHtmlText(author[1].replace(/<span class="details">[\s\S]*?<\/span>/g, ""));
          const body = /<div class="text">([\s\S]*?)<\/div>/.exec(fwd < 0 ? block : block.slice(fwd));
          const text = body ? tgHtmlText(body[1]) : "";
          if (!text || (owner && sender !== owner)) return;
          const d = TG_DATE.exec(block);
          tweets.push({
            id: `${prefix}_${m[2]}`,
            text,
            createdAt: d ? SlurSearchSM.parseTwitterDate(`${d[3]}-${d[2]}-${d[1]} ${d[4]}`) : null,
            username: owner ? "" : sender,
            kind: fwd >= 0 ? "repost" : head.includes('class="reply_to details"') ? "reply" : "message",
            url: null,
            chat,
          });
        });
      }
    }
    return { username: nick || owner, tweets, warnings: owner ? [] : [t("tg.noOwner")] };
  }

  // ---------------------------------------------------------------- список

  /**
   * accept(path) — какие файлы архива нужны (ключ или null); load(files, opts) — разбор.
   * search — есть ли ссылки на поиск; api — загрузка по нику; likes — есть ли лайкнутые записи в архиве.
   * Подсказка, откуда взять архив, — в i18n.js под ключом help.<соцсеть>.
   */
  const NETWORKS = {
    x: {
      label: "X (Twitter)",
      search: true,
      likes: true,
      accept: undefined, // стандартный разбор архива X
      load: (files, opts) => SlurSearchSM.loadArchive(files, opts.includeLikes),
    },
    bluesky: {
      label: "Bluesky",
      api: true,
    },
    facebook: {
      label: "Facebook",
      accept: jsonPath,
      load: loadFacebook,
    },
    instagram: {
      label: "Instagram",
      accept: jsonPath,
      load: loadInstagram,
    },
    vk: {
      get label() { return t("net.vk"); },
      accept: (path) => {
        const m = /(?:^|\/)((?:wall|comments)\/[^/]+\.html?)$/i.exec(path);
        return m ? m[1].toLowerCase() : null;
      },
      load: loadVk,
    },
    snapchat: {
      label: "Snapchat",
      accept: (path) => {
        const m = /(?:^|\/)(chat_history|account)\.json$/i.exec(path);
        return m ? `${m[1].toLowerCase()}.json` : null;
      },
      load: loadSnapchat,
    },
    telegram: {
      label: "Telegram",
      accept: telegramPath,
      load: loadTelegram,
    },
  };

  const Networks = { NETWORKS, fetchBluesky, fixMeta, parseRuDate, loadTelegram };
  if (typeof module !== "undefined" && module.exports) module.exports = Networks;
  else root.Networks = Networks;
})(typeof self !== "undefined" ? self : this);
