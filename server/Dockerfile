FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY src ./src
COPY index.js ./index.js

EXPOSE 5000

CMD ["npm", "start"]