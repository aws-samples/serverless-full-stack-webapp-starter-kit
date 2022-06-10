import { Box, Grid, Stack, Typography } from '@mui/material';
import { API, selectInput } from 'aws-amplify';
import React, { FC, useEffect, useState } from 'react';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const Stats: FC = () => {
  const getStats = async () => {
    try {
      const res = await API.get('public', '/stats', {});
      setStats(res);
    } catch (e) {}
  };
  useEffect(() => {
    getStats();
  }, []);
  const [stats, setStats] = useState<{ memoCount: number; jobCount: number }>();

  return (
    <>
      {stats == null ? (
        ''
      ) : (
        <Stack justifyContent="center" alignItems="center" sx={{ m: 2 }}>
          <Typography variant="h3" component="div" gutterBottom>
            Until today...
          </Typography>
          <Grid justifyContent="center" container spacing={5}>
            <Grid item>
              <Stack alignItems="center" justifyContent="center">
                <Typography variant="h2" component="div" gutterBottom>
                  {stats.memoCount}
                </Typography>
                <Typography variant="h5" component="div" gutterBottom>
                  memos written
                </Typography>
              </Stack>
            </Grid>
            <Grid item>
              <Stack alignItems="center" justifyContent="center">
                <Typography variant="h2" component="div" gutterBottom>
                  {stats.jobCount}
                </Typography>
                <Typography variant="h5" component="div" gutterBottom>
                  jobs executed
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </Stack>
      )}
    </>
  );
};

export default Stats;
