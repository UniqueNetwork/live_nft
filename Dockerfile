FROM node:18 as builder

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

FROM node:18-bullseye as publish
WORKDIR /usr/src/app
ENV TZ="UTC"
COPY --from=builder /usr/src/app/package*.json /usr/src/app/
RUN npm ci --production
COPY --from=builder /usr/src/app/files /usr/src/app/files
COPY --from=builder /usr/src/app/dist /usr/src/app/dist

CMD ["node", "dist/index.js", "--cron"]
