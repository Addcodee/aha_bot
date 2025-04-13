require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
// const cron = require("node-cron"); // Для периодической проверки запланированных задач

// Токен бота, который получили от BotFather
const token = process.env.TELEGRAM_BOT_TOKEN;
const channel = process.env.CHANNEL;

// Инициализация бота (polling для обработки сообщений и callback-запросов)
const bot = new TelegramBot(token, { polling: true });

// Список разрешённых пользователей (ID можно узнать, например, через console.log(msg))
const allowedUsers = process.env.ALLOWED_USERS
  ? process.env.ALLOWED_USERS.split(",").map((id) => Number(id.trim()))
  : []; // замените на реальные ID пользователей

// Хранение состояний пользователей для диалога по планированию (по chatId)
const userStates = {};

// Хранение запланированных сообщений для каждого chatId
const scheduledMessages = {};
let scheduledIdCounter = 1;

/**
 * Функция для планирования отправки сообщения через setTimeout.
 * Добавляет в список scheduledMessages соответствующий объект.
 */
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
        console.log(`Пост (id: ${id}) успешно отправлен`);
        if (scheduledMessages[chatId]) {
          scheduledMessages[chatId] = scheduledMessages[chatId].filter(
            (item) => item.id !== id
          );
        }
      })
      .catch((err) => console.error("Ошибка при отправке поста:", err));
  }, delay);

  if (!scheduledMessages[chatId]) {
    scheduledMessages[chatId] = [];
  }

  scheduledMessages[chatId].push({
    id,
    timerId,
    scheduleDate,
    postText,
  });

  return id;
}

// Проверка наличия пользователя в списке разрешённых
function isUserAllowed(userId) {
  return allowedUsers.includes(userId);
}

// Команда для начала планирования поста
bot.onText(/\/schedule/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Если пользователь не разрешён, отправляем сообщение об отказе
  if (!isUserAllowed(userId)) {
    bot.sendMessage(
      chatId,
      "Извините, у вас нет прав на планирование сообщений."
    );
    return;
  }

  bot.sendMessage(chatId, "Введите текст поста, который нужно запланировать:");
  userStates[chatId] = { step: "awaiting_text" };
});

// Команда для вывода списка запланированных сообщений
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Ограничение: выводим список только разрешённым пользователям
  if (!isUserAllowed(userId)) {
    bot.sendMessage(
      chatId,
      "Извините, у вас нет прав на просмотр запланированных сообщений."
    );
    return;
  }

  const items = scheduledMessages[chatId];
  if (!items || items.length === 0) {
    bot.sendMessage(chatId, "Нет запланированных сообщений.");
    return;
  }

  const textLines = items.map(
    (item) =>
      `ID: ${item.id} \nДата: ${item.scheduleDate.toLocaleString()} \nТекст: ${
        item.postText
      }`
  );

  const inlineKeyboard = items.map((item) => [
    { text: `Отменить ID: ${item.id}`, callback_data: `cancel_${item.id}` },
  ]);

  bot.sendMessage(
    chatId,
    "Список запланированных сообщений:\n\n" + textLines.join("\n\n"),
    { reply_markup: { inline_keyboard } }
  );
});

// Команда для отмены сообщения (/cancel доступна через callback_inline кнопки, обработка ниже)
// Если нужна отдельная команда, можно добавить ещё обработку, аналогичную /list.

/* Обработка callback-запросов (отмена, выбор даты/времени и т.д.) */
bot.on("callback_query", (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  // Обработка отмены по кнопке: callback_data вида "cancel_{id}"
  if (data.startsWith("cancel_")) {
    const idToCancel = Number(data.split("_")[1]);
    if (scheduledMessages[chatId]) {
      const msgIndex = scheduledMessages[chatId].findIndex(
        (item) => item.id === idToCancel
      );
      if (msgIndex >= 0) {
        const [cancelled] = scheduledMessages[chatId].splice(msgIndex, 1);
        clearTimeout(cancelled.timerId);
        bot.sendMessage(
          chatId,
          `Запланированное сообщение с ID ${idToCancel} отменено.`
        );
      } else {
        bot.sendMessage(chatId, "Сообщение с указанным ID не найдено.");
      }
    } else {
      bot.sendMessage(chatId, "Нет запланированных сообщений.");
    }
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  // Здесь может идти обработка других callback-данных (выбор даты и времени, ручной ввод и т.д.)
  const state = userStates[chatId];
  if (!state) return;

  if (state.step === "awaiting_date" && data.startsWith("date_")) {
    let selectedDate = new Date();
    if (data === "date_today") {
      // текущая дата
    } else if (data === "date_tomorrow") {
      selectedDate.setDate(selectedDate.getDate() + 1);
    } else if (data === "date_day_after") {
      selectedDate.setDate(selectedDate.getDate() + 2);
    }
    state.selectedDate = selectedDate;
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

    bot.sendMessage(chatId, "Выберите время для отправки поста:", timeOptions);
    bot.answerCallbackQuery(callbackQuery.id, { text: "Дата выбрана" });
    return;
  }

  if (
    state.step === "awaiting_time" &&
    data.startsWith("time_") &&
    data !== "time_manual"
  ) {
    const timeStr = data.split("_")[1];
    const [hours, minutes] = timeStr.split(":").map(Number);
    const scheduleDate = new Date(state.selectedDate);
    scheduleDate.setHours(hours, minutes, 0, 0);

    bot.sendMessage(
      chatId,
      `Пост запланирован на ${scheduleDate.toLocaleString()}`
    );
    scheduleMessage(state.postText, scheduleDate, chatId);
    delete userStates[chatId];
    bot.answerCallbackQuery(callbackQuery.id, { text: "Время выбрано" });
    return;
  }

  if (state.step === "awaiting_time" && data === "time_manual") {
    state.step = "awaiting_manual_time";
    bot.sendMessage(chatId, "Введите время в формате HH:MM (например, 15:45):");
    bot.answerCallbackQuery(callbackQuery.id, {
      text: "Введите время вручную",
    });
    return;
  }
});

// Обработка текстовых сообщений для этапа ручного ввода времени
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!userStates[chatId] || msg.text.startsWith("/")) return;

  const state = userStates[chatId];

  if (state.step === "awaiting_text") {
    state.postText = msg.text;
    state.step = "awaiting_date";
    const options = {
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
    bot.sendMessage(chatId, "Выберите дату для отправки поста:", options);
    return;
  }

  if (state.step === "awaiting_manual_time") {
    const timeInput = msg.text;
    const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timePattern.test(timeInput)) {
      bot.sendMessage(
        chatId,
        "Неверный формат времени. Введите время в формате HH:MM (например, 15:45)."
      );
      return;
    }
    const [hours, minutes] = timeInput.split(":").map(Number);
    const scheduleDate = new Date(state.selectedDate);
    scheduleDate.setHours(hours, minutes, 0, 0);
    bot.sendMessage(
      chatId,
      `Пост запланирован на ${scheduleDate.toLocaleString()}`
    );
    scheduleMessage(state.postText, scheduleDate, chatId);
    delete userStates[chatId];
    return;
  }
});
