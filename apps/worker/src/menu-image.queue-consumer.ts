import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Nest DI needs the runtime class metadata
import { ConfigService } from '@nestjs/config';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- referenced at runtime via emitDecoratorMetadata paramtypes
import { MenuImageProcessor } from './menu-image.processor';

const VISIBILITY_TIMEOUT_SECONDS = 300; // must exceed the processor lease (240s)
const WAIT_TIME_SECONDS = 10;
const ERROR_BACKOFF_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Long-polls SQS for menu image jobs. The message body is treated strictly as
 * a pointer ({ mediaObjectId }); tenant and menu-item ownership come from the
 * database record the processor loads. Messages are deleted only after a
 * terminal outcome (COMPLETED/REJECTED/SKIPPED). In-flight, transient, and
 * unparseable messages are left untouched so SQS redelivers them and finally
 * moves them to the DLQ after maxReceiveCount.
 */
@Injectable()
export class MenuImageQueueConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MenuImageQueueConsumer.name);
  private readonly sqs: SQSClient | null;
  private readonly queueUrl: string | null;
  private stopped = false;

  constructor(config: ConfigService, private readonly processor: MenuImageProcessor) {
    this.queueUrl = config.get<string>('SQS_QUEUE_URL') ?? null;
    const endpoint = config.get<string>('SQS_ENDPOINT');
    this.sqs = this.queueUrl
      ? new SQSClient({ region: config.get<string>('SQS_REGION', 'us-east-1'), ...(endpoint ? { endpoint } : {}) })
      : null;
  }

  onModuleInit() {
    if (!this.sqs || !this.queueUrl) {
      this.logger.warn('SQS_QUEUE_URL is not set; menu image consumer is idle');
      return;
    }
    void this.run();
  }

  onModuleDestroy() {
    this.stopped = true;
  }

  private async run() {
    while (!this.stopped) {
      try {
        await this.receiveOnce();
      } catch (error) {
        this.logger.error(`Menu image receive failed: ${String(error)}`);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  /** Receives and handles at most one message; exposed for deterministic tests. */
  async receiveOnce(): Promise<void> {
    if (!this.sqs || !this.queueUrl) return;
    const response = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: WAIT_TIME_SECONDS,
      VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
    }));
    for (const message of response.Messages ?? []) {
      if (!message.ReceiptHandle) continue;
      const mediaObjectId = this.parsePointer(message.Body);
      if (!mediaObjectId) {
        // Poison message: leave it for redelivery → DLQ, never delete blindly.
        this.logger.error('Menu image message has no mediaObjectId pointer');
        continue;
      }
      try {
        const outcome = await this.processor.handleJob(mediaObjectId);
        if (outcome === 'IN_FLIGHT') {
          // Another worker holds a live lease — redelivery decides later.
          continue;
        }
        await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }));
      } catch (error) {
        // Transient failure: the processor already reset the row; leave the
        // message for redelivery (DLQ after maxReceiveCount).
        this.logger.warn(`Menu image job ${mediaObjectId} failed transiently: ${String(error)}`);
      }
    }
  }

  private parsePointer(body: string | undefined): string | null {
    if (!body) return null;
    try {
      const parsed = JSON.parse(body) as { mediaObjectId?: unknown };
      return typeof parsed.mediaObjectId === 'string' && parsed.mediaObjectId.length > 0 ? parsed.mediaObjectId : null;
    } catch {
      return null;
    }
  }
}
