FROM node:20-alpine
WORKDIR /app
COPY services/replication/package.json ./services/replication/package.json
COPY packages/common/package.json ./packages/common/package.json
RUN npm install --prefix services/replication --omit=dev || npm install --prefix services/replication
COPY packages/common ./packages/common
COPY services/replication ./services/replication
EXPOSE 3005
CMD ["node", "services/replication/server.js"]
