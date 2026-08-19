import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface RmsStackProps extends cdk.StackProps {
  environment: string;
}

export class RmsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RmsStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const isProd = environment === 'production';

    // ── VPC ──────────────────────────────────
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: isProd ? 2 : 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ── Security Groups ──────────────────────
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB security group',
      allowAllOutbound: false,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from internet');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP redirect');

    const apiSg = new ec2.SecurityGroup(this, 'ApiSg', {
      vpc,
      description: 'API ECS service security group',
      allowAllOutbound: false,
    });
    apiSg.addIngressRule(albSg, ec2.Port.tcp(3001), 'ALB to API');
    apiSg.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTcp(), 'VPC internal');

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'RDS security group',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(apiSg, ec2.Port.tcp(5432), 'API to PostgreSQL');
    dbSg.addIngressRule(new ec2.SecurityGroup(this, 'MigrationSg', { vpc }), ec2.Port.tcp(5432), 'Migration task to PostgreSQL');

    // ── RDS PostgreSQL ───────────────────────
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        isProd ? ec2.InstanceSize.MEDIUM : ec2.InstanceSize.MICRO,
      ),
      databaseName: 'rms',
      credentials: rds.Credentials.fromGeneratedSecret('rms'),
      multiAz: isProd,
      backupRetention: cdk.Duration.days(isProd ? 7 : 1),
      deletionProtection: isProd,
      storageEncrypted: true,
    });

    // ── S3 Payment Proofs Bucket ─────────────
    const proofBucket = new s3.Bucket(this, 'ProofBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ── SQS Queues ───────────────────────────
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      retentionPeriod: cdk.Duration.days(14),
    });

    const mainQueue = new sqs.Queue(this, 'MainQueue', {
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 3 },
    });

    // ── ECS Cluster ──────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `rms-${environment}`,
      vpc,
      containerInsights: isProd,
    });

    // ── Log Groups ───────────────────────────
    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/ecs/rms-api-${environment}`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const workerLogGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      logGroupName: `/ecs/rms-worker-${environment}`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ── ECS Task Definitions ─────────────────
    const apiTaskDef = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
      memoryLimitMiB: isProd ? 1024 : 512,
      cpu: isProd ? 512 : 256,
    });

    const workerTaskDef = new ecs.FargateTaskDefinition(this, 'WorkerTaskDef', {
      memoryLimitMiB: isProd ? 1024 : 512,
      cpu: isProd ? 512 : 256,
    });

    // Grant task roles access to resources
    proofBucket.grantReadWrite(apiTaskDef.taskRole);
    mainQueue.grantConsumeMessages(workerTaskDef.taskRole);

    // ── API Container ────────────────────────
    const apiContainer = apiTaskDef.addContainer('api', {
      image: ecs.ContainerImage.fromAsset('..', {
        buildArgs: { SERVICE: 'api', BUILD_CONTEXT: 'apps/api' },
        file: 'apps/api/Dockerfile',
      }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logGroup: apiLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        API_PORT: '3001',
        API_HOST: '0.0.0.0',
        DEFAULT_TIMEZONE: 'Africa/Addis_Ababa',
        DEFAULT_CURRENCY: 'ETB',
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
        JWT_ACCESS_SECRET: ecs.Secret.fromSecretsManager(
          new secretsmanager.Secret(this, 'JwtAccessSecret', {
            generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'key' },
          }),
        ),
        JWT_REFRESH_SECRET: ecs.Secret.fromSecretsManager(
          new secretsmanager.Secret(this, 'JwtRefreshSecret', {
            generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'key' },
          }),
        ),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3001/api/v1/health/live || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    apiContainer.addPortMappings({ containerPort: 3001, protocol: ecs.Protocol.TCP });

    // ── Worker Container ─────────────────────
    workerTaskDef.addContainer('worker', {
      image: ecs.ContainerImage.fromAsset('..', {
        buildArgs: { SERVICE: 'worker', BUILD_CONTEXT: 'apps/worker' },
        file: 'apps/worker/Dockerfile',
      }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'worker',
        logGroup: workerLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        DEFAULT_TIMEZONE: 'Africa/Addis_Ababa',
        DEFAULT_CURRENCY: 'ETB',
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
      },
    });

    // ── API ECS Service ──────────────────────
    const apiService = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: apiTaskDef,
      desiredCount: isProd ? 2 : 1,
      securityGroups: [apiSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    database.connections.allowFrom(apiService, ec2.Port.tcp(5432));

    // ── Worker ECS Service ───────────────────
    const workerService = new ecs.FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTaskDef,
      desiredCount: isProd ? 2 : 1,
      securityGroups: [apiSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    database.connections.allowFrom(workerService, ec2.Port.tcp(5432));

    // ── ALB ──────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const listener = alb.addListener('HttpsListener', {
      port: 443,
      certificates: [
        acm.Certificate.fromCertificateArn(
          this,
          'Cert',
          `arn:aws:acm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:certificate/placeholder`,
        ),
      ],
      defaultTargetGroups: [
        new elbv2.ApplicationTargetGroup(this, 'Default', {
          vpc,
          port: 80,
          protocol: elbv2.ApplicationProtocol.HTTP,
        }),
      ],
    });

    listener.addTargetGroups('ApiTarget', {
      targetGroups: [
        new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
          vpc,
          port: 3001,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targets: [apiService],
          healthCheck: {
            path: '/api/v1/health/ready',
            interval: cdk.Duration.seconds(30),
            healthyThresholdCount: 2,
          },
        }),
      ],
    });

    // HTTP to HTTPS redirect
    alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443' }),
    });

    // ── Outputs ──────────────────────────────
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: mainQueue.queueUrl,
    });

    new cdk.CfnOutput(this, 'ProofBucketName', {
      value: proofBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
    });
  }
}
