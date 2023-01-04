import React, { FC, useEffect, useState } from 'react';
import { API } from 'aws-amplify';
import {
  Card,
  CardContent,
  CardMedia,
  Grid,
  Typography,
  CardActions,
  Button,
  TextField,
  Stack,
  Box,
} from '@mui/material';
import { SubmitHandler, useForm } from 'react-hook-form';

type Memo = {
  createdAt: number;
  SK: string;
} & MemoInput;

type MemoInput = {
  title: string;
  content: string;
};

const Memo: FC = () => {
  const { register, handleSubmit, reset } = useForm<MemoInput>();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [jobRunCount, setJobRunCount] = useState(0);

  const getMemos = async () => {
    const response = await API.get('main', '/memo', {});
    setMemos(response.memos);
  };

  const createMemo: SubmitHandler<MemoInput> = async (memo: MemoInput) => {
    const response = (await API.post('main', '/memo', { body: memo })) as Memo;
    setMemos([response, ...memos]);
    reset({ title: '', content: '' });
  };

  const deleteMemo = async (sk: string) => {
    const response = await API.post('main', '/memo/delete', { body: { sk } });
    setMemos(memos.filter((m) => m.SK != sk));
  };

  const runSampleJob = async () => {
    await API.post('main', '/memo/run', {});
    setJobRunCount(jobRunCount + 1);
  };

  useEffect(() => {
    getMemos();
  }, []);

  return (
    <>
      <Grid container spacing={1}>
        {memos.map((memo, i) => (
          <Grid item key={i} lg={6} sm={3} md={4} zeroMinWidth>
            <Card sx={{ height: 187 }}>
              <CardContent>
                <Box sx={{ width: '100%' }}>
                  <Typography noWrap gutterBottom variant="h5">
                    {memo.title}
                  </Typography>
                  <Typography noWrap paragraph>
                    {memo.content}
                  </Typography>
                  <Typography noWrap>{new Date(memo.createdAt).toISOString()}</Typography>
                </Box>
              </CardContent>
              <CardActions>
                <Button size="small" color="primary" onClick={() => deleteMemo(memo.SK)}>
                  Delete
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
        <Grid item key={-1} lg={6}>
          <Card sx={{ minHeight: 187 }}>
            <CardContent>
              <Stack spacing={1.5}>
                <TextField id="title" label="Title" size="small" required {...register('title')} />
                <TextField id="content" label="Content" multiline required {...register('content')} />
              </Stack>
            </CardContent>
            <CardActions>
              <Button size="small" color="primary" onClick={handleSubmit(createMemo)}>
              add a new memo
              </Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>

      <Grid alignItems="center" container={true} spacing={2} sx={{ m: 2 }}>
        <Grid item>
          <Button variant="contained" onClick={() => runSampleJob()}>
            Run sample job
          </Button>
        </Grid>
        <Grid item>{jobRunCount == 0 ? null : <Typography>You executed {jobRunCount} jobs!</Typography>}</Grid>
      </Grid>
    </>
  );
};

export default Memo;
