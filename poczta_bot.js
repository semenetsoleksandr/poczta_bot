const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Команда /start
bot.start((ctx) => {
    ctx.reply('Привет! Я echo bot 🚀');
});

// Эхо всех сообщений
bot.on('text', (ctx) => {
    ctx.reply(ctx.message.text);
});

// Запуск бота
bot.launch();

console.log('BOT STARTED');

// Корректное завершение
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
