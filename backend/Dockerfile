FROM public.ecr.aws/lambda/nodejs:16 as build
WORKDIR /build
COPY package-lock.json package.json ./
RUN npm ci
COPY . .
# https://esbuild.github.io/api/
# https://github.com/aws/aws-cdk/blob/master/packages/%40aws-cdk/aws-lambda-nodejs/lib/bundling.ts
RUN npm run bundle

FROM public.ecr.aws/lambda/nodejs:16
WORKDIR ${LAMBDA_TASK_ROOT}

COPY package-lock.json package.json ./
RUN npm ci --production
COPY --from=build /build/dist .
COPY . .

CMD ["handler.handler"]
