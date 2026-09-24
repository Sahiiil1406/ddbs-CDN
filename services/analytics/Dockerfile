FROM node:20-alpine
WORKDIR /app
COPY services/analytics/package.json ./services/analytics/package.json
COPY packages/common/package.json ./packages/common/package.json
RUN npm install --prefix services/analytics --omit=dev || npm install --prefix services/analytics
COPY packages/common ./packages/common
COPY services/analytics ./services/analytics
EXPOSE 3007
CMD ["node", "services/analytics/server.js"]
