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
          throw new Error(`Не удалось загрузить ${DEFAULT_RULES.join(", ")}. Если страница открыта как файл (file://), запустите её через сервер ` +
            "(python -m http.server) или выберите словарь вручную в поле «Свой словарь».");
        }
      }
    }
    if (defaultRules) datas.push(...defaultRules);
    for (const f of custom) {
      try {
        datas.push(JSON.parse(await f.text()));
      } catch (e) {
        throw new Error(`Словарь ${f.name}: ошибка JSON — ${e.message}`);
      }
    }
    if (!datas.length) throw new Error("Выберите хотя бы один словарь.");
    try {
      return new SlurSearchSM.Rules(datas);
    } catch (e) {
      throw new Error(`Ошибка в регулярном выражении словаря: ${e.message}`);
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
      if (kind === "heading") {
        const level = Object.keys(SlurSearchSM.LEVEL_RU).find((l) => rest[0].startsWith(`Риск: ${SlurSearchSM.LEVEL_RU[l]} `));
        el("h2", level || "", rest[0]);
      } else if (kind === "note") el("p", "note", rest[0]);
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
    const pdf = Object.assign(document.createElement("button"), { type: "button", textContent: "PDF (печать → Сохранить как PDF)" });
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
    $("archive-help").innerHTML = net().help;
    $("archive-title").textContent = net().api ? "Или: CSV/JSON с постами" : "Полностью: архив аккаунта";
    $("drop-label").innerHTML = net().api ? "Перетащите сюда CSV/JSON" : "Перетащите сюда <b>.zip</b> архива, распакованную папку или CSV/JSON";
    setSource(null);
    try {
      localStorage.setItem("slursearchsm-network", network);
    } catch (e) {
      // без сохранения выбора — не страшно
    }
  }

  $("network").addEventListener("change", (e) => setNetwork(e.target.value));

  // ---------------------------------------------------------------- ссылки на поиск (X)

  $("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("search-user").value.trim().replace(/^@+/, "");
    if (!username) return;
    try {
      const rules = await loadRules();
      const { doc, total } = SlurSearchSM.searchDoc(rules, username, $("search-replies").checked);
      if (!total) throw new Error("В выбранных словарях нет search_terms — ссылки на поиск делать не из чего.");
      showOutput(doc, [["search.txt", doc.toTxt(), "text/plain;charset=utf-8"]], "search");
      status(`Ссылок на поиск: ${total}. Откройте их, войдя в X.`);
    } catch (err) {
      status(err.message, true);
    }
  });

  // ---------------------------------------------------------------- архив: источник

  function setSource(s) {
    source = s;
    $("check-btn").disabled = !s;
    $("drop").classList.toggle("ready", !!s);
    if (s) $("drop-label").textContent = `Выбрано: ${s.name}`;
    status("");
  }

  function sourceFromFile(file) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "zip" && !net().api) return { kind: "zip", name: file.name, file };
    if (ext === "csv") return { kind: "table", name: file.name, file };
    // Отдельный файл из архива (например chat_history.json Snapchat) — если он подходит этой соцсети.
    if (net().accept && net().accept(file.name)) return { kind: "single", name: file.name, file };
    if (ext === "json") return { kind: "table", name: file.name, file };
    throw new Error(`Не подходит ${file.name}: нужен архив ${net().label} (.zip или папка) или CSV/JSON.`);
  }

  function sourceFromDir(files) {
    if (!files.length) throw new Error("В папке нет файлов.");
    const top = (files[0].relativePath || files[0].webkitRelativePath || "").split("/")[0];
    return { kind: "dir", name: `папка ${top || "архива"}`, files };
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
        status("Читаю папку…");
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
      if (typeof JSZip === "undefined") throw new Error("Не загрузилась библиотека JSZip (нужен интернет). Распакуйте архив и выберите папку.");
      files = SlurSearchSM.archiveFromZip(await JSZip.loadAsync(source.file), net().accept);
    } else {
      files = SlurSearchSM.archiveFromFiles(source.kind === "single" ? [source.file] : source.files, net().accept);
    }
    const data = await net().load(files, { includeLikes: $("opt-likes").checked });
    if (!data.tweets.length) {
      throw new Error(`В ${source.name} не найдено записей ${net().label}. Проверьте, что выбрана нужная соцсеть и архив в правильном формате.`);
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
      status(`Проверяю ${tweets.length} записей…`);
      await tick();
      if (network !== "x") opts.title = `Отчёт: ${net().label}${username ? `, ${username}` : ""}`;
      const r = SlurSearchSM.analyze(rules, username, tweets, opts);

      showOutput(r.doc, [
        ["report.txt", r.doc.toTxt(), "text/plain;charset=utf-8"],
        ["report.csv", r.csv, "text/csv;charset=utf-8"],
        ["ids.txt", r.ids, "text/plain;charset=utf-8"],
      ], "report");
      const who = r.username ? (network === "x" || network === "bluesky" ? `@${r.username}` : r.username) : "—";
      status([...warnings, ...r.warnings, `${net().label}, аккаунт: ${who}; проверено: ${r.total}; найдено: ${r.findings.length} ` +
        `(высокий ${r.byLevel.high}, средний ${r.byLevel.medium}, низкий ${r.byLevel.low})`].join(" "));
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
      status(`Читаю ${source.name}…`);
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
      status(`Загружаю посты ${handle}…`);
      return Networks.fetchBluesky(handle, (n) => status(`Загружаю посты ${handle}… ${n}`));
    }, $("bsky-btn"));
  });

  let saved = null;
  try {
    saved = localStorage.getItem("slursearchsm-network");
  } catch (e) {
    // хранилище недоступно — начинаем с X
  }
  setNetwork(saved || "x");
})();
