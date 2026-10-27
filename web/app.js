/* Интерфейс страницы: выбор соцсети и источника, словари, запуск проверки, показ и скачивание отчётов.
 * Логика проверки — в slur_search_sm.js, разбор архивов других соцсетей — в networks.js. */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DEFAULT_RULES = ["rules/default.json", "rules/ja.json"];
  let defaultRules = null;
  let source = null; // { kind: "zip" | "dir" | "single" | "table", name, file?, files? }
  let network = "x";
  const net = () => Networks.NETWORKS[network];
  const t = (key, params) => I18N.t(key, params);

  // ---------------------------------------------------------------- статус

  function status(text, isError = false) {
    const el = $("status");
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.toggle("error", isError);
  }

  const tick = () => new Promise((r) => setTimeout(r, 0)); // дать браузеру перерисовать статус

  // ---------------------------------------------------------------- словари

  // Основные словари подключаются всегда; если они не загрузились (страница открыта как file://),
  // можно работать только со своими словарями.
  async function loadRules() {
    const datas = [];
    const custom = $("rule-custom").files;
    if (!defaultRules) {
      try {
        defaultRules = await Promise.all(DEFAULT_RULES.map(async (url) => {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(String(resp.status));
          return resp.json();
        }));
      } catch (e) {
        if (!custom.length) {
          throw new Error(t("rules.loadFail", { files: DEFAULT_RULES.join(", ") }));
        }
      }
    }
    if (defaultRules) datas.push(...defaultRules);
    for (const f of custom) {
      try {
        datas.push(JSON.parse(await f.text()));
      } catch (e) {
        throw new Error(t("rules.jsonError", { name: f.name, message: e.message }));
      }
    }
    if (!datas.length) throw new Error(t("rules.none"));
    try {
      return new SlurSearchSM.Rules(datas);
    } catch (e) {
      throw new Error(t("rules.regexError", { message: e.message }));
    }
  }

  // ---------------------------------------------------------------- вывод отчёта

  function renderDoc(doc) {
    const root = $("result");
    root.replaceChildren();
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      root.append(e);
      return e;
    };
    el("h1", "", doc.title);
    for (const [kind, ...rest] of doc.items) {
      if (kind === "heading") el("h2", rest[1] || "", rest[0]);
      else if (kind === "note") el("p", "note", rest[0]);
      else if (kind === "line") (rest[1] ? el("p", "line").appendChild(document.createElement("b")) : el("p", "line")).textContent = rest[0];
      else if (kind === "marked") {
        const p = el("p", "marked");
        for (const [text, hit] of rest[0]) p.append(hit ? Object.assign(document.createElement("mark"), { textContent: text }) : text);
      } else if (kind === "link") {
        const a = el("a", "link", rest[0]);
        a.href = rest[1];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      } else if (kind === "sep") el("hr");
    }
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** files: [[имя, текст, mime]]; pdfName — имя, которое браузер предложит при «Сохранить как PDF». */
  function showOutput(doc, files, pdfName) {
    renderDoc(doc);
    const bar = $("downloads");
    bar.replaceChildren();
    const pdf = Object.assign(document.createElement("button"), { type: "button", textContent: t("out.pdf") });
    pdf.onclick = () => {
      const title = document.title;
      document.title = pdfName;
      window.print();
      document.title = title;
    };
    bar.append(pdf);
    for (const [name, text, type] of files) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: name });
      b.onclick = () => download(name, text, type);
      bar.append(b);
    }
    $("output").hidden = false;
    $("output").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- выбор соцсети

  function setNetwork(value) {
    network = Networks.NETWORKS[value] ? value : "x";
    $("network").value = network;
    for (const el of document.querySelectorAll("[data-net]")) el.hidden = !el.dataset.net.split(" ").includes(network);
    setSource(null);
    showNetworkTexts();
    try {
      localStorage.setItem("slursearchsm-network", network);
    } catch (e) {
      // без сохранения выбора — не страшно
    }
  }

  // Тексты, которые зависят от соцсети и языка.
  function showNetworkTexts() {
    $("archive-help").innerHTML = t(`help.${network}`);
    $("archive-title").textContent = t(net().api ? "archive.titleApi" : "archive.title");
    if (source) $("drop-label").textContent = t("source.selected", { name: source.name });
    else $("drop-label").innerHTML = t(net().api ? "drop.api" : "drop.archive");
    showGuideTexts();
  }

  $("network").addEventListener("change", (e) => setNetwork(e.target.value));

  // ---------------------------------------------------------------- инструкция

  // Новичку один раз предлагаем инструкцию всплывашкой в углу; потом она открывается кнопкой «?».
  const GUIDE_KEY = "slursearchsm-guide";

  function showGuideTexts() {
    const get = network === "x" || network === "bluesky" ? `guide.get.${network}` : "guide.get.archive";
    $("guide-get").innerHTML = t(get) + (network === "bluesky" ? "" : t(`help.${network}`));
    $("guide-file").hidden = network === "bluesky";
    $("guide-fab").title = t("guide.open");
    $("guide-fab").setAttribute("aria-label", t("guide.open"));
  }

  function hideGuideToast() {
    $("guide-toast").hidden = true;
    $("guide-fab").hidden = false;
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch (e) {
      // предложим ещё раз в следующий заход — не страшно
    }
  }

  function openGuide() {
    hideGuideToast();
    $("guide").showModal();
  }

  $("guide-yes").addEventListener("click", openGuide);
  $("guide-fab").addEventListener("click", openGuide);
  $("guide-no").addEventListener("click", hideGuideToast);
  $("guide-toast-close").addEventListener("click", hideGuideToast);
  for (const id of ["guide-close", "guide-ok"]) $(id).addEventListener("click", () => $("guide").close());
  // Клик по затемнению вокруг окна тоже закрывает его.
  $("guide").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  // ---------------------------------------------------------------- язык

  function applyLang() {
    SlurSearchSM.setLang(I18N.lang);
    I18N.apply(document);
    $("lang").value = I18N.lang;
  }

  // Уже показанный отчёт остаётся на прежнем языке — новый будет на выбранном.
  $("lang").addEventListener("change", (e) => {
    I18N.setLang(e.target.value, true);
    applyLang();
    showNetworkTexts();
  });

  // ---------------------------------------------------------------- ссылки на поиск (X)

  $("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("search-user").value.trim().replace(/^@+/, "");
    if (!username) return;
    try {
      const rules = await loadRules();
      const { doc, total } = SlurSearchSM.searchDoc(rules, username, $("search-replies").checked);
      if (!total) throw new Error(t("search.noTerms"));
      showOutput(doc, [["search.txt", doc.toTxt(), "text/plain;charset=utf-8"]], "search");
      status(t("search.done", { n: total }));
    } catch (err) {
      status(err.message, true);
    }
  });

  // ---------------------------------------------------------------- архив: источник

  function setSource(s) {
    source = s;
    $("check-btn").disabled = !s;
    $("drop").classList.toggle("ready", !!s);
    if (s) $("drop-label").textContent = t("source.selected", { name: s.name });
    status("");
  }

  function sourceFromFile(file) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "zip" && !net().api) return { kind: "zip", name: file.name, file };
    if (ext === "csv") return { kind: "table", name: file.name, file };
    // Отдельный файл из архива (например chat_history.json Snapchat) — если он подходит этой соцсети.
    if (net().accept && net().accept(file.name)) return { kind: "single", name: file.name, file };
    if (ext === "json") return { kind: "table", name: file.name, file };
    throw new Error(t("source.bad", { name: file.name, net: net().label }));
  }

  function sourceFromDir(files) {
    if (!files.length) throw new Error(t("source.emptyDir"));
    const top = (files[0].relativePath || files[0].webkitRelativePath || "").split("/")[0];
    return { kind: "dir", name: top ? t("source.dir", { name: top }) : t("source.dirUnknown"), files };
  }

  $("pick-file").addEventListener("change", (e) => {
    try {
      if (e.target.files[0]) setSource(sourceFromFile(e.target.files[0]));
    } catch (err) {
      status(err.message, true);
    }
  });

  $("pick-dir").addEventListener("change", (e) => {
    try {
      setSource(sourceFromDir([...e.target.files]));
    } catch (err) {
      status(err.message, true);
    }
  });

  // Папка, брошенная мышью: обходим её через FileSystemEntry, в папки с фото и видео не заходим.
  const MEDIA_DIR = /^(.*_media|media|photos?|videos?|audio|gifs|stickers|files|memories)$/i;

  async function collectEntry(entry, prefix, out) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      file.relativePath = prefix + file.name;
      out.push(file);
      return;
    }
    if (prefix && MEDIA_DIR.test(entry.name)) return;
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await collectEntry(child, prefix + entry.name + "/", out);
    }
  }

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    try {
      const entry = e.dataTransfer.items && e.dataTransfer.items[0] && e.dataTransfer.items[0].webkitGetAsEntry?.();
      if (entry && entry.isDirectory) {
        status(t("status.readingDir"));
        const files = [];
        await collectEntry(entry, "", files);
        setSource(sourceFromDir(files));
      } else if (e.dataTransfer.files[0]) {
        setSource(sourceFromFile(e.dataTransfer.files[0]));
      }
    } catch (err) {
      status(err.message, true);
    }
  });


  // ---------------------------------------------------------------- проверка

  async function loadSource() {
    if (source.kind === "table") {
      const tweets = SlurSearchSM.loadTable(await source.file.text(), source.name.toLowerCase().endsWith(".csv"));
      return { username: "", tweets };
    }
    let files;
    if (source.kind === "zip") {
      if (typeof JSZip === "undefined") throw new Error(t("source.noJszip"));
      files = SlurSearchSM.archiveFromZip(await JSZip.loadAsync(source.file), net().accept);
    } else {
      files = SlurSearchSM.archiveFromFiles(source.kind === "single" ? [source.file] : source.files, net().accept);
    }
    const data = await net().load(files, { includeLikes: $("opt-likes").checked });
    if (!data.tweets.length) {
      throw new Error(t("source.noRecords", { name: source.name, net: net().label }));
    }
    return data;
  }

  /** load — функция, возвращающая { username, tweets }; кнопка блокируется на время проверки. */
  async function runCheck(load, btn) {
    btn.disabled = true;
    try {
      const rules = await loadRules();
      const ignoreFile = $("opt-ignore").files[0];
      const opts = {
        account: $("opt-account").value.trim(),
        onlyReplies: $("opt-replies").checked,
        noRetweets: $("opt-noretweets").checked,
        since: $("opt-since").value || null,
        until: $("opt-until").value || null,
        minScore: Number.parseInt($("opt-min").value, 10) || 0,
        ignore: new Set(ignoreFile ? (await ignoreFile.text()).split(/\s+/).filter(Boolean) : []),
      };

      const { username, tweets, warnings = [] } = await load();
      status(t("status.checking", { n: tweets.length }));
      await tick();
      if (network !== "x") opts.title = SlurSearchSM.tr(username ? "report.netUser" : "report.net", { net: net().label, user: username });
      const r = SlurSearchSM.analyze(rules, username, tweets, opts);

      showOutput(r.doc, [
        ["report.txt", r.doc.toTxt(), "text/plain;charset=utf-8"],
        ["report.csv", r.csv, "text/csv;charset=utf-8"],
        ["ids.txt", r.ids, "text/plain;charset=utf-8"],
      ], "report");
      const who = r.username ? (network === "x" || network === "bluesky" ? `@${r.username}` : r.username) : "—";
      status([...warnings, ...r.warnings,
        t("status.summary", { net: net().label, who, total: r.total, found: r.findings.length, ...r.byLevel })].join(" "));
    } catch (err) {
      status(err.message, true);
    } finally {
      btn.disabled = false;
      $("check-btn").disabled = !source;
    }
  }

  $("check-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!source) return;
    runCheck(async () => {
      status(t("status.reading", { name: source.name }));
      await tick();
      return loadSource();
    }, $("check-btn"));
  });

  $("bsky-form").addEventListener("submit", (e) => {
    e.preventDefault();
    // Принимаем и ник, и ссылку на профиль.
    const handle = $("bsky-user").value.trim()
      .replace(/^https?:\/\/bsky\.app\/profile\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/^@+/, "");
    if (!handle) return;
    runCheck(async () => {
      status(t("status.bsky", { handle }));
      return Networks.fetchBluesky(handle, (n) => status(`${t("status.bsky", { handle })} ${n}`));
    }, $("bsky-btn"));
  });

  let saved = null;
  try {
    saved = localStorage.getItem("slursearchsm-network");
  } catch (e) {
    // хранилище недоступно — начинаем с X
  }
  applyLang();
  setNetwork(saved || "x");

  let guideSeen = false;
  try {
    guideSeen = !!localStorage.getItem(GUIDE_KEY);
  } catch (e) {
    // хранилище недоступно — предлагаем инструкцию
  }
  $("guide-toast").hidden = guideSeen;
  $("guide-fab").hidden = !guideSeen;
})();
