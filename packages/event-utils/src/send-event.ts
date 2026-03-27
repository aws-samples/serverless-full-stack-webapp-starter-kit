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
  console.log(await res.text());
}
