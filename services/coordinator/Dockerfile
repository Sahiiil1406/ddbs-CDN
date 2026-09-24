FROM node:20-alpine
WORKDIR /app
COPY services/coordinator/package.json ./services/coordinator/package.json
COPY packages/common/package.json ./packages/common/package.json
RUN npm install --prefix services/coordinator --omit=dev || npm install --prefix services/coordinator
COPY packages/common ./packages/common
COPY services/coordinator ./services/coordinator
EXPOSE 3006
CMD ["node", "services/coordinator/server.js"]
