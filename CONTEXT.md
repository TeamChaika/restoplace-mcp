# Контекст проекта: ИИ-агент поддержки ресторана

## Что уже сделано

### Агент
- Платформа: Timeweb Cloud AI Agents (no-code, визуальный конструктор)
- Канал: виджет чата на сайте ресторана
- Системный промт: настроен (роль, тон, ограничения, сценарий бронирования)
- База знаний: подключена (меню, режим работы, контакты)

### MCP-сервер (Restoplace)
- Деплой: Timeweb App Platform (из GitHub репозитория через Dockerfile)
- URL сервера: `https://restoplace.chaika.team`
- MCP endpoint: `https://restoplace.chaika.team/mcp`
- Протокол: Streamable HTTP + JSON-RPC 2.0 (официальный SDK `@modelcontextprotocol/sdk`)
- Переменная окружения: `RESTOPLACE_KEY` (задана в панели App Platform)

### Инструменты MCP
- `check_slots(date, guests)` — свободные слоты на дату
- `create_booking(from, to, name, count, phone?, comment?)` — создать бронь
- `cancel_booking(booking_id)` — отменить бронь
- `get_current_date()` — актуальная дата в московском часовом поясе

### Система бронирования
- Сервис: Restoplace (restoplace.cc)
- API: `https://api.restoplace.cc`
- Документация: `https://restoplace.cc/help/api`
- Тариф: PRO+ (обязателен для API)

---

## Что нужно доделать

### 1. Агент не предлагает альтернативы при отсутствии слотов
Вместо "нет столиков — позвоните" агент должен вызывать `check_slots` на соседние дни.
Добавить в промт (секция `# ОБЯЗАТЕЛЬНЫЙ ПОРЯДОК ВЫЗОВА ИНСТРУМЕНТОВ`).

### 3. Проверить реальную работу бронирования
Последние тесты показывали "нет свободных столов" — возможно API возвращает пустой список.
Проверить напрямую: `GET https://api.restoplace.cc/times?date=YYYY-MM-DD&length=120`
с заголовком `X-API-Key: КЛЮЧ`.

---

## Структура server.js

```
server.js               ← основной файл, Node.js ESM
package.json            ← зависимости: @modelcontextprotocol/sdk, express, zod
Dockerfile              ← FROM node:20-alpine, EXPOSE 3000
```

Зависимости:
```json
{
  "@modelcontextprotocol/sdk": "^1.0.4",
  "express": "^4.21.2",
  "zod": "^3.24.1"
}
```

---

## Текущий системный промт агента (краткая структура)

- `# РОЛЬ` — ассистент ресторана {{НАЗВАНИЕ}}
- `# ИСТОЧНИКИ ДАННЫХ` — база знаний + MCP
- `# ТОН И ФОРМАТ` — кратко, без шаблонных фраз
- `# ЧТО ДЕЛАЕТ / НЕ ДЕЛАЕТ` — ограничения и защита от off-topic
- `# ИНСТРУМЕНТЫ БРОНИРОВАНИЯ` — описание check_slots, create_booking, cancel_booking
- `# СЦЕНАРИЙ БРОНИРОВАНИЯ` — 5 шагов, подтверждение обязательно перед create_booking
- `# ОТМЕНА БРОНИ` — запрос ID, подтверждение, cancel_booking
- `# АЛЛЕРГЕНЫ` — только из базы знаний, при серьёзных — к персоналу
- `# ЖАЛОБЫ` — принять, передать менеджеру
- `# ТЕКУЩАЯ ДАТА` — агент должен вызывать `get_current_date` при любых относительных датах

---

## Известные проблемы

| Проблема | Статус | Решение |
|----------|--------|---------|
| Агент использует декабрь вместо реальной даты | ✅ Исправлено | Добавлен инструмент `get_current_date` в server.js |
| При отсутствии слотов — отправляет на сайт, не ищет альтернативы | ❌ Не исправлено | Добавить логику в промт |
| Первая версия сервера (REST) не работала с Timeweb MCP | ✅ Исправлено | Переписан на официальный SDK |

---

## Команды для работы с проектом

```bash
# Локальный запуск
RESTOPLACE_KEY=xxx node server.js

# Деплой (из репозитория — App Platform делает сам при git push)
git add . && git commit -m "fix: add get_current_date" && git push

# Проверка здоровья
curl https://restoplace.chaika.team/health

# Тест MCP инициализации
curl -X POST https://restoplace.chaika.team/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

---

## Полезные ссылки

- Timeweb AI Agents: https://timeweb.cloud/docs/ai-agents
- Timeweb MCP: https://timeweb.cloud/docs/ai-agents/mcp-server
- Restoplace API: https://restoplace.cc/help/api
- MCP спецификация: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- MCP SDK npm: https://www.npmjs.com/package/@modelcontextprotocol/sdk
