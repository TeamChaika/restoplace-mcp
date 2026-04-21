# Исправление: настоящий MCP-сервер

## Что было не так

Прошлый сервер имел самодельный протокол (`GET /tools`, `POST /call`),  
но **стандарт MCP требует JSON-RPC 2.0 по Streamable HTTP** на одном  
endpoint `/mcp`. Timeweb и другие MCP-клиенты работают строго по стандарту.

## Что изменилось

Заменил самодельный REST на официальный SDK `@modelcontextprotocol/sdk`.  
Теперь сервер:

- Использует JSON-RPC 2.0 (не REST)
- Единый endpoint `/mcp` (не `/tools` и `/call`)
- Поддерживает sessionId через заголовок `Mcp-Session-Id`
- Реализует методы `initialize`, `tools/list`, `tools/call` автоматически

## Что делать

1. **Замени файлы в репозитории**:
   - `server.js` (новый, с SDK)
   - `package.json` (добавлены зависимости `@modelcontextprotocol/sdk` и `zod`)
   - `Dockerfile` (без изменений)

2. **Сделай push в Git** — App Platform пересоберёт автоматически:
   ```bash
   git add .
   git commit -m "fix: use proper MCP protocol"
   git push
   ```

3. **В Timeweb** укажи новый URL MCP-сервера:
   ```
   https://restoplace.chaika.team/mcp
   ```
   
   ⚠️ **Важно**: теперь `/mcp`, а не корень `/`.

## Как проверить

После деплоя открой в браузере:

```
https://restoplace.chaika.team/health
https://restoplace.chaika.team/
```

Первый должен вернуть `{"status":"ok"}`, второй — информацию о сервере.

Сам `/mcp` в браузере работать не будет (это JSON-RPC, не REST) — 
и это нормально.

## Тест MCP endpoint через curl

```bash
# Инициализация сессии
curl -X POST https://restoplace.chaika.team/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0"}
    }
  }'
```

Если ответ приходит с `jsonrpc: "2.0"` и `result` — сервер работает.
