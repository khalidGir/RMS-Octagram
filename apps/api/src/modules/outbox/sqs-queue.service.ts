import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

/**
 * Thin SQS publisher used by outbox handlers. The queue URL comes from the
 * environment; when it is missing the send fails loudly so events move to
 * RETRY/DEAD_LETTER instead of being silently dropped.
 */
@Injectable()
export class SqsQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SqsQueueService.name);
  private readonly client: SQSClient | null;
  readonly queueUrl: string | null;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.queueUrl = config.get<string>('SQS_QUEUE_URL') ?? null;
    const endpoint = config.get<string>('SQS_ENDPOINT');
    this.client = this.queueUrl
      ? new SQSClient({
          region: config.get<string>('SQS_REGION', 'us-east-1'),
          ...(endpoint ? { endpoint } : {}),
        })
      : null;
    if (!this.queueUrl) this.logger.warn('SQS_QUEUE_URL is not set; menu image jobs will not be published');
  }

  async send(body: { mediaObjectId: string }): Promise<void> {
    if (!this.client || !this.queueUrl) throw new Error('SQS_QUEUE_URL is not configured');
    await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(body) }));
  }

  onModuleDestroy() {
    this.client?.destroy();
  }
}
