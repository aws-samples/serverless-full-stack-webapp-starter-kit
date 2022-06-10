type SampleJobProps = {};

export type SampleJobEvent = {
  jobType: 'sample';
  payload: SampleJobProps;
};

export const sampleJob = async (props: SampleJobProps) => {
  console.log(JSON.stringify(props));
  // do something that takes long time
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(5000);
};
