FROM public.ecr.aws/lambda/nodejs:24 AS builder
WORKDIR /build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/cdk/package.json apps/cdk/
RUN npm install -g pnpm@10.34.4 && pnpm install --frozen-lockfile
COPY packages/db/ packages/db/
COPY apps/cdk/lib/constructs/dsql-migrator/handler.ts apps/cdk/lib/constructs/dsql-migrator/
RUN pnpm exec esbuild apps/cdk/lib/constructs/dsql-migrator/handler.ts --bundle --outfile=dist/handler.mjs --platform=node --format=esm --charset=utf8 \
  --external:@aws-sdk/* --external:pg-native \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM public.ecr.aws/lambda/nodejs:24 AS runner
COPY --from=builder /build/dist/handler.mjs ./
COPY --from=builder /build/packages/db/migrations/ ./migrations/

CMD ["handler.handler"]
