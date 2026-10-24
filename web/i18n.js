/* Тексты интерфейса на русском, английском и японском. Язык — по языку браузера (русский и японский, остальным английский),
 * можно сменить переключателем в шапке или параметром ?lang=. Тексты отчётов — в slur_search_sm.js, как и в slur_search_sm.py. */

(function (root) {
  "use strict";

  const STRINGS = {
    ru: {
      "meta.description": "Проверка своего аккаунта в X, Bluesky, Facebook, Instagram, ВКонтакте, Snapchat и Telegram на записи, за которые банят по массовым жалобам. Всё работает в браузере, архив никуда не отправляется.",
      "header.lead": "Проверяет <b>свой</b> аккаунт в соцсети на записи, за которые модерация может забанить по массовым жалобам: " +
        "оскорбительные названия групп, пожелания смерти и призывы к самоубийству, призывы к насилию, расчеловечивание, пропаганда самоубийства и самоповреждения.",
      "header.note": "Всё считается в вашем браузере — архив и записи никуда не отправляются. Это поиск по словарю, " +
        "а не оценка модерации: каждую найденную запись смотрите в контексте.",
      "lang.label": "Язык",
      "network.label": "Соцсеть",
      "rules.title": "Словари",
      "rules.builtin": "Встроенные словари — русский/английский и японский (оскорбления групп, насилие, расчеловечивание) — используются всегда.",
      "rules.custom": "Дополнительный словарь (.json, можно несколько):",
      "search.title": "Быстро: ссылки на поиск X",
      "search.help": "Без архива. Откройте ссылки в браузере, где вы вошли в X. Пустой результат — хорошо. " +
        "Поиск X находит только точные словоформы и не видит замаскированные слова.",
      "search.user": "ваш ник",
      "search.replies": "только ответы",
      "search.button": "Сделать ссылки",
      "bsky.title": "Быстро и полностью: посты по нику",
      "bsky.help": "Без архива и без входа: все ваши посты, ответы и репосты загружаются через открытый API Bluesky " +
        "и проверяются здесь же. Учитываются параметры проверки ниже.",
      "bsky.button": "Загрузить и проверить",
      "archive.title": "Полностью: архив аккаунта",
      "archive.titleApi": "Или: CSV/JSON с постами",
      "archive.table": "Можно также передать CSV/JSON с колонками <code>id, text, created_at, username</code>.",
      "drop.archive": "Перетащите сюда <b>.zip</b> архива, распакованную папку или CSV/JSON",
      "drop.api": "Перетащите сюда CSV/JSON",
      "pick.file": "Выбрать файл",
      "pick.dir": "Выбрать папку",
      "opts.title": "Параметры проверки",
      "opt.replies": "только ответы и комментарии — по ним чаще всего ищут жалобщики",
      "opt.likes": "проверять и лайкнутые твиты",
      "opt.noretweets": "пропускать ретвиты и репосты",
      "opt.since": "с даты",
      "opt.until": "по дату",
      "opt.min": "мин. балл",
      "opt.account": "только аккаунт",
      "opt.accountHint": "необязательно",
      "opt.ignore": "уже проверенные id (.txt)",
      "check.button": "Проверить",
      "footer": "Что делать с найденным: удалите записи (для массового удаления пригодится <code>ids.txt</code>). " +
        "Если бан уже случился — подавайте апелляцию через форму поддержки соцсети.",

      "rules.loadFail": "Не удалось загрузить {files}. Если страница открыта как файл (file://), запустите её через сервер " +
        "(python -m http.server) или выберите словарь вручную в поле «Дополнительный словарь».",
      "rules.jsonError": "Словарь {name}: ошибка JSON — {message}",
      "rules.none": "Выберите хотя бы один словарь.",
      "rules.regexError": "Ошибка в регулярном выражении словаря: {message}",
      "out.pdf": "PDF (печать → Сохранить как PDF)",
      "search.noTerms": "В выбранных словарях нет search_terms — ссылки на поиск делать не из чего.",
      "search.done": "Ссылок на поиск: {n}. Откройте их, войдя в X.",
      "source.selected": "Выбрано: {name}",
      "source.bad": "Не подходит {name}: нужен архив {net} (.zip или папка) или CSV/JSON.",
      "source.emptyDir": "В папке нет файлов.",
      "source.dir": "папка {name}",
      "source.dirUnknown": "папка архива",
      "source.noJszip": "Не загрузилась библиотека JSZip (нужен интернет). Распакуйте архив и выберите папку.",
      "source.noRecords": "В {name} не найдено записей {net}. Проверьте, что выбрана нужная соцсеть и архив в правильном формате.",
      "status.readingDir": "Читаю папку…",
      "status.reading": "Читаю {name}…",
      "status.checking": "Проверяю {n} записей…",
      "status.bsky": "Загружаю посты {handle}…",
      "status.summary": "{net}, аккаунт: {who}; проверено: {total}; найдено: {found} (высокий {high}, средний {medium}, низкий {low})",

      "net.vk": "ВКонтакте",
      "help.x": "X → Настройки → Ваш аккаунт → Скачать архив данных. Архив готовят 1–2 дня, потом приходит ссылка на <code>.zip</code>.",
      "help.bluesky": "Архив Bluesky (<code>.car</code>) не нужен: посты загружаются по нику через открытый API Bluesky (блок выше). " +
        "Сюда можно передать только CSV/JSON.",
      "help.facebook": "Настройки → Центр аккаунтов → Ваша информация и разрешения → Скачать информацию. Формат — <b>JSON</b>, " +
        "качество медиа — низкое (архив будет меньше). Проверяются посты и комментарии. " +
        "Если <code>.zip</code> очень большой, распакуйте его и выберите папку.",
      "help.instagram": "Настройки → Центр аккаунтов → Ваша информация и разрешения → Скачать информацию. Формат — <b>JSON</b>. " +
        "Проверяются подписи к постам и комментарии. Если <code>.zip</code> очень большой, распакуйте его и выберите папку.",
      "help.vk": "Настройки → Приватность и безопасность → Управление данными → Получить архив (vk.com/data_protection). " +
        "Отметьте «Стена» и «Комментарии». Проверяются записи на стене и комментарии. " +
        "Разбор архива ВКонтакте приблизительный — сверяйте найденное со ссылками.",
      "help.snapchat": "Settings → My Data (accounts.snapchat.com) → выберите «Chat History» и формат <b>JSON</b>. " +
        "Проверяются ваши сообщения в чатах — снапы без текста Snapchat не сохраняет.",
      "help.telegram": "Telegram Desktop → Настройки → Продвинутые настройки → Экспорт данных из Telegram. Отметьте личные чаты и группы " +
        "(в том числе публичные), формат — <b>«Машиночитаемый JSON»</b>, медиа не нужны. Выберите папку экспорта или файл " +
        "<code>result.json</code>. Проверяются ваши сообщения; ссылки на сообщения есть только в супергруппах и каналах.",
      "bsky.offline": "Bluesky не отвечает — проверьте интернет.",
      "bsky.notFound": "Bluesky: аккаунт {handle} не найден. Ник пишется полностью, например name.bsky.social.",
      "vk.browserOnly": "Архив ВКонтакте читается только в браузере.",
      "snap.noChat": "Не найден json/chat_history.json — при запросе данных Snapchat выберите формат JSON.",
      "tg.noResult": "Не найден result.json — при экспорте в Telegram Desktop выберите формат «Машиночитаемый JSON».",
      "tg.noOwner": "Внимание: в экспорте одного чата нет данных о владельце — проверяются сообщения всех участников. " +
        "Чтобы проверить только свои, впишите своё имя в Telegram в поле «только аккаунт».",
    },

    en: {
      "meta.description": "Check your own X, Bluesky, Facebook, Instagram, VK, Snapchat and Telegram account for posts that get accounts banned through mass reports. Everything runs in your browser; your archive is never uploaded.",
      "header.lead": "Checks <b>your own</b> social media account for posts that moderators may ban you for after mass reports: " +
        "slurs against groups, death wishes and telling people to kill themselves, calls for violence, dehumanization, promotion of suicide and self-harm.",
      "header.note": "Everything is processed in your browser — your archive and posts are never uploaded. This is a dictionary search, " +
        "not a moderation verdict: check every match in context.",
      "lang.label": "Language",
      "network.label": "Network",
      "rules.title": "Dictionaries",
      "rules.builtin": "The built-in dictionaries — Russian/English and Japanese (slurs, violence, dehumanization) — are always used.",
      "rules.custom": "Additional dictionary (.json, several allowed):",
      "search.title": "Quick: X search links",
      "search.help": "No archive needed. Open the links in a browser where you are logged in to X. An empty result is good. " +
        "X search finds only exact word forms and does not see disguised words.",
      "search.user": "your handle",
      "search.replies": "replies only",
      "search.button": "Make links",
      "bsky.title": "Quick and complete: posts by handle",
      "bsky.help": "No archive and no login: all your posts, replies and reposts are loaded through the open Bluesky API " +
        "and checked right here. The check options below apply.",
      "bsky.button": "Load and check",
      "archive.title": "Complete: account archive",
      "archive.titleApi": "Or: CSV/JSON with posts",
      "archive.table": "You can also pass a CSV/JSON with the columns <code>id, text, created_at, username</code>.",
      "drop.archive": "Drop the archive <b>.zip</b>, the unzipped folder or a CSV/JSON here",
      "drop.api": "Drop a CSV/JSON here",
      "pick.file": "Choose file",
      "pick.dir": "Choose folder",
      "opts.title": "Check options",
      "opt.replies": "replies and comments only — mass reporters search these most often",
      "opt.likes": "also check liked posts",
      "opt.noretweets": "skip retweets and reposts",
      "opt.since": "from",
      "opt.until": "to",
      "opt.min": "min. score",
      "opt.account": "only account",
      "opt.accountHint": "optional",
      "opt.ignore": "already reviewed ids (.txt)",
      "check.button": "Check",
      "footer": "What to do with the findings: delete the posts (<code>ids.txt</code> helps with bulk deletion). " +
        "If you are already banned, appeal through the network's support form.",

      "rules.loadFail": "Could not load {files}. If the page is opened as a file (file://), serve it " +
        "(python -m http.server) or choose a dictionary in the “Additional dictionary” field.",
      "rules.jsonError": "Dictionary {name}: JSON error — {message}",
      "rules.none": "Choose at least one dictionary.",
      "rules.regexError": "Regular expression error in a dictionary: {message}",
      "out.pdf": "PDF (Print → Save as PDF)",
      "search.noTerms": "The selected dictionaries have no search_terms, so there is nothing to build search links from.",
      "search.done": "Search links: {n}. Open them while logged in to X.",
      "source.selected": "Selected: {name}",
      "source.bad": "{name} does not fit: you need a {net} archive (.zip or folder) or a CSV/JSON.",
      "source.emptyDir": "The folder is empty.",
      "source.dir": "folder {name}",
      "source.dirUnknown": "archive folder",
      "source.noJszip": "The JSZip library did not load (needs internet). Unzip the archive and choose the folder.",
      "source.noRecords": "No {net} posts found in {name}. Check that the right network is selected and the archive is in the right format.",
      "status.readingDir": "Reading the folder…",
      "status.reading": "Reading {name}…",
      "status.checking": "Checking {n} posts…",
      "status.bsky": "Loading posts of {handle}…",
      "status.summary": "{net}, account: {who}; checked: {total}; found: {found} (high {high}, medium {medium}, low {low})",

      "net.vk": "VK",
      "help.x": "X → Settings and privacy → Your account → Download an archive of your data. It takes 1–2 days to prepare; then you get a link to a <code>.zip</code>.",
      "help.bluesky": "You don't need the Bluesky archive (<code>.car</code>): posts are loaded by handle through the open Bluesky API (block above). " +
        "Only CSV/JSON can be passed here.",
      "help.facebook": "Settings → Accounts Center → Your information and permissions → Download your information. Format: <b>JSON</b>, " +
        "media quality: low (smaller archive). Posts and comments are checked. " +
        "If the <code>.zip</code> is very large, unzip it and choose the folder.",
      "help.instagram": "Settings → Accounts Center → Your information and permissions → Download your information. Format: <b>JSON</b>. " +
        "Captions and comments are checked. If the <code>.zip</code> is very large, unzip it and choose the folder.",
      "help.vk": "Request your data archive at vk.com/data_protection and select “Wall” and “Comments”. Wall posts and comments are checked. " +
        "VK archive parsing is approximate — verify the findings using the links.",
      "help.snapchat": "Settings → My Data (accounts.snapchat.com) → select “Chat History” and the <b>JSON</b> format. " +
        "Your chat messages are checked — Snapchat does not keep snaps without text.",
      "help.telegram": "Telegram Desktop → Settings → Advanced → Export Telegram data. Select personal chats and groups " +
        "(including public ones), format <b>“Machine-readable JSON”</b>, no media needed. Choose the export folder or the " +
        "<code>result.json</code> file. Your messages are checked; message links exist only in supergroups and channels.",
      "bsky.offline": "Bluesky is not responding — check your internet connection.",
      "bsky.notFound": "Bluesky: account {handle} not found. Use the full handle, e.g. name.bsky.social.",
      "vk.browserOnly": "The VK archive can only be read in a browser.",
      "snap.noChat": "json/chat_history.json not found — choose the JSON format when requesting your Snapchat data.",
      "tg.noResult": "result.json not found — choose “Machine-readable JSON” when exporting from Telegram Desktop.",
      "tg.noOwner": "Warning: a single-chat export has no owner info, so messages from all participants are checked. " +
        "To check only yours, enter your Telegram name in the “only account” field.",
    },

    ja: {
      "meta.description": "X、Bluesky、Facebook、Instagram、VK、Snapchat、Telegramの自分のアカウントに、大量通報で凍結されかねない投稿がないかをチェックします。処理はすべてブラウザ内で行われ、アーカイブはどこにも送信されません。",
      "header.lead": "<b>自分の</b>SNSアカウントに、大量通報によってモデレーションで凍結されかねない投稿がないかをチェックします。" +
        "対象は、集団への侮蔑語、死を願う言葉や自殺の強要、暴力の呼びかけ、非人間化、自殺・自傷の助長です。",
      "header.note": "処理はすべてブラウザ内で行われ、アーカイブや投稿はどこにも送信されません。これは辞書による検索で、" +
        "モデレーションの判定ではありません。検出された投稿は必ず文脈を確認してください。",
      "lang.label": "言語",
      "network.label": "SNS",
      "rules.title": "辞書",
      "rules.builtin": "内蔵辞書（ロシア語・英語と日本語：侮蔑語、暴力、非人間化など）は常に使われます。",
      "rules.custom": "追加の辞書（.json、複数可）:",
      "search.title": "簡単: Xの検索リンク",
      "search.help": "アーカイブは不要です。Xにログインしているブラウザでリンクを開いてください。結果が空なら問題ありません。" +
        "Xの検索は完全一致の語形しか見つけず、伏せ字などで偽装された語は見つけられません。",
      "search.user": "ユーザー名",
      "search.replies": "返信のみ",
      "search.button": "リンクを作成",
      "bsky.title": "簡単かつ完全: ハンドル名で投稿を取得",
      "bsky.help": "アーカイブもログインも不要です。投稿・返信・リポストをすべてBlueskyの公開APIで読み込み、" +
        "この場でチェックします。下のチェック設定が適用されます。",
      "bsky.button": "読み込んでチェック",
      "archive.title": "完全チェック: アカウントのアーカイブ",
      "archive.titleApi": "または: 投稿のCSV/JSON",
      "archive.table": "列 <code>id, text, created_at, username</code> を持つCSV/JSONも使えます。",
      "drop.archive": "アーカイブの<b>.zip</b>、展開したフォルダ、またはCSV/JSONをここにドロップ",
      "drop.api": "ここにCSV/JSONをドロップ",
      "pick.file": "ファイルを選択",
      "pick.dir": "フォルダを選択",
      "opts.title": "チェック設定",
      "opt.replies": "返信とコメントのみ（通報者が最もよく探す対象）",
      "opt.likes": "いいねした投稿もチェック",
      "opt.noretweets": "リツイート・リポストを除外",
      "opt.since": "開始日",
      "opt.until": "終了日",
      "opt.min": "最低点数",
      "opt.account": "アカウントを限定",
      "opt.accountHint": "任意",
      "opt.ignore": "確認済みのID（.txt）",
      "check.button": "チェック",
      "footer": "検出された投稿への対処: 投稿を削除してください（一括削除には <code>ids.txt</code> が便利です）。" +
        "すでに凍結された場合は、SNSのサポートフォームから異議申し立てをしてください。",

      "rules.loadFail": "{files} を読み込めませんでした。ページをファイル（file://）として開いている場合は、サーバー経由" +
        "（python -m http.server）で開くか、「追加の辞書」欄で辞書を選んでください。",
      "rules.jsonError": "辞書 {name}: JSONエラー — {message}",
      "rules.none": "辞書を1つ以上選んでください。",
      "rules.regexError": "辞書の正規表現にエラーがあります: {message}",
      "out.pdf": "PDF（印刷 → PDFとして保存）",
      "search.noTerms": "選択した辞書に search_terms がないため、検索リンクを作れません。",
      "search.done": "検索リンク: {n}件。Xにログインした状態で開いてください。",
      "source.selected": "選択中: {name}",
      "source.bad": "{name} は使えません。{net} のアーカイブ（.zip またはフォルダ）かCSV/JSONが必要です。",
      "source.emptyDir": "フォルダにファイルがありません。",
      "source.dir": "フォルダ {name}",
      "source.dirUnknown": "アーカイブのフォルダ",
      "source.noJszip": "JSZipライブラリを読み込めませんでした（インターネット接続が必要です）。アーカイブを展開してフォルダを選んでください。",
      "source.noRecords": "{name} に {net} の投稿が見つかりません。正しいSNSを選んでいるか、アーカイブの形式が正しいか確認してください。",
      "status.readingDir": "フォルダを読み込み中…",
      "status.reading": "{name} を読み込み中…",
      "status.checking": "{n}件をチェック中…",
      "status.bsky": "{handle} の投稿を読み込み中…",
      "status.summary": "{net}、アカウント: {who}。チェック: {total}件、検出: {found}件（高 {high}、中 {medium}、低 {low}）",

      "net.vk": "VK",
      "help.x": "X → 設定とプライバシー → アカウント → データのアーカイブをダウンロード。準備に1〜2日かかり、その後 <code>.zip</code> のリンクが届きます。",
      "help.bluesky": "Blueskyのアーカイブ（<code>.car</code>）は不要です。投稿はハンドル名から公開APIで読み込みます（上のブロック）。" +
        "ここにはCSV/JSONのみ渡せます。",
      "help.facebook": "設定 → アカウントセンター → 個人の情報とアクセス許可 → 個人データをダウンロード。形式は<b>JSON</b>、" +
        "メディアの画質は「低」（アーカイブが小さくなります）。投稿とコメントをチェックします。" +
        "<code>.zip</code> が大きすぎる場合は、展開してフォルダを選んでください。",
      "help.instagram": "設定 → アカウントセンター → 個人の情報とアクセス許可 → 個人データをダウンロード。形式は<b>JSON</b>。" +
        "投稿のキャプションとコメントをチェックします。<code>.zip</code> が大きすぎる場合は、展開してフォルダを選んでください。",
      "help.vk": "vk.com/data_protection でデータのアーカイブを請求し、「Wall」と「Comments」を選択します。ウォールの投稿とコメントをチェックします。" +
        "VKのアーカイブの解析は近似的なため、検出結果はリンクで確認してください。",
      "help.snapchat": "設定 → マイデータ（accounts.snapchat.com）→「Chat History」と<b>JSON</b>形式を選択。" +
        "チャットで送ったメッセージをチェックします（テキストのないスナップは保存されません）。",
      "help.telegram": "Telegram Desktop → 設定 → 詳細設定 → Telegramのデータをエクスポート。個人チャットとグループ（公開グループを含む）を選び、" +
        "形式は<b>「JSON（機械可読）」</b>、メディアは不要です。エクスポートしたフォルダか <code>result.json</code> を選んでください。" +
        "自分のメッセージをチェックします。メッセージへのリンクはスーパーグループとチャンネルのみです。",
      "bsky.offline": "Blueskyが応答しません。インターネット接続を確認してください。",
      "bsky.notFound": "Bluesky: アカウント {handle} が見つかりません。name.bsky.social のように完全なハンドル名を入力してください。",
      "vk.browserOnly": "VKのアーカイブはブラウザでのみ読み込めます。",
      "snap.noChat": "json/chat_history.json が見つかりません。Snapchatのデータ請求時にJSON形式を選んでください。",
      "tg.noResult": "result.json が見つかりません。Telegram Desktopのエクスポートで「JSON（機械可読）」を選んでください。",
      "tg.noOwner": "注意: 1つのチャットのエクスポートには所有者の情報がないため、全参加者のメッセージをチェックします。" +
        "自分のメッセージだけにするには「アカウントを限定」欄にTelegramの表示名を入力してください。",
    },
  };

  const LANGS = Object.keys(STRINGS);
  const STORE_KEY = "slursearchsm-lang";

  /** Первый язык из списка предпочтений, который у нас есть: ru, ja или en; остальным — английский. */
  function pick(prefs) {
    for (const p of prefs) {
      const code = String(p || "").toLowerCase().slice(0, 2);
      if (LANGS.includes(code)) return code;
    }
    return "en";
  }

  function detect() {
    const prefs = [];
    if (typeof location !== "undefined") prefs.push(new URLSearchParams(location.search).get("lang"));
    try {
      prefs.push(localStorage.getItem(STORE_KEY));
    } catch (e) {
      // хранилище недоступно — берём язык браузера
    }
    if (typeof navigator !== "undefined") prefs.push(...(navigator.languages || [navigator.language]));
    return pick(prefs.filter(Boolean));
  }

  const I18N = {
    LANGS,
    lang: "ru",
    /** Текст по ключу с подстановкой {имя}; если перевода нет — русский. */
    t(key, params = {}) {
      const text = STRINGS[I18N.lang][key] ?? STRINGS.ru[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
    },
    /** Тексты страницы: data-i18n — текст, data-i18n-html — разметка, data-i18n-placeholder — подсказка в поле. */
    apply(doc) {
      doc.documentElement.lang = I18N.lang;
      for (const el of doc.querySelectorAll("[data-i18n]")) el.textContent = I18N.t(el.dataset.i18n);
      for (const el of doc.querySelectorAll("[data-i18n-html]")) el.innerHTML = I18N.t(el.dataset.i18nHtml);
      for (const el of doc.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = I18N.t(el.dataset.i18nPlaceholder);
      const meta = doc.querySelector('meta[name="description"]');
      if (meta) meta.content = I18N.t("meta.description");
    },
    setLang(lang, remember = false) {
      I18N.lang = LANGS.includes(lang) ? lang : "en";
      if (!remember) return;
      try {
        localStorage.setItem(STORE_KEY, I18N.lang);
      } catch (e) {
        // без сохранения выбора — не страшно
      }
    },
  };
  I18N.lang = detect();

  if (typeof module !== "undefined" && module.exports) module.exports = I18N;
  else root.I18N = I18N;
})(typeof self !== "undefined" ? self : this);
