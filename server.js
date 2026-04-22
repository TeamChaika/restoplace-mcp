import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';

const API_KEY = process.env.RESTOPLACE_KEY;
const BASE_URL = 'https://api.restoplace.cc';

// booking_number → booking_id mapping (survives within one server process)
const bookingMap = new Map();

if (!API_KEY) {
  console.error('RESTOPLACE_KEY не задан в переменных окружения');
  process.exit(1);
}

// ─── Telegram-уведомления ────────────────────────────────────────────────
async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[Telegram] Ошибка API:', JSON.stringify(data));
    } else {
      console.log('[Telegram] Сообщение отправлено');
    }
  } catch (e) {
    console.error('[Telegram] Ошибка сети:', e.message);
  }
}

// ─── Хелпер для запросов к Restoplace ───────────────────────────────────
async function restoplace(method, path, body = null) {
  console.log(`[Restoplace] ${method} ${path}`, body || '');
  const options = {
    method,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  console.log(`[Restoplace] Response:`, JSON.stringify(data).slice(0, 500));
  return data;
}
// ─── Создаём MCP-сервер ─────────────────────────────────────────────────
function createServer() {
  const server = new McpServer({
    name: 'restoplace-booking',
    version: '1.0.0',
  });

  // Инструмент 1: проверка свободных слотов
  server.registerTool(
    'check_slots',
    {
      title: 'Проверить свободные слоты',
      description:
        'Проверить свободные временные слоты для бронирования столика на указанную дату и количество гостей. Вызывай перед созданием брони.',
      inputSchema: {
        date: z.string().describe('Дата в формате YYYY-MM-DD, например 2024-12-25'),
        guests: z.number().int().describe('Количество гостей (от 1 до 20)'),
      },
    },
    async ({ date, guests }) => {
      const data = await restoplace('GET', `/times?date=${date}&length=120`);

      if (data.error) {
        return {
          content: [{ type: 'text', text: `Ошибка: ${data.error}` }],
          isError: true,
        };
      }

      const freeSlots = (data.responseData || [])
        .filter((slot) => {
          const countKey = String(guests);
          return slot.free && slot.counts?.[countKey] === 'free';
        })
        .slice(0, 8)
        .map((slot) => ({ from: slot.from, to: slot.to }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              date,
              guests,
              available_slots: freeSlots,
              total_found: freeSlots.length,
            }, null, 2),
          },
        ],
      };
    }
  );

  // Инструмент 2: создание брони
  server.registerTool(
    'create_booking',
    {
      title: 'Создать бронь',
      description:
        'Создать бронь столика. Вызывай ТОЛЬКО после явного подтверждения гостем всех данных.',
      inputSchema: {
        from: z.string().describe('Начало брони: 2024-12-25 19:00:00'),
        to: z.string().describe('Конец брони: 2024-12-25 21:00:00'),
        name: z.string().describe('Имя гостя'),
        phone: z.string().optional().describe('Телефон гостя, например 79991234567'),
        count: z.number().int().describe('Количество гостей'),
        comment: z.string().optional().describe('Комментарий к брони'),
      },
    },
    async ({ from, to, name, phone, count, comment }) => {
      const body = { from, to, name, count, source: 'chatbot' };
      if (phone) body.phone = phone;
      if (comment) body.text = comment;

      const data = await restoplace('POST', '/reserves', body);

      if (data.error) {
        await sendTelegram(
          `❌ <b>Ошибка бронирования</b>\n` +
          `👤 ${name}${phone ? '\n📞 ' + phone : ''}\n` +
          `📅 ${from}\n` +
          `👥 ${count} гост.${comment ? '\n💬 ' + comment : ''}\n` +
          `⚠️ ${data.error}`
        );
        return {
          content: [{ type: 'text', text: `Ошибка: ${data.error}` }],
          isError: true,
        };
      }

      const result = {
        success: true,
        booking_id: data.responseData?.id,
        booking_number: data.responseData?.number,
        message: data.responseData?.message,
        payment_needed: data.responseData?.paymentNeed || false,
        payment_link: data.responseData?.paymentLink || null,
      };

      if (result.booking_number && result.booking_id) {
        bookingMap.set(String(result.booking_number), String(result.booking_id));
      }

      await sendTelegram(
        `✅ <b>Новое бронирование #${result.booking_number}</b>\n` +
        `👤 ${name}${phone ? '\n📞 ' + phone : ''}\n` +
        `📅 ${from} – ${to.slice(11, 16)}\n` +
        `👥 ${count} гост.${comment ? '\n💬 ' + comment : ''}`
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Инструмент 3: отмена брони
  server.registerTool(
    'cancel_booking',
    {
      title: 'Отменить бронь',
      description: 'Отменить существующую бронь по её ID.',
      inputSchema: {
        booking_id: z.string().describe('ID брони для отмены'),
      },
    },
    async ({ booking_id }) => {
      const resolvedId = bookingMap.get(String(booking_id)) ?? booking_id;
      const data = await restoplace('PUT', `/reserves/${resolvedId}/status`, {
        status: 5,
        cancel_reason: 3,
      });

      if (data.error) {
        return {
          content: [{ type: 'text', text: `Ошибка: ${data.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: 'Бронь успешно отменена' }],
      };
    }
  );

  // Инструмент 4: текущая дата
  server.registerTool(
    'get_current_date',
    {
      title: 'Получить текущую дату',
      description:
        'Получить актуальную сегодняшнюю дату в часовом поясе ресторана. Вызывай ВСЕГДА, когда гость говорит относительные даты: "сегодня", "завтра", "в пятницу", "на выходных", "через неделю".',
      inputSchema: {},
    },
    async () => {
      const now = new Date();
      const moscow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));

      const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
      const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

      const fmt = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return { date: `${y}-${m}-${day}`, readable: `${d.getDate()} ${months[d.getMonth()]} ${y}`, day_of_week: days[d.getDay()] };
      };

      const t1 = new Date(moscow); t1.setDate(moscow.getDate() + 1);
      const t2 = new Date(moscow); t2.setDate(moscow.getDate() + 2);
      const t3 = new Date(moscow); t3.setDate(moscow.getDate() + 3);
      const t7 = new Date(moscow); t7.setDate(moscow.getDate() + 7);

      const todayFmt = fmt(moscow);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            today: todayFmt.date,
            year: moscow.getFullYear(),
            day_of_week: todayFmt.day_of_week,
            readable: todayFmt.readable,
            timezone: 'Europe/Moscow',
            ВАЖНО: `Текущий год — ${moscow.getFullYear()}. Используй СТРОГО эти даты, не считай самостоятельно.`,
            готовые_даты: {
              сегодня: fmt(moscow),
              завтра: fmt(t1),
              послезавтра: fmt(t2),
              через_3_дня: fmt(t3),
              через_неделю: fmt(t7),
            },
          }, null, 2),
        }],
      };
    }
  );

  return server;
}
// ─── Настройка Express с Streamable HTTP транспортом ────────────────────
const app = express();
app.use(express.json());

// Хранилище транспортов по sessionId
const transports = {};

// Основной MCP endpoint — принимает POST, GET, DELETE на одном URL
app.all('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports[sessionId]) {
      // Существующая сессия
      transport = transports[sessionId];
    } else if (req.method === 'POST' && !sessionId) {
      // Новая сессия — создаём транспорт
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport;
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      const server = createServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid session' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Ошибка обработки запроса:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      });
    }
  }
});

// Healthcheck для диагностики
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Главная страница
app.get('/', (req, res) => {
  res.json({
    name: 'restoplace-mcp',
    version: '1.0.0',
    endpoint: '/mcp',
    transport: 'streamable-http',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP сервер запущен на порту ${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/mcp`);
});
