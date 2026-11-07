/*
 * Звуки гри — створюються кодом (Web Audio), окремих аудіофайлів немає.
 * Звук вмикається після першого дотику до екрана (так вимагають браузери й Telegram).
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'sokoban_sound';
  let ctx = null;
  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (e) { /* без збереження налаштування */ }

  function audio() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Один «тон»: частота може плавно змінюватись від freq до slideTo. */
  function tone(c, freq, start, dur, type, vol, slideTo) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  /** Короткий «шурхіт» (шум через фільтр) — звук тертя ящика по підлозі. */
  function scrape(c, start, dur, vol, freq) {
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.9;
    const gain = c.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(start);
  }

  const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568 };

  const Sfx = {
    /** Викликати при першому дотику: «розбуджує» звук на телефоні. */
    unlock() { audio(); },

    /** Ящик посунули. */
    push() {
      const c = audio(); if (!c) return;
      const t = c.currentTime;
      scrape(c, t, 0.11, 0.35, 600);
      tone(c, 110, t, 0.12, 'sine', 0.35, 62);
    },

    /** Ящик доїхав до лимона. */
    goalIn() {
      const c = audio(); if (!c) return;
      const t = c.currentTime;
      scrape(c, t, 0.07, 0.2, 700);
      tone(c, NOTE.E5, t + 0.05, 0.14, 'triangle', 0.3);
      tone(c, NOTE.A5, t + 0.15, 0.22, 'triangle', 0.3);
    },

    undo() {
      const c = audio(); if (!c) return;
      tone(c, 520, c.currentTime, 0.08, 'square', 0.07, 340);
    },

    restart() {
      const c = audio(); if (!c) return;
      const t = c.currentTime;
      tone(c, 380, t, 0.1, 'square', 0.07, 200);
      tone(c, 260, t + 0.1, 0.12, 'square', 0.07, 130);
    },

    click() {
      const c = audio(); if (!c) return;
      tone(c, 700, c.currentTime, 0.04, 'square', 0.05);
    },

    /** Рівень пройдено: короткий радісний пасаж. */
    level() {
      const c = audio(); if (!c) return;
      const t = c.currentTime + 0.18;
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => {
        tone(c, f, t + i * 0.1, 0.18, 'square', 0.09);
        tone(c, f, t + i * 0.1, 0.18, 'triangle', 0.16);
      });
    },

    /** Усі рівні пройдено: урочиста фанфара. */
    win() {
      const c = audio(); if (!c) return;
      const t = c.currentTime + 0.2;
      const melody = [
        [NOTE.C5, 0, 0.14], [NOTE.E5, 0.14, 0.14], [NOTE.G5, 0.28, 0.14], [NOTE.C6, 0.42, 0.28],
        [NOTE.G5, 0.78, 0.14], [NOTE.C6, 0.92, 0.14], [NOTE.E6, 1.06, 0.5],
        [NOTE.D5, 1.7, 0.14], [NOTE.G5, 1.84, 0.14], [NOTE.B5, 1.98, 0.14], [NOTE.G6, 2.12, 0.9],
      ];
      melody.forEach(([f, off, d]) => {
        tone(c, f, t + off, d + 0.1, 'square', 0.08);
        tone(c, f, t + off, d + 0.1, 'triangle', 0.18);
      });
      // підсилюючий акорд наприкінці
      [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f) => tone(c, f, t + 2.12, 1.0, 'triangle', 0.12));
    },

    isEnabled() { return enabled; },

    setEnabled(value) {
      enabled = Boolean(value);
      try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (e) { /* нічого */ }
      if (enabled) this.click();
    },
  };

  global.Sfx = Sfx;
})(window);
