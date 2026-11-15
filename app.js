/*
 * Інтерфейс гри: екрани, малювання поля, керування, зв'язок із бекендом.
 * Логіка правил — у game.js, спрайти — у sprites.js.
 */
(function () {
  'use strict';

  // ---------- Telegram ----------
  const tg = window.Telegram && window.Telegram.WebApp;
  // Для кнопки клавіатури initData може бути порожнім, тому дивимось і на platform (у браузері це 'unknown')
  const IN_TELEGRAM = Boolean(tg && (tg.initData || (tg.platform && tg.platform !== 'unknown')));
  const BG_COLOR = '#070b24';

  // ---------- Допоміжне ----------
  const $ = (id) => document.getElementById(id);

  const screens = {
    menu: $('screen-menu'),
    howto: $('screen-howto'),
    game: $('screen-game'),
    scores: $('screen-scores'),
  };
  const canvas = $('board');
  const boardWrap = $('board-wrap');

  let config = null; // { scoring, chapter_size, levels } із levels.json
  let currentScreen = 'menu';
  const run = {
    levelIndex: 0,
    totalScore: 0,
    solutions: [], // ходи кожного пройденого рівня (їх перевірить бот)
    sendFrom: 0, // з якого розділу починати наступну відправку результату (через бота)
    synced: {}, // розділи, уже збережені в Firebase: { 'c3': очки }
    game: null,
    locked: false, // true, поки показано вікно «рівень пройдено»
    tile: 32,
  };

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
      else tg.HapticFeedback.impactOccurred(kind);
    } catch (e) { /* вібрація не критична */ }
  }

  // ---------- Очки (формула така ж, як на сервері) ----------
  function levelScore(moves, par) {
    const s = config.scoring;
    return Math.max(s.min, s.base - s.per_extra_move * Math.max(0, moves - par));
  }

  // ---------- Екрани ----------
  function showScreen(name) {
    currentScreen = name;
    Object.keys(screens).forEach((key) => screens[key].classList.toggle('active', key === name));
    if (tg && tg.BackButton) {
      if (name === 'menu') tg.BackButton.hide();
      else tg.BackButton.show();
    }
    if (name === 'game') requestAnimationFrame(fitAndRender);
  }

  function goToMenu() {
    // Вихід у меню: прогрес уже збережено (як у старих іграх на приставці)
    hideOverlay();
    run.game = null;
    run.solutions = [];
    run.totalScore = 0;
    run.levelIndex = 0;
    run.locked = false;
    refreshMenu();
    showScreen('menu');
  }

  // ---------- Збереження гри ----------
  // Прогрес лежить у пам'яті телефона (localStorage), окремо для цієї гри.
  const SAVE_KEY = 'sokoban_save_v2';

  function configSignature() {
    // Якщо рівні в грі змінилися, старе збереження не підходить і ігнорується
    return config.levels.length + ':' + config.levels.reduce((a, l) => a + l.par, 0);
  }

  // levelIndex/current можна задати явно (наприклад, одразу після проходження рівня)
  function writeSave(levelIndex, current) {
    if (!config || !run.game) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        sig: configSignature(),
        levelIndex: levelIndex === undefined ? run.levelIndex : levelIndex,
        totalScore: run.totalScore,
        solutions: run.solutions,
        current: current === undefined ? run.game.moves : current,
        finished: Boolean(run.finished),
        sendFrom: run.sendFrom || 0,
        synced: run.synced || {},
      }));
    } catch (e) { /* збереження недоступне — гра працює й без нього */ }
  }

  /** Чи проходить цей запис ходів рівень (у поточній версії гри). */
  function solvesLevel(level, moves) {
    if (typeof moves !== 'string' || !moves) return false;
    const g = new SokobanGame(level.map);
    for (const ch of moves) {
      if (!'UDLR'.includes(ch) || !g.move(ch).moved) return false;
      if (g.isSolved()) return ch === moves[moves.length - 1] && moves.length === g.moves.length;
    }
    return false;
  }

  /**
   * Читає збереження. Якщо рівні в грі змінилися, зберігаємо стільки пройдених рівнів,
   * скільки досі збігаються з новими, і продовжуємо з першого, що змінився.
   */
  function readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw || !config) return null;
      const d = JSON.parse(raw);
      if (!Array.isArray(d.solutions) || !Number.isInteger(d.levelIndex)) return null;
      const n = config.levels.length;
      let keep = 0;
      while (keep < d.solutions.length && keep < n && solvesLevel(config.levels[keep], d.solutions[keep])) keep += 1;
      if (keep === 0 && d.solutions.length > 0) return null;
      if (keep < d.solutions.length) {
        // рівні змінилися: повертаємось до першого рівня, що не збігається
        const solutions = d.solutions.slice(0, keep);
        const score = solutions.reduce((sum, m, i) => sum + levelScore(m.length, config.levels[i].par), 0);
        return { levelIndex: keep, totalScore: score, solutions, current: '', finished: false, sendFrom: 0, synced: {} };
      }
      if (d.levelIndex < 0 || d.levelIndex >= n) return null;
      if (d.solutions.length !== d.levelIndex + (d.finished ? 1 : 0)) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* нічого */ }
  }

  /** Визначає горизонтальну/вертикальну розкладку за розміром вікна й підганяє поле. */
  let lastSize = '';
  function applyLayout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const key = w + 'x' + h;
    if (key === lastSize) return;
    lastSize = key;
    const root = document.documentElement;
    root.dataset.layout = w > h && h <= 560 ? 'landscape' : 'portrait';
    root.style.setProperty('--app-h', h + 'px');
    if (currentScreen === 'game') fitAndRender();
  }

  /** Показує або ховає «Продовжити» та «Надіслати результат» залежно від наявності збереження. */
  function refreshMenu() {
    const save = config ? readSave() : null;
    const btn = $('btn-continue');
    const info = $('continue-info');
    const send = $('btn-send');
    const done = save ? chaptersDone(save.solutions.length) : 0;
    btn.classList.toggle('hidden', !save || save.finished);
    info.classList.toggle('hidden', !save);
    send.classList.toggle('hidden', done === 0);
    if (save) {
      const level = save.finished ? config.levels.length : save.levelIndex + 1;
      info.textContent = save.finished
        ? `Усі рівні пройдено · SCORE ${save.totalScore}`
        : `Рівень ${level} із ${config.levels.length} · SCORE ${save.totalScore}`;
    }
    if (done > 0 && cloudOn()) {
      send.textContent = '☁ Зберегти в Зал слави';
    } else if (done > 0) {
      const batch = buildBatch(save.solutions, save.sendFrom || 0);
      const range = batch ? chapterRange(batch.chapters) : '';
      send.textContent = '📤 Надіслати результат' + (range ? ` (розділ ${range})` : '');
    }
    const nb = $('btn-new');
    nb.classList.toggle('btn-green', !save);
    nb.classList.toggle('btn-blue', Boolean(save));
  }

  function confirmDialog(message, onYes) {
    if (tg && tg.showConfirm) {
      try { tg.showConfirm(message, (ok) => { if (ok) onYes(); }); return; } catch (e) { /* далі звичайний confirm */ }
    }
    if (window.confirm(message)) onYes();
  }

  function continueGame() {
    const save = readSave();
    if (!save) { refreshMenu(); return; }
    run.totalScore = save.totalScore;
    run.solutions = save.solutions.slice();
    run.finished = false;
    run.sendFrom = save.sendFrom || 0;
    run.synced = save.synced || {};
    showScreen('game');
    if (save.finished) {
      loadLevel(save.levelIndex);
      // повертаємо розв'язаний останній рівень і пропонуємо надіслати результат
      for (const ch of save.current) run.game.move(ch);
      render();
      run.finished = true;
      finishGame();
      return;
    }
    loadLevel(save.levelIndex);
    // відновлюємо ходи на поточному рівні
    for (const ch of save.current) {
      if (!run.game.move(ch).moved) { run.game.reset(); break; }
    }
    updateHud();
    render();
  }

  // ---------- HUD ----------
  function updateHud() {
    $('hud-score').textContent = String(run.totalScore).padStart(6, '0');
    const levelText = (run.levelIndex + 1) + '/' + config.levels.length;
    $('hud-level').textContent = levelText;
    $('hud-level').style.fontSize = levelText.length > 6 ? 'clamp(9px, 2.9vw, 13px)' : '';
    $('hud-moves').textContent = String(run.game ? run.game.moves.length : 0);
    $('level-name').textContent = config.levels[run.levelIndex].name.toUpperCase();
    updateUndoButton();
  }

  // «Крок назад» доступний, лише якщо є що скасовувати
  function updateUndoButton() {
    $('btn-undo').disabled = !run.game || !run.game.canUndo();
  }

  // ---------- Малювання поля ----------
  function fitAndRender() {
    const g = run.game;
    if (!g) return;
    const availW = boardWrap.clientWidth - 8;
    const availH = boardWrap.clientHeight - 8;
    const tile = Math.floor(Math.min(availW / g.width, availH / g.height));
    run.tile = Math.max(10, Math.min(56, tile));
    render();
  }

  function render() {
    const g = run.game;
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(1, Math.round(run.tile * dpr)); // розмір клітинки у фізичних пікселях
    canvas.width = g.width * px;
    canvas.height = g.height * px;
    canvas.style.width = (canvas.width / dpr) + 'px';
    canvas.style.height = (canvas.height / dpr) + 'px';

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const dx = x * px;
        const dy = y * px;
        if (g.isWall(x, y)) {
          if (x < g.rows[y].length) Sprites.draw(ctx, 'wall', dx, dy, px);
          continue;
        }
        if (!g.isFloor(x, y)) continue; // порожнеча за межами кімнати
        Sprites.draw(ctx, g.isGoal(x, y) ? 'goal' : 'floor', dx, dy, px);
        if (g.hasBox(x, y)) Sprites.draw(ctx, g.isGoal(x, y) ? 'boxDone' : 'box', dx, dy, px);
      }
    }
    Sprites.draw(ctx, 'player', g.player.x * px, g.player.y * px, px);
  }

  // ---------- Вікно-оверлей ----------
  function showOverlay(opts) {
    run.locked = true;
    $('overlay-title').textContent = opts.title;
    const lines = $('overlay-lines');
    lines.textContent = '';
    (opts.lines || []).forEach((line) => {
      const p = document.createElement('p');
      p.className = 'line' + (line.cls ? ' ' + line.cls : '');
      p.textContent = line.text;
      lines.appendChild(p);
    });
    const buttons = $('overlay-buttons');
    buttons.textContent = '';
    (opts.buttons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || 'btn-green');
      btn.textContent = b.text;
      btn.addEventListener('click', b.onClick);
      buttons.appendChild(btn);
    });
    const input = $('overlay-input');
    input.classList.toggle('hidden', !opts.input);
    if (opts.input) input.value = opts.input.value || '';
    $('overlay').classList.remove('hidden');
    if (opts.input) setTimeout(() => { try { input.focus(); } catch (e) { /* не критично */ } }, 50);
  }

  function addOverlayLine(text, cls) {
    const p = document.createElement('p');
    p.className = 'line' + (cls ? ' ' + cls : '');
    p.textContent = text;
    $('overlay-lines').appendChild(p);
    return p;
  }

  function hideOverlay() {
    $('overlay-input').classList.add('hidden');
    $('overlay').classList.add('hidden');
  }

  // ---------- Перебіг гри ----------
  function startNewGame() {
    if (!config) return;
    if (readSave()) {
      confirmDialog('Почати нову гру? Збережений прогрес буде стерто.', beginNewGame);
    } else {
      beginNewGame();
    }
  }

  function beginNewGame() {
    run.levelIndex = 0;
    run.totalScore = 0;
    run.solutions = [];
    run.finished = false;
    run.sendFrom = 0;
    run.synced = {};
    loadLevel(0);
    writeSave(); // нова гра одразу замінює старе збереження
    showScreen('game');
  }

  function loadLevel(index) {
    run.levelIndex = index;
    run.game = new SokobanGame(config.levels[index].map);
    run.locked = false;
    hideOverlay();
    updateHud();
    fitAndRender();
  }

  function restartLevel() {
    if (!run.game || run.locked) return;
    run.game.reset(); // ходи рівня обнуляються — рахунок піде з нуля
    Sfx.restart();
    updateHud();
    render();
    writeSave();
  }

  function undoMove() {
    if (currentScreen !== 'game' || run.locked || !run.game) return;
    if (!run.game.undo()) return;
    haptic('light');
    Sfx.undo();
    $('hud-moves').textContent = String(run.game.moves.length);
    updateUndoButton();
    render();
    writeSave();
  }

  /** Скільки ящиків зараз стоїть на цілях (лимонах). */
  function boxesOnGoals() {
    let n = 0;
    for (const k of run.game.boxes) if (run.game.goals.has(k)) n += 1;
    return n;
  }

  function tryMove(dir) {
    if (currentScreen !== 'game' || run.locked || !run.game) return;
    const before = boxesOnGoals();
    const result = run.game.move(dir);
    if (!result.moved) return;
    if (result.pushed) {
      haptic('light');
      if (boxesOnGoals() > before) Sfx.goalIn(); else Sfx.push();
    }
    $('hud-moves').textContent = String(run.game.moves.length);
    updateUndoButton();
    render();
    if (run.game.isSolved()) onLevelSolved();
    else writeSave();
  }

  function onLevelSolved() {
    const level = config.levels[run.levelIndex];
    const moves = run.game.moves.length;
    const points = levelScore(moves, level.par);
    run.totalScore += points;
    run.solutions.push(run.game.moves);
    updateHud();
    haptic('success');

    const isLast = run.levelIndex === config.levels.length - 1;
    const chapterEnd = isLast || run.solutions.length % chapterSize() === 0;
    if (isLast) Sfx.win(); else Sfx.level();
    // Зберігаємо: відкриваємо наступний рівень (або позначаємо, що гру завершено)
    if (isLast) {
      run.finished = true;
      writeSave();
    } else {
      writeSave(run.levelIndex + 1, '');
    }
    presentSolved({ level, moves, points, chapterEnd, isLast });
  }

  /** Вікно «рівень пройдено». Наприкінці розділу ще й зберігає результат (у Firebase або через бота). */
  function presentSolved(info) {
    const { level, moves, points, chapterEnd, isLast } = info;
    const cloud = chapterEnd && cloudOn();
    const lines = [
      { text: `Кроків: ${moves} (еталон: ${level.par})` },
      { text: `+${points} очок`, cls: 'big' },
    ];
    const buttons = [];
    if (chapterEnd) {
      lines.push({ text: `Розділ ${Math.ceil(run.solutions.length / chapterSize())} пройдено!`, cls: 'big' });
      if (!isLast && !cloud) lines.push({ text: 'Можна надіслати результат боту в Зал слави (гра на мить закриється) або грати далі.' });
    }
    if (isLast) buttons.push({ text: '🏁 Завершити гру', cls: 'btn-green', onClick: finishGame });
    else {
      buttons.push({ text: '▶ Далі', cls: 'btn-green', onClick: () => loadLevel(run.levelIndex + 1) });
      if (chapterEnd && !cloud) buttons.push({ text: '📤 Надіслати результат', cls: 'btn-yellow', onClick: () => sendResults(run.solutions, run.sendFrom) });
    }
    showOverlay({ title: isLast ? 'ВСІ РІВНІ ПРОЙДЕНО!' : 'РІВЕНЬ ПРОЙДЕНО!', lines, buttons });
    if (cloud && !isLast) cloudStep(() => presentSolved(info));
  }

  /** Крок збереження у хмару всередині вікна: спершу ім'я (якщо потрібне), потім запис і повтор у разі помилки. */
  function cloudStep(redraw) {
    const box = $('overlay-buttons');
    if (!Cloud.playerName()) {
      const b = document.createElement('button');
      b.className = 'btn btn-yellow';
      b.textContent = '✍ Вказати ім\'я для Залу слави';
      b.addEventListener('click', () => ensureName(redraw));
      box.appendChild(b);
      addOverlayLine('Щоб результат потрапив у Зал слави, вкажіть ім\'я.');
      return;
    }
    const el = addOverlayLine('');
    runCloudUpload(run.solutions, el).then((ok) => {
      if (ok) return;
      const b = document.createElement('button');
      b.className = 'btn btn-yellow';
      b.textContent = '🔁 Зберегти ще раз';
      b.addEventListener('click', () => { b.remove(); cloudStep(redraw); });
      box.appendChild(b);
    });
  }

  // ---------- Надсилання результату ----------
  // Гра ділиться на розділи по chapter_size рівнів. Ходи пройдених розділів пакуються (2 біти на хід)
  // і надсилаються боту через Telegram (sendData). Бот сам перевіряє ходи за правилами й рахує очки,
  // тому підробити результат не вийде. Ліміт одного повідомлення — 4096 байт, тож за раз
  // відправляється стільки розділів, скільки влізе; наступне натискання шле наступну порцію.
  const MOVE_CODE = { U: 0, D: 1, L: 2, R: 3 };
  const MAX_PAYLOAD = 3800;

  function chapterSize() { return (config && config.chapter_size) || 25; }

  /** Скільки розділів у всій грі: стільки треба пройти, щоб потрапити в Зал слави. */
  function totalChapters() { return Math.ceil(config.levels.length / chapterSize()); }

  /** Скільки розділів пройдено повністю (при заданій кількості пройдених рівнів). */
  function chaptersDone(solved) {
    const n = config.levels.length, size = chapterSize();
    return solved >= n ? Math.ceil(n / size) : Math.floor(solved / size);
  }

  function packMoves(text) {
    const bytes = new Uint8Array(Math.ceil(text.length / 4));
    for (let i = 0; i < text.length; i++) bytes[i >> 2] |= MOVE_CODE[text[i]] << ((i & 3) * 2);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  /** Збирає порцію розділів, починаючи з розділу `from` (по колу), у межах ліміту повідомлення. */
  function buildBatch(solutions, from) {
    const done = chaptersDone(solutions.length);
    if (done === 0) return null;
    const size = chapterSize();
    const start = from >= 0 && from < done ? from : 0;
    const items = [];
    const chapters = [];
    let length = 12; // {"v":3,"p":[]}
    for (let step = 0; step < done; step++) {
      const c = (start + step) % done;
      const moves = solutions.slice(c * size, (c + 1) * size).join('');
      const item = JSON.stringify([c, moves.length, packMoves(moves)]);
      if (length + item.length + 1 > MAX_PAYLOAD) break;
      items.push(item);
      chapters.push(c);
      length += item.length + 1;
    }
    if (!chapters.length) return { payload: null, chapters: [], next: start };
    return {
      payload: '{"v":3,"p":[' + items.join(',') + ']}',
      chapters,
      next: (chapters[chapters.length - 1] + 1) % done,
    };
  }

  /** «1–3» або «5» для списку розділів (нумерація для людей, з одиниці). */
  function chapterRange(chapters) {
    if (!chapters.length) return '';
    const sorted = chapters.map((c) => c + 1).sort((a, b) => a - b);
    let contiguous = true;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) contiguous = false;
    if (sorted.length === 1) return String(sorted[0]);
    return contiguous ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(', ');
  }

  /** Дописує поля у збереження (без запуску гри). */
  function patchSave(fields) {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign(JSON.parse(raw), fields)));
    } catch (e) { /* не критично */ }
  }

  /** Запам'ятовує, з якого розділу почати наступну відправку через бота. */
  function rememberSendFrom(next) {
    run.sendFrom = next;
    patchSave({ sendFrom: next });
  }

  function showMenuError(text, ok) {
    const err = $('menu-error');
    err.textContent = text;
    err.classList.toggle('hidden', !text);
    err.classList.toggle('ok', Boolean(ok));
  }

  // ---------- Хмарний Зал слави (Firebase) ----------
  function cloudOn() { return Boolean(window.Cloud && Cloud.enabled()); }

  /** Усі пройдені розділи у вигляді [{c, score, moves, d}] для збереження в базі. */
  function chapterItems(solutions) {
    const size = chapterSize();
    const items = [];
    for (let c = 0; c < chaptersDone(solutions.length); c++) {
      const part = solutions.slice(c * size, (c + 1) * size);
      let score = 0;
      part.forEach((m, i) => { score += levelScore(m.length, config.levels[c * size + i].par); });
      const moves = part.join('');
      items.push({ c, score, moves: moves.length, d: packMoves(moves) });
    }
    return items;
  }

  /** Просить ввести ім'я (якщо Telegram його не передав), потім викликає next(). */
  function ensureName(next) {
    if (Cloud.playerName()) { next(); return; }
    showOverlay({
      title: 'ТВОЄ ІМ\'Я',
      lines: [{ text: 'Під цим іменем ти з\'явишся в Залі слави.' }],
      input: { value: '' },
      buttons: [{
        text: '💾 Зберегти',
        cls: 'btn-green',
        onClick: () => {
          if (!Cloud.setName($('overlay-input').value)) { $('overlay-input').focus(); return; }
          next();
        },
      }],
    });
  }

  /** Зберігає у Firebase нові або покращені розділи. Повертає { score, chapters, rank }. */
  async function cloudUpload(solutions) {
    const items = chapterItems(solutions).filter((it) => run.synced['c' + it.c] !== it.score);
    let res;
    if (items.length) {
      res = await Cloud.submit(items, totalChapters());
      items.forEach((it) => { run.synced['c' + it.c] = it.score; });
      patchSave({ synced: run.synced });
    } else {
      const top = await Cloud.fetchTop(0, totalChapters());
      res = { score: top.myScore || 0, rank: top.myRank, chapters: chaptersDone(solutions.length) };
    }
    return res;
  }

  function cloudSummary(res) {
    if (res.rank) return `☁ Збережено! Ви в Залі слави: місце #${res.rank}, очок: ${res.score}.`;
    return `☁ Прогрес збережено: розділів ${res.chapters} із ${totalChapters()}, очок: ${res.score}. У Зал слави потрапляють ті, хто пройде всі ${config.levels.length} рівнів.`;
  }

  /** Збереження в хмару з показом стану у вікні (el — рядок статусу) або в меню. */
  function runCloudUpload(solutions, el) {
    const say = (text, kind) => {
      if (el) { el.textContent = text; el.className = 'line' + (kind ? ' ' + kind : ''); }
      else showMenuError(text, kind === 'ok');
    };
    say('☁ Зберігаємо в Зал слави…');
    return cloudUpload(solutions).then(
      (res) => { say(cloudSummary(res), 'ok'); return true; },
      (err) => { say('Не вдалося зберегти: ' + (err && err.message ? err.message : 'помилка') + '. Спробуйте ще раз із меню («📤 Надіслати результат»).', 'error'); return false; }
    );
  }

  /** Надсилає боту порцію розділів. Після sendData Telegram сам закриває гру, а бот пише у чат місце в Залі слави. */
  function sendResults(solutions, from) {
    if (cloudOn()) {
      ensureName(() => {
        hideOverlay();
        runCloudUpload(solutions, null);
      });
      return;
    }
    const batch = buildBatch(solutions, from || 0);
    if (!batch || !batch.payload) {
      sendFailed('Розділ завеликий для одного повідомлення. Напишіть розробнику.');
      return;
    }
    if (!IN_TELEGRAM) {
      sendFailed('Результат не збережено: гру відкрито не через Telegram.');
      return;
    }
    try {
      rememberSendFrom(batch.next);
      tg.sendData(batch.payload);
    } catch (err) {
      sendFailed('Не вдалося надіслати результат. Закрийте гру й відкрийте її кнопкою «🎮 Грати в Сокобан» внизу чату з ботом.');
    }
  }

  function sendFailed(text) {
    if (currentScreen === 'game') {
      showOverlay({
        title: 'ОЙ…',
        lines: [{ text, cls: 'error' }],
        buttons: [{ text: '🏠 В меню', cls: 'btn-pink', onClick: goToMenu }],
      });
    } else {
      showMenuError(text);
    }
  }

  function sendFromMenu() {
    const save = readSave();
    if (!save) { refreshMenu(); return; }
    showMenuError('');
    run.synced = save.synced || {};
    sendResults(save.solutions, save.sendFrom || 0);
  }

  function finishGame() {
    const lines = [
      { text: 'Усі 1000 рівнів пройдено! Ви — легенда складу.' },
      { text: `SCORE: ${run.totalScore}`, cls: 'big' },
    ];
    if (cloudOn()) {
      showOverlay({ title: 'ВІТАЄМО!', lines, buttons: [{ text: '🏠 В меню', cls: 'btn-pink', onClick: goToMenu }] });
      cloudStep(finishGame);
      return;
    }
    lines.push({ text: 'Надішліть результат боту: кнопка надсилає розділи порціями. Якщо їх багато, натискайте «📤 Надіслати результат» у меню, доки не пройдуть усі.' });
    showOverlay({
      title: 'ВІТАЄМО!',
      lines,
      buttons: [
        { text: '📤 Надіслати результат', cls: 'btn-green', onClick: () => sendResults(run.solutions, run.sendFrom) },
        { text: '🏠 В меню', cls: 'btn-pink', onClick: goToMenu },
      ],
    });
  }

  // ---------- Зал слави ----------
  // Знімок рейтингу бот вшиває в адресу гри (?top=...), коли надсилає кнопку «Грати».
  function readTop() {
    try {
      const raw = new URLSearchParams(location.search).get('top');
      if (!raw) return null;
      let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      return null;
    }
  }

  async function openCloudScores(list, status) {
    status.textContent = '☁ Завантажуємо Зал слави…';
    try {
      const res = await Cloud.fetchTop(10, totalChapters());
      list.textContent = '';
      const mineText = res.myRank ? '' : (res.myChapters
        ? `Ваш прогрес: розділів ${res.myChapters} із ${totalChapters()}. У Зал слави потрапляють ті, хто пройде всі ${config.levels.length} рівнів.`
        : `У Зал слави потрапляють ті, хто пройде всі ${config.levels.length} рівнів.`);
      if (!res.top.length) { status.textContent = 'Поки що ніхто не пройшов усі рівні. Стань першим! ' + mineText; return; }
      status.textContent = mineText;
      const me = Cloud.playerId();
      res.top.forEach((p, i) => list.appendChild(scoreRow(i + 1, p.name, p.score, p.id === me)));
      if (res.myRank && res.myRank > res.top.length) {
        const sep = document.createElement('li');
        sep.className = 'sep';
        sep.textContent = '• • •';
        list.appendChild(sep);
        list.appendChild(scoreRow(res.myRank, 'Ви', res.myScore, true));
      }
    } catch (e) {
      status.textContent = 'Не вдалося завантажити Зал слави: ' + (e && e.message ? e.message : 'помилка') + '.';
    }
  }

  function openScores() {
    showScreen('scores');
    const list = $('score-list');
    const status = $('score-status');
    list.textContent = '';
    if (cloudOn()) { openCloudScores(list, status); return; }
    const data = readTop();
    if (!data) {
      status.textContent = 'Рейтинг показується, коли гру відкрито кнопкою «🎮 Грати в Сокобан» у чаті з ботом. Також працює команда /top.';
      return;
    }
    if (!data.t.length) {
      status.textContent = 'Поки що нікого немає. Пройди всі рівні та стань першим!';
      return;
    }
    status.textContent = '';
    data.t.forEach((p, i) => list.appendChild(scoreRow(i + 1, p[0], p[1], Boolean(data.m) && data.m[0] === i + 1)));
    // Якщо гравця немає у топі — показуємо його місце окремим рядком
    if (data.m && data.m[0] > data.t.length) {
      const sep = document.createElement('li');
      sep.className = 'sep';
      sep.textContent = '• • •';
      list.appendChild(sep);
      list.appendChild(scoreRow(data.m[0], 'Ви', data.m[1], true));
    }
  }

  function scoreRow(rank, name, score, isMe) {
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const li = document.createElement('li');
    if (isMe) li.className = 'me';
    const r = document.createElement('span');
    r.className = 'rank';
    r.textContent = medals[rank] || String(rank);
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name; // textContent — імена гравців не можуть містити HTML
    const s = document.createElement('span');
    s.className = 'pts';
    s.textContent = String(score);
    li.append(r, n, s);
    return li;
  }

  // ---------- Звук ----------
  function updateSoundButtons() {
    const on = Sfx.isEnabled();
    $('btn-sound-menu').textContent = on ? '🔊 Звук: увімкнено' : '🔇 Звук: вимкнено';
    $('btn-sound-hud').textContent = on ? '🔊' : '🔇';
    $('btn-sound-hud').setAttribute('aria-label', on ? 'Вимкнути звук' : 'Увімкнути звук');
  }

  function toggleSound() {
    Sfx.setEnabled(!Sfx.isEnabled());
    updateSoundButtons();
  }

  // ---------- Керування ----------
  function bindControls() {
    // Звук можна запускати лише після першого дотику користувача
    ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => Sfx.unlock(), { once: true, capture: true }));
    // Тихий «клік» на звичайних кнопках меню та ігрового екрана
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.btn');
      if (b && b.id !== 'btn-sound-menu') Sfx.click();
    });
    $('btn-sound-menu').addEventListener('click', toggleSound);
    $('btn-sound-hud').addEventListener('click', toggleSound);
    updateSoundButtons();

    // Кнопки меню
    $('btn-new').addEventListener('click', startNewGame);
    $('btn-continue').addEventListener('click', continueGame);
    $('btn-send').addEventListener('click', sendFromMenu);
    const botLink = String((window.SOKOBAN_CONFIG && window.SOKOBAN_CONFIG.botLink) || '').trim();
    if (/^https:\/\/t\.me\//.test(botLink)) {
      $('btn-bot').classList.remove('hidden');
      $('btn-bot').addEventListener('click', () => {
        try { if (tg && tg.openTelegramLink) { tg.openTelegramLink(botLink); return; } } catch (e) { /* далі звичайне посилання */ }
        window.open(botLink, '_blank');
      });
    }
    $('btn-howto').addEventListener('click', () => showScreen('howto'));
    $('btn-scores').addEventListener('click', openScores);
    document.querySelectorAll('[data-action="back"]').forEach((b) => b.addEventListener('click', goToMenu));

    // Кнопки ігрового екрана
    $('btn-restart').addEventListener('click', restartLevel);
    $('btn-undo').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      undoMove();
    });
    $('btn-exit').addEventListener('click', goToMenu);

    // Екранні стрілки
    document.querySelectorAll('.dbtn').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        tryMove(btn.dataset.dir);
      });
    });

    // Клавіатура (за кодом клавіші, тож працює й з українською розкладкою)
    const keyMap = {
      ArrowUp: 'U', KeyW: 'U', ArrowDown: 'D', KeyS: 'D',
      ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R',
    };
    window.addEventListener('keydown', (e) => {
      if (currentScreen !== 'game') return;
      if (keyMap[e.code]) {
        e.preventDefault();
        tryMove(keyMap[e.code]);
      } else if (e.code === 'KeyZ' || e.code === 'Backspace') {
        e.preventDefault();
        undoMove();
      } else if (e.code === 'KeyR') {
        restartLevel();
      }
    });

    // Свайпи по полю
    let touch = null;
    boardWrap.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      touch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    boardWrap.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    boardWrap.addEventListener('touchend', (e) => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) tryMove(dx > 0 ? 'R' : 'L');
      else tryMove(dy > 0 ? 'D' : 'U');
    }, { passive: true });

    // Розкладка за реальним розміром вікна: надійніше за media-запити, коли Telegram запізнюється після повороту
    const relayout = () => setTimeout(applyLayout, 0);
    applyLayout();
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', () => [100, 350, 800, 1600].forEach((ms) => setTimeout(applyLayout, ms)));
    window.addEventListener('pageshow', relayout);
    document.addEventListener('visibilitychange', relayout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);
    try { if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => [100, 400, 900].forEach((ms) => setTimeout(applyLayout, ms))); } catch (e) { /* не критично */ }
    setInterval(applyLayout, 700); // запасний варіант: перевіряє розмір, навіть якщо подію не надіслали
  }

  // ---------- Малюнки-легенди в меню та інструкції ----------
  function drawStaticSprites() {
    document.querySelectorAll('canvas[data-sprite]').forEach((c) => {
      const size = parseInt(c.dataset.size, 10) || 40;
      c.width = size;
      c.height = size;
      c.style.width = size + 'px';
      c.style.height = size + 'px';
      Sprites.draw(c.getContext('2d'), c.dataset.sprite, 0, 0, size);
    });
  }

  // ---------- Старт ----------
  async function init() {
    if (tg) {
      try {
        tg.ready();
        tg.expand();
        tg.setHeaderColor(BG_COLOR);
        tg.setBackgroundColor(BG_COLOR);
        if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); // свайп вниз не закриває гру
        if (tg.BackButton) tg.BackButton.onClick(goToMenu);
        tg.onEvent('viewportChanged', () => { lastSize = ''; applyLayout(); });
      } catch (e) { /* старі версії Telegram */ }
    }

    drawStaticSprites();
    bindControls();

    try {
      const res = await fetch('./levels.json?v=9', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      config = await res.json();
      const s = config.scoring;
      $('rule-scoring').textContent =
        `За кожен рівень — до ${s.base} очок. За кожен хід понад еталонну кількість віднімається ` +
        `${s.per_extra_move} очок (але не менше ${s.min}). Тож проходь рівні якомога коротшим шляхом!`;
    } catch (e) {
      const err = $('menu-error');
      err.textContent = 'Не вдалося завантажити рівні. Перезапустіть гру.';
      err.classList.remove('hidden');
      $('btn-new').disabled = true;
    }
    refreshMenu();
  }

  init();
})();
