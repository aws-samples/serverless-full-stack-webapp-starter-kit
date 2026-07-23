FROM public.ecr.aws/lambda/nodejs:24 AS builder
WORKDIR /build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/event-utils/package.json packages/event-utils/
COPY apps/async-job/package.json apps/async-job/
# No --filter: esbuild needs the full transitive dependency graph, and this
# builder stage's node_modules is discarded (only the bundle ships to the runner).
RUN npm install -g pnpm@10.34.4 && pnpm install --frozen-lockfile
COPY packages/ packages/
COPY apps/async-job/ apps/async-job/
RUN pnpm exec esbuild apps/async-job/src/handler.ts --bundle --outfile=dist/handler.mjs --platform=node --format=esm --charset=utf8 \
  --external:@aws-sdk/* --external:pg-native \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM public.ecr.aws/lambda/nodejs:24 AS runner
COPY --from=builder /build/dist/handler.mjs ./

CMD ["handler.handler"]
