FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/async-job/package.json apps/async-job/
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate && pnpm install --frozen-lockfile
COPY packages/ packages/
COPY apps/async-job/ apps/async-job/
RUN pnpm exec esbuild apps/async-job/src/handler.ts --bundle --outfile=dist/handler.mjs --platform=node --format=esm --charset=utf8 \
  --external:@aws-sdk/* --external:pg-native \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM public.ecr.aws/lambda/nodejs:22 AS runner
COPY --from=builder /build/dist/handler.mjs ./

CMD ["handler.handler"]
