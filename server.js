import express from 'express';

const app = express();
app.use(express.json());

const API_KEY = process.env.RESTOPLACE_KEY;
const BASE_URL = 'https://api.restoplace.cc';

if (!API_KEY) {
  console.error('RESTOPLACE_KEY не задан в переменных окружения');
  process.exit(1);
}

// Хелпер для запросов к Restoplace
async function restoplace(method, path, body = null) {
  const options = {
    method,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, options);
  return res.json();
}

// ─── MCP: список инструментов ───────────────────────────────────────────────
app.get('/tools', (req, res) => {
  res.json({
    tools: [
      {
        name: 'check_slots',
        description:
          'Проверить свободные временные слоты для бронирования столика на указанную дату и количество гостей. Вызывай перед созданием брони.',
        parameters: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Дата в формате YYYY-MM-DD, например 2024-12-25',
            },
            guests: {
              type: 'integer',
              description: 'Количество гостей (от 1 до 20)',
            },
          },
          required: ['date', 'guests'],
        },
      },
      {
        name: 'create_booking',
        description:
          'Создать бронь столика. Вызывай ТОЛЬКО после того, как гость явно подтвердил все данные.',
        parameters: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'Начало брони, формат: 2024-12-25 19:00:00',
            },
            to: {
              type: 'string',
              description: 'Конец брони, формат: 2024-12-25 21:00:00',
            },
            name: {
              type: 'string',
              description: 'Имя гостя',
            },
            phone: {
              type: 'string',
              description: 'Телефон гостя, например 79991234567',
            },
            count: {
              type: 'integer',
              description: 'Количество гостей',
            },
            comment: {
              type: 'string',
              description: 'Комментарий к брони (день рождения, аллергии и т.д.)',
            },
          },
          required: ['from', 'to', 'name', 'count'],
        },
      },
      {
        name: 'cancel_booking',
        description: 'Отменить существующую бронь по её ID.',
        parameters: {
          type: 'object',
          properties: {
            booking_id: {
              type: 'string',
              description: 'ID брони, которую нужно отменить',
            },
          },
          required: ['booking_id'],
        },
      },
    ],
  });
});

// ─── MCP: вызов инструмента ─────────────────────────────────────────────────
app.post('/call', async (req, res) => {
  const { tool, parameters } = req.body;

  try {
    // check_slots — свободные слоты
    if (tool === 'check_slots') {
      const { date, guests } = parameters;

      const data = await restoplace('GET', `/times?date=${date}&length=120`);

      if (data.error) {
        return res.json({ result: { error: data.error } });
      }

      const freeSlots = (data.responseData || [])
        .filter((slot) => {
          const countKey = String(guests);
          return slot.free && slot.counts?.[countKey] === 'free';
        })
        .slice(0, 8)
        .map((slot) => ({ from: slot.from, to: slot.to }));

      return res.json({
        result: {
          date,
          guests,
          available_slots: freeSlots,
          total_found: freeSlots.length,
        },
      });
    }

    // create_booking — создать бронь
    if (tool === 'create_booking') {
      const { from, to, name, phone, count, comment } = parameters;

      const body = {
        from,
        to,
        name,
        count,
        source: 'chatbot',
      };
      if (phone) body.phone = phone;
      if (comment) body.text = comment;

      const data = await restoplace('POST', '/reserves', body);

      if (data.error) {
        return res.json({ result: { success: false, error: data.error } });
      }

      return res.json({
        result: {
          success: true,
          booking_id: data.responseData?.id,
          booking_number: data.responseData?.number,
          message: data.responseData?.message,
          payment_needed: data.responseData?.paymentNeed || false,
          payment_link: data.responseData?.paymentLink || null,
        },
      });
    }

    // cancel_booking — отменить бронь
    if (tool === 'cancel_booking') {
      const { booking_id } = parameters;

      const data = await restoplace('PUT', `/reserves/${booking_id}/status`, {
        status: 5,
        cancel_reason: 3,
      });

      if (data.error) {
        return res.json({ result: { success: false, error: data.error } });
      }

      return res.json({
        result: {
          success: true,
          message: 'Бронь успешно отменена',
        },
      });
    }

    return res.status(404).json({ error: `Инструмент "${tool}" не найден` });

  } catch (err) {
    console.error('Ошибка при вызове инструмента:', err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP сервер запущен на порту ${PORT}`);
});
