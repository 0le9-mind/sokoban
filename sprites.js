/*
 * Піксельні спрайти 16×16, намальовані кодом (без зовнішніх картинок).
 * Кожен спрайт малюється один раз на маленькому canvas, а потім
 * масштабується без згладжування — так зберігається «піксельний» вигляд.
 *
 * Палітра (рожеві стіни, світло-коричневі ящики, цілі-лимони, темно-синя підлога) легко змінюється нижче.
 */
(function (global) {
  'use strict';

  const SIZE = 16;

  const COLORS = {
    // Підлога — глибокий темно-синій
    floor: '#0b1030',
    floorDot: '#141c55',
    floorEdge: '#080c26',
    // Рожева цегла
    brick: '#f45da0',
    brickLight: '#ff8fc2',
    brickDark: '#c13878',
    mortar: '#6b1a45',
    // Світло-коричневі дерев'яні ящики
    boxEdge: '#2e1a0a',
    boxBody: '#d9a566',
    boxPanel: '#b98348',
    boxDark: '#6e4620',
    boxLight: '#f0cf9a',
    // Ящик на цілі — лимонно-жовтий
    boxDoneBody: '#fff44f',
    boxDonePanel: '#e8d900',
    boxDoneDark: '#8a7c00',
    boxDoneLight: '#fffcb8',
    // Ціль — лимонно-жовта
    goal: '#fff44f',
    // Гравець
    hat: '#35e0ff',
    skin: '#ffd6a5',
    shirt: '#ffe14d',
    pants: '#3a6bff',
    boots: '#1b1f4a',
    eye: '#10123a',
  };


  // Піксельний лимон 16×16: O — контур, Y/M/S/D — від світлого до темного, H — блик, P — пори шкірки
  const LEMON = [
    '................',
    '................',
    '................',
    '......OOOOOOO...',
    '....OOYPYYPMMO..',
    '...OYYYYYMMMMSOO',
    '..OYHHYPMMPSSPSO',
    '.OYPHYPMMPSSPDO.',
    '.OYYMMMMSSSSDDO.',
    '.OYPMMPSSPDDDDO.',
    'OMPMMPSSPDDDDO..',
    'OOMMSSSDDDDDO...',
    '..OSSPDDDDOO....',
    '...OOOOOOO......',
    '................',
    '................',
  ];
  const LEMON_COLORS = { O: '#a38300', Y: '#fff75e', M: '#ffee2e', S: '#f7d800', D: '#e6bf00', H: '#ffffd0', P: '#dcb900' };

  function rect(ctx, color, x, y, w, h) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  const painters = {
    floor(ctx) {
      rect(ctx, COLORS.floor, 0, 0, SIZE, SIZE);
      rect(ctx, COLORS.floorDot, 3, 3, 2, 2);
      rect(ctx, COLORS.floorDot, 11, 11, 2, 2);
      rect(ctx, COLORS.floorEdge, 0, SIZE - 1, SIZE, 1);
      rect(ctx, COLORS.floorEdge, SIZE - 1, 0, 1, SIZE);
    },

    // Цегляна стіна: 4 ряди цеглин по 4 пікселі заввишки, ряди зміщені
    wall(ctx) {
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        rect(ctx, COLORS.brick, 0, y, SIZE, 3);
        rect(ctx, COLORS.brickLight, 0, y, SIZE, 1);
        rect(ctx, COLORS.brickDark, 0, y + 2, SIZE, 1);
        rect(ctx, COLORS.mortar, 0, y + 3, SIZE, 1);
        const offset = row % 2 === 0 ? 7 : 3;
        rect(ctx, COLORS.mortar, offset, y, 1, 4);
        rect(ctx, COLORS.mortar, offset + 8, y, 1, 4);
      }
    },

    // Ціль — лимон: жовтий плід із носиками, шкіркою-текстурою та бліком
    goal(ctx) {
      painters.floor(ctx);
      LEMON.forEach((row, y) => {
        for (let x = 0; x < SIZE; x++) {
          const color = LEMON_COLORS[row[x]];
          if (color) rect(ctx, color, x, y, 1, 1);
        }
      });
    },

    box(ctx, done) {
      const body = done ? COLORS.boxDoneBody : COLORS.boxBody;
      const panel = done ? COLORS.boxDonePanel : COLORS.boxPanel;
      const dark = done ? COLORS.boxDoneDark : COLORS.boxDark;
      const light = done ? COLORS.boxDoneLight : COLORS.boxLight;
      if (done) rect(ctx, COLORS.goal, 0, 0, SIZE, SIZE); // жовта рамка «на місці»
      rect(ctx, COLORS.boxEdge, 1, 1, 14, 14);
      rect(ctx, dark, 1, 1, 14, 14);
      rect(ctx, body, 2, 2, 12, 12);
      rect(ctx, panel, 4, 4, 8, 8);
      for (let i = 0; i < 8; i++) {
        rect(ctx, dark, 4 + i, 4 + i, 1, 1);
        rect(ctx, dark, 11 - i, 4 + i, 1, 1);
      }
      rect(ctx, light, 2, 2, 12, 1);
      rect(ctx, light, 2, 2, 1, 12);
    },

    player(ctx) {
      // тінь
      rect(ctx, 'rgba(0,0,0,0.35)', 4, 14, 8, 2);
      // шапка
      rect(ctx, COLORS.hat, 4, 1, 8, 2);
      rect(ctx, COLORS.hat, 3, 3, 10, 1);
      // обличчя
      rect(ctx, COLORS.skin, 5, 4, 6, 4);
      rect(ctx, COLORS.eye, 6, 5, 1, 2);
      rect(ctx, COLORS.eye, 9, 5, 1, 2);
      // тулуб та руки
      rect(ctx, COLORS.shirt, 4, 8, 8, 4);
      rect(ctx, COLORS.skin, 3, 8, 1, 3);
      rect(ctx, COLORS.skin, 12, 8, 1, 3);
      // ноги та черевики
      rect(ctx, COLORS.pants, 5, 12, 2, 2);
      rect(ctx, COLORS.pants, 9, 12, 2, 2);
      rect(ctx, COLORS.boots, 4, 14, 3, 1);
      rect(ctx, COLORS.boots, 9, 14, 3, 1);
    },
  };

  const cache = {};

  function build(name) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (name === 'boxDone') painters.box(ctx, true);
    else if (name === 'box') painters.box(ctx, false);
    else painters[name](ctx);
    return canvas;
  }

  /** Малює спрайт `name` у квадрат size×size із верхнім лівим кутом (x, y). */
  function draw(ctx, name, x, y, size) {
    if (!cache[name]) cache[name] = build(name);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cache[name], x, y, size, size);
  }

  global.Sprites = { draw, SIZE };
})(window);
