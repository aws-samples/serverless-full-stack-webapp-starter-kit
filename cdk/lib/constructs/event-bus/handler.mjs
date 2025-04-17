import { util } from '@aws-appsync/utils'

export function onSubscribe(ctx) {
  if (ctx.info.channel.path.startsWith(`/event-bus/public`)) {
    return;
  }
  if (ctx.info.channel.path.startsWith(`/event-bus/user/${ctx.identity.username}`)) {
    return;
  }
  console.log(`user ${ctx.identity.username} tried connecting to wrong channel: ${ctx.channel}`);
  util.unauthorized();
}
