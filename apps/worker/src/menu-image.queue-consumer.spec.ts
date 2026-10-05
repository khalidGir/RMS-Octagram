import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuImageQueueConsumer } from './menu-image.queue-consumer';

const h = vi.hoisted(() => {
  const receiveResults: Array<{ Messages?: Array<{ ReceiptHandle?: string; Body?: string }> }> = [];
  const sentCommands: Array<{ constructor: { name: string }; input?: Record<string, unknown> }> = [];
  let receiveFails = false;

  class ReceiveMessageCommand { constructor(public input: Record<string, unknown>) {} }
  class DeleteMessageCommand { constructor(public input: Record<string, unknown>) {} }

  const sqsSend = vi.fn(async (command: unknown) => {
    sentCommands.push(command as { constructor: { name: string } });
    const name = (command as { constructor: { name: string } }).constructor.name;
    if (name === 'ReceiveMessageCommand') {
      if (receiveFails) throw new Error('SQS unreachable');
      return receiveResults.shift() ?? {};
    }
    return {};
  });
  return { receiveResults, sentCommands, sqsSend, ReceiveMessageCommand, DeleteMessageCommand, setFail: (value: boolean) => { receiveFails = value; } };
});

vi.mock('@aws-sdk/client-sqs', () => ({
  ReceiveMessageCommand: h.ReceiveMessageCommand,
  DeleteMessageCommand: h.DeleteMessageCommand,
  SQSClient: class {
    send = h.sqsSend;
  },
}));

const configWithQueue = {
  get: (key: string, fallback?: string) => {
    if (key === 'SQS_QUEUE_URL') return 'http://localhost:9324/000000000000/rms-main';
    if (key === 'SQS_REGION') return 'us-east-1';
    return fallback;
  },
};

const configWithoutQueue = {
  get: (key: string, fallback?: string) => (key === 'SQS_QUEUE_URL' ? undefined : fallback),
};

function message(body: string) {
  return { Messages: [{ ReceiptHandle: 'receipt-1', Body: body }] };
}

describe('MenuImageQueueConsumer', () => {
  let processor: { handleJob: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    h.receiveResults.length = 0;
    h.sentCommands.length = 0;
    h.setFail(false);
    h.sqsSend.mockClear();
    processor = { handleJob: vi.fn().mockResolvedValue('COMPLETED') };
  });

  function create(config: unknown = configWithQueue) {
    return new MenuImageQueueConsumer(config as never, processor as never);
  }

  it('deletes the message after a terminal outcome', async () => {
    h.receiveResults.push(message(JSON.stringify({ mediaObjectId: 'media-1' })));
    const consumer = create();

    await consumer.receiveOnce();

    expect(processor.handleJob).toHaveBeenCalledWith('media-1');
    const deleted = h.sentCommands.filter((command) => command.constructor.name === 'DeleteMessageCommand');
    expect(deleted).toHaveLength(1);
  });

  it('deletes messages for REJECTED and SKIPPED outcomes too', async () => {
    for (const outcome of ['REJECTED', 'SKIPPED']) {
      h.receiveResults.length = 0;
      h.sentCommands.length = 0;
      processor.handleJob.mockResolvedValueOnce(outcome);
      h.receiveResults.push(message(JSON.stringify({ mediaObjectId: `media-${outcome}` })));
      const consumer = create();
      await consumer.receiveOnce();
      expect(h.sentCommands.filter((command) => command.constructor.name === 'DeleteMessageCommand')).toHaveLength(1);
    }
  });

  it('keeps the message when another worker holds the lease (IN_FLIGHT)', async () => {
    h.receiveResults.push(message(JSON.stringify({ mediaObjectId: 'media-1' })));
    processor.handleJob.mockResolvedValue('IN_FLIGHT');
    const consumer = create();

    await consumer.receiveOnce();

    expect(processor.handleJob).toHaveBeenCalledWith('media-1');
    expect(h.sentCommands.filter((command) => command.constructor.name === 'DeleteMessageCommand')).toHaveLength(0);
  });

  it('keeps the message on transient failures so SQS redelivers', async () => {
    h.receiveResults.push(message(JSON.stringify({ mediaObjectId: 'media-1' })));
    processor.handleJob.mockRejectedValue(new Error('S3 connection reset'));
    const consumer = create();

    await consumer.receiveOnce();

    expect(h.sentCommands.filter((command) => command.constructor.name === 'DeleteMessageCommand')).toHaveLength(0);
  });

  it('never trusts the message body beyond the pointer field', async () => {
    h.receiveResults.push(message(JSON.stringify({ tenantId: 'evil', mediaObjectId: 'media-1', role: 'OWNER' })));
    const consumer = create();

    await consumer.receiveOnce();

    expect(processor.handleJob).toHaveBeenCalledWith('media-1');
    expect(processor.handleJob).toHaveBeenCalledTimes(1);
    expect(processor.handleJob.mock.calls[0]).toHaveLength(1);
  });

  it('leaves unparseable and pointerless messages for the DLQ without processing', async () => {
    for (const body of ['not-json', JSON.stringify({ something: 'else' }), JSON.stringify({ mediaObjectId: '' })]) {
      h.receiveResults.length = 0;
      h.sentCommands.length = 0;
      processor.handleJob.mockClear();
      h.receiveResults.push(message(body));
      const consumer = create();
      await consumer.receiveOnce();
      expect(processor.handleJob).not.toHaveBeenCalled();
      expect(h.sentCommands.filter((command) => command.constructor.name === 'DeleteMessageCommand')).toHaveLength(0);
    }
  });

  it('is a no-op when SQS_QUEUE_URL is not configured', async () => {
    const consumer = create(configWithoutQueue);

    await consumer.receiveOnce();

    expect(h.sqsSend).not.toHaveBeenCalled();
    expect(processor.handleJob).not.toHaveBeenCalled();
  });

  it('requests long polling with a visibility window above the worker lease', async () => {
    h.receiveResults.push(message(JSON.stringify({ mediaObjectId: 'media-1' })));
    const consumer = create();

    await consumer.receiveOnce();

    const receive = h.sentCommands.find((command) => command.constructor.name === 'ReceiveMessageCommand') as { input: { WaitTimeSeconds: number; VisibilityTimeout: number } };
    expect(receive.input.WaitTimeSeconds).toBeGreaterThan(0);
    expect(receive.input.VisibilityTimeout).toBeGreaterThanOrEqual(300);
  });

  it('retries after a receive failure', async () => {
    h.setFail(true);
    const consumer = create();
    await expect(consumer.receiveOnce()).rejects.toThrow('SQS unreachable');
    h.setFail(false);
    h.receiveResults.push(message(JSON.stringify({ mediaObjectId: 'media-2' })));
    await consumer.receiveOnce();
    expect(processor.handleJob).toHaveBeenCalledWith('media-2');
  });
});
