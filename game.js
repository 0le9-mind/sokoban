/*
 * Ігрова логіка «Сокобана» — без жодного відношення до відображення.
 *
 * Символи на карті рівня:
 *   #  стіна      (пробіл) підлога   .  ціль
 *   $  ящик       *  ящик на цілі
 *   @  гравець    +  гравець на цілі
 *
 * Ходи записуються рядком із літер U/D/L/R (вгору/вниз/вліво/вправо).
 * Записуються лише «справжні» ходи — той самий запис сервер програє заново,
 * щоб перевірити результат (див. backend/game_logic.py).
 */
(function (global) {
  'use strict';

  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

  class SokobanGame {
    constructor(rows) {
      this.rows = rows;
      this.height = rows.length;
      this.width = Math.max.apply(null, rows.map((r) => r.length));
      this._parse();
      this.reset();
    }

    _key(x, y) {
      return y * this.width + x;
    }

    _parse() {
      this.walls = new Set();
      this.goals = new Set();
      this.startBoxes = [];
      this.start = null;
      this.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === '#') this.walls.add(this._key(x, y));
          if (ch === '.' || ch === '*' || ch === '+') this.goals.add(this._key(x, y));
          if (ch === '$' || ch === '*') this.startBoxes.push(this._key(x, y));
          if (ch === '@' || ch === '+') this.start = { x, y };
        }
      });
      this._computeFloor();
    }

    /** Клітинки, до яких гравець може дійти (для малювання підлоги лише всередині кімнати). */
    _computeFloor() {
      this.floor = new Set();
      const queue = [this.start];
      this.floor.add(this._key(this.start.x, this.start.y));
      while (queue.length) {
        const { x, y } = queue.pop();
        Object.values(DIRS).forEach(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) return;
          const k = this._key(nx, ny);
          if (this.walls.has(k) || this.floor.has(k)) return;
          this.floor.add(k);
          queue.push({ x: nx, y: ny });
        });
      }
    }

    /** Починає рівень спочатку. */
    reset() {
      this.player = { x: this.start.x, y: this.start.y };
      this.boxes = new Set(this.startBoxes);
      this.moves = ''; // записані ходи
      this.pushes = 0; // скільки разів штовхнули ящик
      this.pushedFlags = []; // для кожного ходу: чи штовхали ящик (потрібно для «кроку назад»)
    }

    isWall(x, y) {
      return x < 0 || y < 0 || x >= this.width || y >= this.height || this.walls.has(this._key(x, y));
    }

    hasBox(x, y) {
      return this.boxes.has(this._key(x, y));
    }

    isGoal(x, y) {
      return this.goals.has(this._key(x, y));
    }

    isFloor(x, y) {
      return this.floor.has(this._key(x, y));
    }

    /**
     * Спроба зробити хід. Повертає { moved, pushed }.
     * Правила: ящик можна лише штовхати; за раз — один ящик;
     * ящик не проходить крізь стіну чи інший ящик.
     */
    move(dir) {
      const d = DIRS[dir];
      if (!d) return { moved: false, pushed: false };
      const nx = this.player.x + d[0];
      const ny = this.player.y + d[1];
      if (this.isWall(nx, ny)) return { moved: false, pushed: false };

      let pushed = false;
      if (this.hasBox(nx, ny)) {
        const bx = nx + d[0];
        const by = ny + d[1];
        if (this.isWall(bx, by) || this.hasBox(bx, by)) return { moved: false, pushed: false };
        this.boxes.delete(this._key(nx, ny));
        this.boxes.add(this._key(bx, by));
        this.pushes += 1;
        pushed = true;
      }
      this.player.x = nx;
      this.player.y = ny;
      this.moves += dir;
      this.pushedFlags.push(pushed);
      return { moved: true, pushed };
    }

    /** Чи є що скасовувати. */
    canUndo() {
      return this.moves.length > 0;
    }

    /**
     * «Крок назад»: скасовує останній хід (і повертає ящик, якщо його штовхали).
     * Скасований хід видаляється із запису, тож у результат потрапляє лише
     * фактичний шлях до розв'язку — сервер перевірить саме його.
     * Повертає true, якщо хід було скасовано.
     */
    undo() {
      if (!this.canUndo()) return false;
      const dir = this.moves[this.moves.length - 1];
      const d = DIRS[dir];
      const wasPushed = this.pushedFlags.pop();
      if (wasPushed) {
        // Ящик стояв перед гравцем (там, куди той тепер дійшов) — повертаємо його назад
        const boxFrom = this._key(this.player.x + d[0], this.player.y + d[1]);
        const boxTo = this._key(this.player.x, this.player.y);
        this.boxes.delete(boxFrom);
        this.boxes.add(boxTo);
        this.pushes -= 1;
      }
      this.player.x -= d[0];
      this.player.y -= d[1];
      this.moves = this.moves.slice(0, -1);
      return true;
    }

    /** Рівень пройдено, коли кожен ящик стоїть на цілі. */
    isSolved() {
      for (const k of this.boxes) {
        if (!this.goals.has(k)) return false;
      }
      return true;
    }
  }

  global.SokobanGame = SokobanGame;
  if (typeof module !== 'undefined' && module.exports) module.exports = SokobanGame;
})(typeof window !== 'undefined' ? window : globalThis);
