FROM node:20-alpine
WORKDIR /app
COPY services/gateway/package.json ./services/gateway/package.json
COPY packages/common/package.json ./packages/common/package.json
RUN npm install --prefix services/gateway --omit=dev || npm install --prefix services/gateway
COPY packages/common ./packages/common
COPY services/gateway ./services/gateway
EXPOSE 3000
CMD ["node", "services/gateway/server.js"]
