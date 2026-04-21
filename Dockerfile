FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

# EXPOSE обязателен для App Platform — указывает платформе, 
# какой порт проксировать через nginx
EXPOSE 3000

CMD ["node", "server.js"]
