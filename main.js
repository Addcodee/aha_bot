require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { DateTime } = require("luxon");

const token = process.env.TELEGRAM_BOT_TOKEN;
const channel = process.env.CHANNEL;
const allowedUsers = process.env.ALLOWED_USERS
  ? process.env.ALLOWED_USERS.split(",").map((id) => Number(id.trim()))
  : [];

const bot = new TelegramBot(token, { polling: true });

const userStates = {};
const scheduledMessages = {};
let scheduledIdCounter = 1;

function isUserAllowed(userId) {
  return allowedUsers.includes(userId);
}

function scheduleMessage(postText, scheduleDate, chatId) {
  const now = new Date();
  const delay = scheduleDate - now;
  if (delay <= 0) {
    bot.sendMessage(chatId, "Выбранное время уже прошло.");
    return;
  }

  const id = scheduledIdCounter++;
  const timerId = setTimeout(() => {
    bot
      .sendMessage(channel, postText)
      .then(() => {
        if (scheduledMessages[chatId]) {
          scheduledMessages[chatId] = scheduledMessages[chatId].filter(
            (item) => item.id !== id
          );
        }
        console.log(`Пост ID ${id} отправлен.`);
      })
      .catch((err) => console.error("Ошибка при отправке поста:", err));
  }, delay);

  if (!scheduledMessages[chatId]) scheduledMessages[chatId] = [];
  scheduledMessages[chatId].push({ id, timerId, scheduleDate, postText });
  return id;
}

bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(msg.chat.id, `Ваш userId: ${msg.from.id}`);
});

bot.onText(/\/schedule/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isUserAllowed(userId)) {
    bot.sendMessage(chatId, "У вас нет прав на планирование сообщений.");
    return;
  }

  bot.sendMessage(chatId, "Введите текст поста:");
  userStates[chatId] = { step: "awaiting_text" };
});

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isUserAllowed(userId)) {
    bot.sendMessage(chatId, "У вас нет прав на просмотр сообщений.");
    return;
  }

  const items = scheduledMessages[chatId];
  if (!items || items.length === 0) {
    bot.sendMessage(chatId, "Нет запланированных сообщений.");
    return;
  }

  const textLines = items.map(
    (item) =>
      `ID: ${item.id}\nДата: ${DateTime.fromJSDate(item.scheduleDate)
        .setZone("Asia/Bishkek")
        .toFormat("yyyy-MM-dd HH:mm")}\nТекст: ${item.postText}`
  );

  const inlineKeyboard = items.map((item) => [
    { text: `Отменить ID: ${item.id}`, callback_data: `cancel_${item.id}` },
  ]);

  bot.sendMessage(
    chatId,
    "Список запланированных сообщений:\n\n" + textLines.join("\n\n"),
    { reply_markup: { inline_keyboard: inlineKeyboard } }
  );
});

bot.on("callback_query", (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const state = userStates[chatId];

  if (data.startsWith("cancel_")) {
    const id = Number(data.split("_")[1]);
    const index = scheduledMessages[chatId]?.findIndex(
      (item) => item.id === id
    );
    if (index >= 0) {
      clearTimeout(scheduledMessages[chatId][index].timerId);
      scheduledMessages[chatId].splice(index, 1);
      bot.sendMessage(chatId, `Сообщение с ID ${id} отменено.`);
    } else {
      bot.sendMessage(chatId, "Сообщение не найдено.");
    }
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (!state) return;

  if (state.step === "awaiting_date" && data.startsWith("date_")) {
    let date = DateTime.now().setZone("Asia/Bishkek");
    if (data === "date_tomorrow") date = date.plus({ days: 1 });
    if (data === "date_day_after") date = date.plus({ days: 2 });
    state.selectedDate = date;
    state.step = "awaiting_time";

    const timeOptions = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "6:00", callback_data: "time_6:00" },
            { text: "12:00", callback_data: "time_12:00" },
            { text: "14:00", callback_data: "time_14:00" },
          ],
          [
            { text: "16:00", callback_data: "time_16:00" },
            { text: "18:00", callback_data: "time_18:00" },
            { text: "20:00", callback_data: "time_20:00" },
          ],
          [{ text: "Задать вручную", callback_data: "time_manual" }],
        ],
      },
    };

    bot.sendMessage(chatId, "Выберите время:", timeOptions);
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (
    state.step === "awaiting_time" &&
    data.startsWith("time_") &&
    data !== "time_manual"
  ) {
    const [hours, minutes] = data.split("_")[1].split(":").map(Number);
    const scheduleDate = state.selectedDate
      .set({ hour: hours, minute: minutes })
      .toJSDate();

    bot.sendMessage(
      chatId,
      `Пост запланирован на ${DateTime.fromJSDate(scheduleDate)
        .setZone("Asia/Bishkek")
        .toFormat("yyyy-MM-dd HH:mm")}`
    );
    scheduleMessage(state.postText, scheduleDate, chatId);
    delete userStates[chatId];
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (state.step === "awaiting_time" && data === "time_manual") {
    state.step = "awaiting_manual_time";
    bot.sendMessage(chatId, "Введите время в формате HH:MM (например, 15:45):");
    bot.answerCallbackQuery(callbackQuery.id);
  }
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!userStates[chatId] || text.startsWith("/")) return;

  const state = userStates[chatId];

  if (state.step === "awaiting_text") {
    state.postText = text;
    state.step = "awaiting_date";
    const dateOptions = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Сегодня", callback_data: "date_today" },
            { text: "Завтра", callback_data: "date_tomorrow" },
            { text: "Послезавтра", callback_data: "date_day_after" },
          ],
        ],
      },
    };
    bot.sendMessage(chatId, "Выберите дату:", dateOptions);
    return;
  }

  if (state.step === "awaiting_manual_time") {
    const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      bot.sendMessage(chatId, "Формат времени неверный. Пример: 15:45");
      return;
    }

    const [hours, minutes] = match.slice(1).map(Number);
    const scheduleDate = state.selectedDate
      .set({ hour: hours, minute: minutes })
      .toJSDate();

    bot.sendMessage(
      chatId,
      `Пост запланирован на ${DateTime.fromJSDate(scheduleDate)
        .setZone("Asia/Bishkek")
        .toFormat("yyyy-MM-dd HH:mm")}`
    );
    scheduleMessage(state.postText, scheduleDate, chatId);
    delete userStates[chatId];
  }
});
