import './App.css';
import { Amplify, Auth } from 'aws-amplify';
import config from './config';
import '@aws-amplify/ui-react/styles.css';
import Stats from './components/stats';
import { Authenticator, Button, useAuthenticator } from '@aws-amplify/ui-react';
import Memo from './components/memo';
import { AppBar, Container, Toolbar, Typography } from '@mui/material';

function App() {
  const amplifyConfig = {
    ...(true || config.userPoolId != null
      ? {
          Auth: {
            region: config.awsRegion,
            userPoolId: config.userPoolId,
            userPoolWebClientId: config.userPoolClientId,
          },
        }
      : {}),
    API: {
      endpoints: [
        {
          name: 'main',
          endpoint: config.apiEndpoint,
          custom_header: async () => {
            return { Authorization: `${(await Auth.currentSession())?.getAccessToken().getJwtToken()}` };
          },
        },
        {
          name: 'public',
          endpoint: config.apiEndpoint + '/public',
        },
      ],
    },
  };
  Amplify.configure(amplifyConfig);

  const { authStatus } = useAuthenticator((context) => [context.user]);

  return (
    <>
      {authStatus != 'authenticated' ? <Stats></Stats> : <></>}
      <Authenticator>
        {({ signOut, user }) => (
          <>
            <AppBar position="static">
              <Toolbar>
                <Typography variant="h6" color="inherit" noWrap sx={{ flexGrow: 1 }}>
                  Write your memo
                </Typography>
                <Typography sx={{ paddingX: 2 }}>{user == null ? '' : user.username}</Typography>
                <Button color="inherit" onClick={signOut}>
                  Sign out
                </Button>
              </Toolbar>
            </AppBar>
            <main>
              <Container maxWidth="lg" sx={{ m: 2 }}>
                <Memo />
              </Container>
            </main>
          </>
        )}
      </Authenticator>
    </>
  );
}

export default App;
