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

  let config = null; // { scoring, levels } із levels.json
  let currentScreen = 'menu';
  const run = {
    levelIndex: 0,
    totalScore: 0,
    solutions: [], // ходи кожного пройденого рівня (їх перевірить бот)
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
    // Вихід у меню: поточний прогрес та результат відкидаються
    hideOverlay();
    run.game = null;
    run.solutions = [];
    run.totalScore = 0;
    run.levelIndex = 0;
    run.locked = false;
    showScreen('menu');
  }

  // ---------- HUD ----------
  function updateHud() {
    $('hud-score').textContent = String(run.totalScore).padStart(6, '0');
    $('hud-level').textContent =
      String(run.levelIndex + 1).padStart(2, '0') + '/' + String(config.levels.length).padStart(2, '0');
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
    $('overlay').classList.remove('hidden');
  }

  function hideOverlay() {
    $('overlay').classList.add('hidden');
  }

  // ---------- Перебіг гри ----------
  function startNewGame() {
    if (!config) return;
    run.levelIndex = 0;
    run.totalScore = 0;
    run.solutions = [];
    loadLevel(0);
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
    updateHud();
    render();
  }

  function undoMove() {
    if (currentScreen !== 'game' || run.locked || !run.game) return;
    if (!run.game.undo()) return;
    haptic('light');
    $('hud-moves').textContent = String(run.game.moves.length);
    updateUndoButton();
    render();
  }

  function tryMove(dir) {
    if (currentScreen !== 'game' || run.locked || !run.game) return;
    const result = run.game.move(dir);
    if (!result.moved) return;
    if (result.pushed) haptic('light');
    $('hud-moves').textContent = String(run.game.moves.length);
    updateUndoButton();
    render();
    if (run.game.isSolved()) onLevelSolved();
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
    showOverlay({
      title: 'РІВЕНЬ ПРОЙДЕНО!',
      lines: [
        { text: `Кроків: ${moves} (еталон: ${level.par})` },
        { text: `+${points} очок`, cls: 'big' },
      ],
      buttons: [
        isLast
          ? { text: '🏁 Завершити гру', cls: 'btn-green', onClick: finishGame }
          : { text: '▶ Далі', cls: 'btn-green', onClick: () => loadLevel(run.levelIndex + 1) },
      ],
    });
  }

  // ---------- Завершення гри та відправка результату ----------
  // Ходи пакуються (2 біти на хід) і надсилаються боту через Telegram (sendData).
  // Бот сам перевіряє ходи за правилами й рахує очки, тому підробити результат не вийде.
  const MOVE_CODE = { U: 0, D: 1, L: 2, R: 3 };

  function packSolutions(solutions) {
    const lengths = solutions.map((m) => m.length);
    const total = lengths.reduce((a, b) => a + b, 0);
    const bytes = new Uint8Array(Math.ceil(total / 4));
    let pos = 0;
    solutions.forEach((m) => {
      for (const ch of m) {
        bytes[pos >> 2] |= MOVE_CODE[ch] << ((pos & 3) * 2);
        pos += 1;
      }
    });
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return JSON.stringify({ v: 1, n: lengths, d: btoa(bin) });
  }

  function finishGame() {
    const lines = [
      { text: 'Усі рівні пройдено!' },
      { text: `SCORE: ${run.totalScore}`, cls: 'big' },
    ];
    if (!IN_TELEGRAM) {
      lines.push({ text: 'Результат не збережено: гру відкрито не через Telegram.', cls: 'error' });
      showOverlay({ title: 'ВІТАЄМО!', lines, buttons: [{ text: '🏠 В меню', cls: 'btn-pink', onClick: goToMenu }] });
      return;
    }
    lines.push({ text: 'Надсилаємо результат боту…' });
    showOverlay({ title: 'ВІТАЄМО!', lines, buttons: [] });
    try {
      // Після відправки Telegram сам закриє гру, а бот напише у чат місце в Залі слави
      tg.sendData(packSolutions(run.solutions));
    } catch (err) {
      showOverlay({
        title: 'ВІТАЄМО!',
        lines: [
          { text: `SCORE: ${run.totalScore}`, cls: 'big' },
          { text: 'Не вдалося надіслати результат.', cls: 'error' },
          { text: 'Закрийте гру й відкрийте її кнопкою «🎮 Грати в Сокобан» внизу чату з ботом.', cls: 'error' },
        ],
        buttons: [
          { text: '🔁 Спробувати ще раз', cls: 'btn-green', onClick: finishGame },
          { text: '🏠 В меню', cls: 'btn-pink', onClick: goToMenu },
        ],
      });
    }
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

  function openScores() {
    showScreen('scores');
    const list = $('score-list');
    const status = $('score-status');
    list.textContent = '';
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

  // ---------- Керування ----------
  function bindControls() {
    // Кнопки меню
    $('btn-new').addEventListener('click', startNewGame);
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

    window.addEventListener('resize', () => { if (currentScreen === 'game') fitAndRender(); });
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
        tg.onEvent('viewportChanged', () => { if (currentScreen === 'game') fitAndRender(); });
      } catch (e) { /* старі версії Telegram */ }
    }

    drawStaticSprites();
    bindControls();

    try {
      const res = await fetch('./levels.json', { cache: 'no-store' });
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
  }

  init();
})();
