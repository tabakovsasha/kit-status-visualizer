FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY apps/frontend/package*.json ./apps/frontend/
COPY apps/backend/prisma ./apps/backend/prisma
RUN npm install && npm run -w backend prisma:generate

FROM deps AS build
COPY . .
RUN npm run -w backend build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma
USER node
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --schema=apps/backend/prisma/schema.prisma --skip-generate && node apps/backend/dist/src/main.js"]
