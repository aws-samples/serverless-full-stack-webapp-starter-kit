## Run locally
You can start a local backend by the following command:

```sh
# start DynamoDB local
docker-compose up -d

# start express
npm run local
```

We use [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) to mock DynamoDB locally. To use a DynamoDB table deployed on AWS, you can modify the environment variables defined in [`app.local.ts`](apps/local.ts); set `TABLE_NAME` and `AWS_REGION` to the actual table name and region, and remove `DYNAMODB_ENDPOINT` variable. 

You can additonally set `JOB_QUEUE_NAME` to the SQS queue name you deployed to AWS, if you want to test job enqueue feature locally.

## Steps to add an endpoint
When you add an endpoint, please follow the below steps:

1. Add service directory (when necessary)
2. implement method in `controller.ts` for the service
3. Add request / response type definition to `types.ts`
4. Add route to `router.ts`
5. If you added a new service, add the route to app according to it is public API or not. (`apps` directory)

Note that there are endpoints that requires authentication and not (a.k.a. public endpoints).
These endpoints are separated by Express apps; Add your service to [apps/authenticated.ts](apps/authenticated.ts) for endpoints that requires authentication, or [apps/public.ts](apps/public.ts) for ones that is public API. Additionally, always add your service to [apps/loacl.ts](apps/local.ts) to allow local testing.

## Steps to add an asynchronous job
When you add another asynchronous job, please follow the below steps:

1. Add a job logic in [jobs directory](./jobs/) in a similar way as [`jobs/sample-job.ts`](jobs/sample-job.ts). You must define at least a job handler (like `sampleJob` function) and a job event type (like `SampleJobEvent`.) You must define a unique stirng as `jobType` for your new job.
2. Modify `JobEvent` type in [`common/jobs.ts`](common/jobs.ts) to include a new event type you added. You can use a union type, like `SampleJobEvent | SomeNewEvent`.
3. Modify [`handler-job.ts`](./handler-job.ts) to call the new job handler function for the new `jobType` like the below code.

```ts
    switch (event.jobType) {
      case 'sample':
        await sampleJob(event.payload);
      // Add this case
      case 'someNewJobType':
        await someNewJob(event.payload);
    }
```

You can then run your new job using `runJob` function in [`common/jobs.ts`](common/jobs.ts).

### Schedules jobs 
You can also execute the async jobs in a scheduled manner. To configure scheduled rules, please edit [cron-jobs.ts](../cdk/lib/constructs/cron-jobs.ts) in CDK templates. 

To add a scheduled job, you have to call `addRule` function in the `CronJobs` construct.
When calling the function, you can specify a job type, a cron schedule, and any event payload if required for the job.

```ts
    // private addRule(jobType: string, schedule: Schedule, payload?: any)
    this.addRule('SampleJob', Schedule.cron({ minute: '0', hour: '0', day: '1' }, {}));
```
