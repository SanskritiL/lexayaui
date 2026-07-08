FROM node:22-slim

WORKDIR /app

COPY web-service/package.json web-service/package-lock.json* ./
RUN npm install --omit=dev

COPY api/ ./api/
COPY web-service/src/ ./web-service/src/

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "web-service/src/index.js"]
