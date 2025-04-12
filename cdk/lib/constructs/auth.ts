import { CfnOutput, CfnResource, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { CfnManagedLoginBranding, UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { CnameRecord, IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface AuthProps {
  readonly hostedZone: IHostedZone;
  readonly sharedCertificate: ICertificate;
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly domainName: string;

  private callbackUrlCount = 0;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);
    const { hostedZone } = props;
    const subDomain = 'auth';
    this.domainName = `${subDomain}.${hostedZone.zoneName}`;

    const userPool = new UserPool(this, 'UserPool', {
      passwordPolicy: {
        requireUppercase: true,
        requireSymbols: true,
        requireDigits: true,
        minLength: 8,
      },
      selfSignUpEnabled: true,
      signInAliases: {
        username: false,
        email: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const client = userPool.addClient(`Client`, {
      idTokenValidity: Duration.days(1),
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        callbackUrls: ['http://localhost/dummy'],
        logoutUrls: ['http://localhost/dummy'],
      },
    });

    this.client = client;
    this.userPool = userPool;

    const domain = userPool.addDomain('CognitoDomain', {
      customDomain: {
        domainName: this.domainName,
        certificate: props.sharedCertificate,
      },
    });

    new CnameRecord(this, 'CognitoDomainRecord', {
      zone: hostedZone,
      recordName: subDomain,
      domainName: domain.cloudFrontEndpoint,
    });

    (domain.node.defaultChild as CfnResource).addPropertyOverride('ManagedLoginVersion', 2);

    new CfnManagedLoginBranding(this, 'Branding', {
      userPoolId: this.userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
  }

  public addAllowedCallbackUrls(callbackUrl: string, logoutUrl: string) {
    const resource = this.client.node.defaultChild;
    if (!CfnResource.isCfnResource(resource)) {
      throw new Error('Expected CfnResource');
    }
    resource.addPropertyOverride(`CallbackURLs.${this.callbackUrlCount}`, callbackUrl);
    resource.addPropertyOverride(`LogoutURLs.${this.callbackUrlCount}`, logoutUrl);
    this.callbackUrlCount += 1;
  }
}
