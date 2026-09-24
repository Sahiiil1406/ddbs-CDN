FROM node:20-alpine
WORKDIR /app
COPY services/origin/package.json ./services/origin/package.json
COPY packages/common/package.json ./packages/common/package.json
RUN npm install --prefix services/origin --omit=dev || npm install --prefix services/origin
COPY packages/common ./packages/common
COPY services/origin ./services/origin
ENV PORT=3001
EXPOSE 3001
CMD ["node", "services/origin/server.js"]
