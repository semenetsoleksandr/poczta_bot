import { Telegraf } from 'telegraf';

// Получаем токен из переменных окружения Railway
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Ошибка: Переменная окружения BOT_TOKEN не задана!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Слушаем любые текстовые сообщения
bot.on('text', (ctx) => {
  // ctx.message.text — это текст от пользователя
  // ctx.reply — встроенный метод для отправки ответа в тот же чат
  ctx.reply(ctx.message.text);
});

// Запуск бота
bot.launch()
  .then(() => console.log('JS Эхо-бот успешно запущен...'))
  .catch((err) => console.error('Ошибка запуска бота:', err));

// Правильная остановка бота при выключении контейнера на Railway
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
