FROM node:20-alpine
WORKDIR /app
COPY services/edge/package.json ./services/edge/package.json
COPY packages/common/package.json ./packages/common/package.json
RUN npm install --prefix services/edge --omit=dev || npm install --prefix services/edge
COPY packages/common ./packages/common
COPY services/edge ./services/edge
EXPOSE 3002
CMD ["node", "services/edge/server.js"]
