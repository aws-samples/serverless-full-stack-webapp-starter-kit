This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Run locally

First, run the development server:

```bash
# Run this command in the repository root
docker compose up -d
cd webapp

# Run this command in the webapp directory
npx prisma db push
cp .env.local.example .env.local
code .env.local
# Then populate values in .env.local

# run the next.js server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

```
webapp/
├── src/
│   ├── actions/         # Server actions
│   │   └── schemas/     # Zod validation schemas
│   ├── app/             # App router pages
│   ├── components/      # React components
│   ├── hooks/           # Custom React hooks
│   └── lib/             # Utility functions and configurations
├── prisma/              # Prisma schema and migrations
└── public/              # Static assets
```


## How to expand the project

### Pages

To add new pages to the application:

1. Create a new directory under `src/app` with the desired route name
2. Add a `page.tsx` file inside this directory
3. For protected pages, use the authentication session:

```tsx
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function NewPage() {
  const session = await getSession();
  
  if (!session?.user) {
    redirect('/api/auth/signin');
  }
  
  // Your page content here
}
```

### Server Actions

This project uses type-safe server actions with authentication:

1. Define input schemas in `src/actions/schemas`:
   ```typescript
   // src/actions/schemas/example.ts
   import { z } from 'zod';
   
   export const exampleActionSchema = z.object({
     field1: z.string().min(1, "Field is required"),
     field2: z.number().optional(),
   });
   ```

2. Create server actions in `src/actions`:
   ```typescript
   // src/actions/example.ts
   'use server';
   
   import { authActionClient } from '@/lib/safe-action';
   import { exampleActionSchema } from './schemas/example';
   import { prisma } from '@/lib/prisma';
   import { revalidatePath } from 'next/cache';
   
   export const exampleAction = authActionClient.schema(exampleActionSchema).action(
     async ({ parsedInput, ctx }) => {
       const { field1, field2 } = parsedInput;
       const { userId } = ctx;
       
       // Perform database operations or other logic
       const result = await prisma.example.create({
         data: {
           field1,
           field2,
           userId,
         },
       });
       
       // Revalidate the page to refresh data
       revalidatePath('/');
       return { result };
     }
   );
   ```

3. Use server actions in client components:

   a. With React Hook Form:
   ```tsx
   'use client';
   
   import { useHookFormAction } from '@next-safe-action/adapter-react-hook-form/hooks';
   import { zodResolver } from '@hookform/resolvers/zod';
   import { exampleAction } from '@/actions/example';
   import { exampleActionSchema } from '@/actions/schemas/example';
   import { toast } from 'sonner';
   
   export default function ExampleForm() {
     const {
       form: { register, formState },
       action,
       handleSubmitWithAction,
     } = useHookFormAction(exampleAction, zodResolver(exampleActionSchema), {
       actionProps: {
         onSuccess: () => {
           toast.success("Action completed successfully");
         },
         onError: ({ error }) => {
           toast.error(typeof error === 'string' ? error : "An error occurred");
         },
       },
       formProps: {
         defaultValues: {
           field1: '',
           field2: 0,
         },
       },
     });
     
     return (
       <form onSubmit={handleSubmitWithAction}>
         {/* Form fields */}
         <input {...register("field1")} />
         {formState.errors.field1 && (
           <p className="text-red-500">{formState.errors.field1.message}</p>
         )}
         <button type="submit" disabled={action.isExecuting}>
           {action.isExecuting ? 'Submitting...' : 'Submit'}
         </button>
       </form>
     );
   }
   ```

   b. For simple actions without forms:
   ```tsx
   'use client';
   
   import { useAction } from 'next-safe-action/hooks';
   import { simpleAction } from '@/actions/example';
   import { toast } from 'sonner';
   
   export default function ExampleButton() {
     const { execute, status } = useAction(simpleAction, {
       onSuccess: () => {
         toast.success("Action completed successfully");
       },
       onError: (error) => {
         toast.error(typeof error === 'string' ? error : "An error occurred");
       },
     });
     
     return (
       <button 
         onClick={() => execute({ id: '123' })}
         disabled={status === 'executing'}
       >
         {status === 'executing' ? 'Processing...' : 'Execute Action'}
       </button>
     );
   }
   ```

### Asynchronous Jobs

Asynchronous jobs are Lambda functions that handle long-running or background tasks. The `job.Dockerfile` builds all TypeScript files in `src/jobs/` into separate Lambda handlers using `esbuild src/jobs/*.ts --bundle`.

**Project structure:**

For simple jobs, place a single file directly under `src/jobs/`:

```
webapp/src/jobs/
├── migration-runner.ts           # Single-file Lambda handler
└── async-job-runner.ts           # Single-file Lambda handler
```

For jobs with complex logic, use a subdirectory:

```
webapp/src/jobs/
├── async-job-runner.ts           # Lambda handler entry point
└── async-job/                    # Business logic directory
    └── translate.ts              # Job implementation
```

**Example implementation:**

```typescript
// webapp/src/jobs/async-job-runner.ts
import { translateJobHandler, translateJobSchema } from '@/jobs/async-job/translate';
import { Handler } from 'aws-lambda';
import { z } from 'zod';

const jobPayloadPropsSchema = z.discriminatedUnion('type', [
  translateJobSchema,
  // Add more job types here
]);

export const handler: Handler<unknown> = async (event) => {
  const { data: payload, error } = jobPayloadPropsSchema.safeParse(event);
  if (error) throw new Error(error.toString());

  switch (payload.type) {
    case 'translate':
      await translateJobHandler(payload);
      break;
  }
};
```

```typescript
// webapp/src/jobs/async-job/translate.ts
import { z } from 'zod';

export const translateJobSchema = z.object({
  type: z.literal('translate'),
  todoItemId: z.string(),
  userId: z.string(),
});

export const translateJobHandler = async (params: z.infer<typeof translateJobSchema>) => {
  // Job implementation
};
```

**Note:** All jobs share the same `job.Dockerfile`. No individual Dockerfiles are needed. To deploy jobs, configure them in the CDK stack (see `cdk/lib/constructs/async-job.ts`).
