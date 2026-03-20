FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/webapp/package.json apps/webapp/
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate && pnpm install --frozen-lockfile
COPY packages/ packages/
COPY apps/webapp/ apps/webapp/

ARG SKIP_TS_BUILD=""
ARG ALLOWED_ORIGIN_HOST=""
ARG NEXT_PUBLIC_EVENT_HTTP_ENDPOINT=""
ARG NEXT_PUBLIC_AWS_REGION=""
ENV USER_POOL_CLIENT_ID="dummy"
ENV USER_POOL_ID="dummy"
ENV AMPLIFY_APP_ORIGIN="https://dummy.example.com"
ENV COGNITO_DOMAIN="dummy.example.com"
RUN cd apps/webapp && npx next build

FROM public.ecr.aws/lambda/nodejs:22 AS runner
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=3000
ENV AWS_LWA_READINESS_CHECK_PATH="/api/health"
ENV AWS_LWA_INVOKE_MODE="response_stream"

COPY --from=builder /build/apps/webapp/.next/static ./apps/webapp/.next/static
COPY --from=builder /build/apps/webapp/.next/standalone ./
COPY --from=builder /build/apps/webapp/run.sh ./run.sh

RUN ln -s /tmp/cache ./apps/webapp/.next/cache

ENTRYPOINT ["sh"]
CMD ["run.sh"]
