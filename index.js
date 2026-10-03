const { Telegraf } = require('telegraf');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.log("BOT_TOKEN missing");
  process.exit(1);
}

const bot = new Telegraf(token);

bot.start((ctx) => {
  ctx.reply('مرحبا! 👋 البوت خدام ✅\nصيفط ليا لينك');
});

bot.on('text', (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  ctx.reply('✅ توصلت باللينك: ' + ctx.message.text);
});

bot.launch().then(() => {
  console.log("✅ Bot started!");
});
