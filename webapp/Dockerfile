FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY ./ ./
RUN npx prisma generate
COPY prisma ./

ARG HOST_DOMAIN=""
ARG SKIP_TS_BUILD=""
ARG AMPLIFY_APP_ORIGIN=""
ARG COGNITO_DOMAIN=""
ARG USER_POOL_CLIENT_ID=""
ARG USER_POOL_ID=""
RUN --mount=type=cache,target=/build/.next/cache npm run build

FROM public.ecr.aws/lambda/nodejs:22 AS runner
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=3000
ENV AWS_LWA_READINESS_CHECK_PATH="/api/health"
ENV AWS_LWA_INVOKE_MODE="response_stream"

COPY --from=builder /build/.next/static ./.next/static
COPY --from=builder /build/.next/standalone ./
COPY --from=builder /build/run.sh ./run.sh

RUN ln -s /tmp/cache ./.next/cache

ENTRYPOINT ["sh"]
CMD ["run.sh"]
