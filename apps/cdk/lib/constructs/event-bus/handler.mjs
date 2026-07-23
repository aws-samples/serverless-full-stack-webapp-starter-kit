import { util } from '@aws-appsync/utils';

/**
 * Allow subscription only for the channels that
 * 1. begin with /public
 * 2. begin with /user/<userSub>/
 *
 * We match on ctx.identity.sub (the Cognito user's stable UUID) rather than
 * ctx.identity.username. username is the "cognito:username" claim; with
 * UsernameAttributes: ['email'] it currently happens to equal sub, but that
 * is an internal Cognito implementation detail (not a documented contract)
 * and it does not hold for other user-pool configurations.
 *
 * The trailing "/" on the user prefix is required so that a channel path
 * like /event-bus/user/<attackerId>-foo does not falsely match /event-bus/user/<attackerId>.
 * https://docs.aws.amazon.com/appsync/latest/eventapi/channel-namespace-handlers.html
 */
export function onSubscribe(ctx) {
  if (ctx.info.channel.path.startsWith(`/event-bus/public/`)) {
    return;
  }
  if (ctx.info.channel.path.startsWith(`/event-bus/user/${ctx.identity.sub}/`)) {
    return;
  }
  console.log(`user ${ctx.identity.sub} tried connecting to wrong channel: ${ctx.channel}`);
  util.unauthorized();
}
