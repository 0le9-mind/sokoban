/*
 * Хмарний Зал слави на Firebase Realtime Database (без сервера і без комп'ютера).
 * Адреса бази береться з config.js. Усе працює через звичайні HTTP-запити (REST), ніякі бібліотеки не потрібні.
 *
 * Структура даних у базі:
 *   <dbPath>/players/<id>          = { name, score, moves, chapters, t }   ← рядок Залу слави
 *   <dbPath>/chapters/<id>/c<N>    = { score, moves, d, t }               ← найкращий результат у розділі N (з нуля)
 *                                                                           d — ходи розділу (2 біти на хід, base64) для перевірки
 */
(function () {
  'use strict';

  const cfg = window.SOKOBAN_CONFIG || {};
  const tg = window.Telegram && window.Telegram.WebApp;
  const TIMEOUT_MS = 9000;
  const ID_KEY = 'sokoban_player_id';
  const NAME_KEY = 'sokoban_player_name';

  function baseUrl() {
    const url = String(cfg.firebaseUrl || '').trim().replace(/\/+$/, '');
    return /^https:\/\/[^\s/]+\.[^\s/]+/.test(url) ? url : '';
  }

  const root = () => baseUrl() + '/' + String(cfg.dbPath || 'sokoban').replace(/^\/+|\/+$/g, '');

  function enabled() { return Boolean(baseUrl()); }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* сховище недоступне */ }
    return null;
  }

  /** Користувач Telegram, якщо Telegram його передав (для кнопки клавіатури буває порожнім). */
  function tgUser() {
    try {
      const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      return u && u.id ? u : null;
    } catch (e) { return null; }
  }

  function playerId() {
    const u = tgUser();
    if (u) return 'tg' + u.id;
    let id = store(ID_KEY);
    if (!id) {
      id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      store(ID_KEY, id);
    }
    return id;
  }

  function cleanName(name) {
    return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  }

  function playerName() {
    const saved = cleanName(store(NAME_KEY));
    if (saved) return saved;
    const u = tgUser();
    if (u) return cleanName([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username);
    return '';
  }

  function setName(name) {
    const n = cleanName(name);
    if (n) store(NAME_KEY, n);
    return n;
  }

  async function request(method, path, body) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetch(root() + path + '.json', {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
      });
      if (res.status === 401 || res.status === 403) throw new Error('база не дозволяє запис (перевірте правила Firebase)');
      if (!res.ok) throw new Error('помилка бази: ' + res.status);
      return await res.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('немає відповіді від бази (перевірте інтернет)');
      if (e instanceof TypeError) throw new Error('немає зв\'язку з базою (перевірте інтернет і адресу в config.js)');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Зберігає розділи [{c, score, moves, d}]. У базі лишається найкращий результат кожного розділу,
   * а рядок гравця містить суму найкращих очок за всі розділи.
   * need — скільки розділів треба пройти, щоб потрапити в Зал слави (усі розділи гри).
   * Повертає { score, chapters, rank, improved }; rank = null, поки пройдено не все.
   */
  async function submit(items, need) {
    const id = playerId();
    const name = playerName();
    if (!name) throw new Error('не вказано ім\'я');
    const now = Date.now();
    const existing = (await request('GET', `/chapters/${id}`)) || {};
    const best = {};
    Object.keys(existing).forEach((k) => {
      const v = existing[k];
      if (v && typeof v.score === 'number') best[k] = { score: v.score, moves: v.moves || 0 };
    });
    const patch = {};
    let improved = 0;
    items.forEach((it) => {
      const key = 'c' + it.c;
      if (!best[key] || it.score > best[key].score) {
        best[key] = { score: it.score, moves: it.moves };
        patch[key] = { score: it.score, moves: it.moves, d: it.d, t: now };
        improved += 1;
      }
    });
    if (improved > 0) await request('PATCH', `/chapters/${id}`, patch);
    let score = 0, moves = 0, chapters = 0;
    Object.keys(best).forEach((k) => { score += best[k].score; moves += best[k].moves; chapters += 1; });
    await request('PUT', `/players/${id}`, { name, score, moves, chapters, t: now });
    const top = await fetchTop(0, need);
    return { score, chapters, rank: top.myRank, improved };
  }

  /** Топ гравців, які пройшли не менше need розділів (тобто всю гру). limit = 0 — лише місце поточного гравця. */
  async function fetchTop(limit, need) {
    const all = (await request('GET', '/players')) || {};
    const me = playerId();
    const required = Number(need) || 0;
    const everyone = Object.keys(all).map((id) => ({
      id,
      name: String((all[id] && all[id].name) || '?').slice(0, 16),
      score: Number(all[id] && all[id].score) || 0,
      chapters: Number(all[id] && all[id].chapters) || 0,
      t: Number(all[id] && all[id].t) || 0,
    }));
    const mine = everyone.find((r) => r.id === me) || null;
    const rows = everyone.filter((r) => r.chapters >= required).sort((a, b) => b.score - a.score || a.t - b.t);
    const idx = rows.findIndex((r) => r.id === me);
    return {
      top: rows.slice(0, limit === undefined ? 10 : limit),
      myRank: idx >= 0 ? idx + 1 : null,
      myScore: mine ? mine.score : null,
      myChapters: mine ? mine.chapters : 0,
      total: rows.length,
    };
  }

  window.Cloud = { enabled, playerId, playerName, setName, submit, fetchTop };
})();
