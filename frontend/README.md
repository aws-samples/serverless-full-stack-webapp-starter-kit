# Frontend
This is a frontend powered by React.js, Vite, Amplify Libraries, and MUI.

## Local development
You can start a local server by the following command:

```sh
npm run dev
```

Note that you must set `.env` file properly to use some of the features. To reduce mocking the AWS services, we recommend you first deploy a development environment to your AWS account, and refer to the resources in the environment from your local frontend.

To do that, first you deploy the entire app by CDK (follow the instructions in the root `README.md`,) and then modify the value in the [`.env`(./.env) file]. You can obtain the required values from stack outputs you will get after a deployment 

`VITE_BACKEND_API_URL` is the only variable set by default. It is a endpoint for the main backend API. If you run backend API locally (see [backend/README.md](./../backend/README.md) for the detail), the default value (localhost:3001) will work. If you want to directly call the API you deployed to AWS, you can set the value from the stack output `BackendApiBackendApiUrl`.

You should additionally set Cognito configuration (`VITE_USER_POOL*` and `VITE_AWS_REGION`). These values can also obtained from the stack outputs.

```ini
VITE_BACKEND_API_URL=http://localhost:3001
VITE_USER_POOL_ID=ap-northeast-1_NXDyxxxxx #AuthUserPoolId value
VITE_USER_POOL_CLIENT_ID=6gukdf98g88j9ngxxxxxxx # AuthUserPoolClientId value
VITE_AWS_REGION=ap-northeast-1 #the AWS region you deployed the app
```
