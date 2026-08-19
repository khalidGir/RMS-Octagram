#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RmsStack } from '../lib/rms-stack';

const app = new cdk.App();

const environment = app.node.tryGetContext('environment') || 'staging';

new RmsStack(app, `Rms-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'af-south-1',
  },
  environment,
});

app.synth();
