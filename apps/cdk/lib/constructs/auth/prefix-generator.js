const response = require('cfn-response');
const crypto = require('crypto');

// Log only fields that are safe to appear in CloudWatch Logs.
// Notably, the full CloudFormation custom-resource event includes ResponseURL,
// a pre-signed S3 URL that anyone with the URL can PUT to and forge a CFn
// response. Never log the raw event object.
function logSafeEvent(event) {
  console.log(
    JSON.stringify({
      RequestType: event.RequestType,
      LogicalResourceId: event.LogicalResourceId,
      PhysicalResourceId: event.PhysicalResourceId,
      RequestId: event.RequestId,
      StackId: event.StackId,
      ResourceType: event.ResourceType,
      ResourceProperties: event.ResourceProperties,
    }),
  );
}

exports.handler = async function (event, context) {
  try {
    logSafeEvent(event);
    if (event.RequestType == 'Delete') {
      return await response.send(event, context, response.SUCCESS);
    }

    const prefix = event.ResourceProperties.prefix ?? '';
    const length = event.ResourceProperties.length ?? '8';
    const generate = () => {
      const random = crypto.randomBytes(parseInt(length)).toString('hex');
      return `${prefix}${random.slice(0, length)}`;
    };

    if (event.RequestType == 'Create') {
      const generated = generate();
      return await response.send(event, context, response.SUCCESS, { generated }, generated);
    }
    if (event.RequestType == 'Update') {
      const current = event.PhysicalResourceId;
      if (current.startsWith(prefix)) {
        return await response.send(event, context, response.SUCCESS, { generated: current }, current);
      }
      const generated = generate();
      return await response.send(event, context, response.SUCCESS, { generated }, generated);
    }
  } catch (e) {
    console.log(e);
    await response.send(event, context, response.FAILED);
  }
};
