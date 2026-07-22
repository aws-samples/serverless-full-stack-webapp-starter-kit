import { SignatureV4 } from '@smithy/signature-v4';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';

export async function sendEvent(channelName: string, payload: unknown) {
  const httpEndpoint = process.env.EVENT_HTTP_ENDPOINT;
  const region = process.env.AWS_REGION;
  if (!httpEndpoint) {
    console.log('event api is not configured!');
    return;
  }

  const endpoint = `${httpEndpoint}/event`;
  const url = new URL(endpoint);

  const requestToBeSigned = new HttpRequest({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: url.host },
    hostname: url.host,
    body: JSON.stringify({
      channel: `event-bus/${channelName}`,
      events: [JSON.stringify({ payload })],
    }),
    path: url.pathname,
  });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: region!,
    service: 'appsync',
    sha256: Sha256,
  });

  const signed = await signer.sign(requestToBeSigned);
  const res = await fetch(new Request(endpoint, signed));
  const body = await res.text();
  // fetch() does not reject on 4xx/5xx. Without this guard, an AppSync auth
  // failure or throttle would return silently and the client would never
  // receive the "job done" event — breaking the documented async-job →
  // real-time notification contract. Throw so the Lambda invocation
  // surfaces the failure in logs / retries instead.
  if (!res.ok) {
    throw new Error(`sendEvent failed: ${res.status} ${res.statusText} ${body}`);
  }
  console.log(body);
}
