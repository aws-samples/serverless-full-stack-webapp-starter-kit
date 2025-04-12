FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY ./ ./
RUN npx prisma generate
RUN npx esbuild src/jobs/*.ts --bundle --outdir=dist --platform=node --charset=utf8 --external:@prisma/client

FROM public.ecr.aws/lambda/nodejs:22 AS runner

COPY package*.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
RUN npx prisma generate --generator client
COPY --from=builder /build/dist/. ./

CMD ["migration-runner.handler"]
