# Serverless Full Stack WebApp Starter Kit Knowledge Base

This file provides important information about the Serverless Full Stack WebApp Starter Kit repository. AI agent references this to support its work on this project.

## Project Overview

This project is a full stack webapp starter kit leveraging AWS serverless services, featuring:

- Next.js App Router on AWS Lambda
- CloudFront + Lambda function URL with response stream support
- End-to-end type safety (client to server)
- Cognito authentication
- Real-time notifications
- Asynchronous job queue
- Instant deployment via AWS CDK

## Project Structure

The project consists of two main components:

1. **WebApp** - `/webapp` directory
   - Next.js application with App Router
   - Frontend UI and server components
   - Server actions
   - TypeScript + React
   - Tailwind CSS for styling

2. **CDK (AWS Cloud Development Kit)** - `/cdk` directory
   - Infrastructure as Code definitions
   - AWS resource provisioning
   - Deployment configurations

### WebApp Structure

```
/webapp/src/
├── app/
│   ├── (root)/ 
│   │   ├── components/ (feature-specific components)
│   │   ├── actions.ts (server actions)
│   │   ├── schemas.ts (validation schemas)
│   │   └── page.tsx (main page)
│   ├── api/
│   ├── auth-callback/
│   └── sign-in/
├── components/ (shared components)
├── hooks/
├── jobs/
├── lib/
└── middleware.ts
```

## Technology Stack

- **Frontend**: React, Next.js, Tailwind CSS
- **Backend**: Next.js App Router, Server Actions, AWS Lambda
- **Database**: Amazon Aurora PostgreSQL Serverless v2 with Prisma ORM
- **Authentication**: Amazon Cognito
- **Real-time**: AWS AppSync Events
- **Infrastructure**: AWS CDK, CloudFront, Lambda, EventBridge

## Coding Conventions

- Use TypeScript for type safety
- Feature-based directory structure
- Function components with hooks for React
- Server actions for backend logic
- Zod for data validation
- Prisma for database interactions

## Commonly Used Commands

### WebApp

```bash
# Development server (with Turbopack)
cd webapp && npm run dev

# Build the web application
cd webapp && npm run build

# Formatting
cd webapp && npm run format

# Check formatting
cd webapp && npm run format:check

# Linting
cd webapp && npm run lint
```

### CDK

```bash
# Build the CDK project
cd cdk && npm run build

# Deploy the application to AWS
cd cdk && npm run cdk deploy

# Check for changes in the infrastructure
cd cdk && npm run cdk diff
```

## Development Flow

1. Create a branch for a new feature or bug fix
2. Implement changes and test locally
3. Run format and lint checks
4. Create a PR with title and description in English and ensure CI passes
5. Request review when the PR is ready

## Best Practices

1. **Directory Organization**:
   - Group feature-specific components, actions, and schemas in the same directory
   - Keep shared components in the top-level components directory

2. **Code Quality**:
   - Use TypeScript for type safety
   - Validate inputs with Zod schemas
   - Follow Next.js server/client component patterns

3. **Authentication**:
   - Use the built-in auth mechanisms for protected routes
   - Follow Cognito authentication patterns

4. **Database Access**:
   - Use Prisma for database operations
   - Keep database logic in server actions

## Troubleshooting

- **Next.js Errors**: Ensure proper separation of client/server components
- **CDK Deployment Issues**: Check AWS credentials and permissions
- **Authentication Problems**: Verify Cognito user pool configuration
- **Database Connection Errors**: Check Prisma schema and connection string