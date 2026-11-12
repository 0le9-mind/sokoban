/*
 * НАЛАШТУВАННЯ ГРИ. Це єдиний файл, який вам треба відредагувати.
 * Заповніть два рядки нижче (між лапками) і збережіть файл на GitHub.
 */
window.SOKOBAN_CONFIG = {
  // 1) Адреса бази Firebase (Realtime Database). Виглядає приблизно так:
  //    "https://sokoban-12345-default-rtdb.europe-west1.firebasedatabase.app"
  //    Поки порожньо, Зал слави працює лише через бота (на комп'ютері).
  firebaseUrl: "https://sokoban-2023-default-rtdb.europe-west1.firebasedatabase.app/ ",

  // 2) Посилання на вашого Telegram-бота (необов'язково, з'явиться кнопка «Бот» у меню).
  botLink: "https://t.me/@sokoban_ua_bot/play",

  // Назва «папки» в базі, де лежать дані гри. Краще не змінювати.
  dbPath: "sokoban"
};
