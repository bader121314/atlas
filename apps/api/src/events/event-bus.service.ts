import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { createClient } from 'redis';
import { parseEnvironment } from '@atlas/config';
import { projectChannel, projectEventSchema } from '@atlas/contracts';
import type { ProjectEvent } from '@atlas/contracts';

type Listener = (event: ProjectEvent) => void;
const RECENT_LIMIT = 2000;

/**
 * One Redis pattern subscription per API instance, fanned out to the event
 * streams open on this instance (ADR-029). Events seen recently are dropped,
 * since the dispatcher delivers at least once.
 */
@Injectable()
export class EventBus implements OnApplicationShutdown {
  private readonly logger = new Logger('EventBus');
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly recent = new Set<string>();
  private subscriber: ReturnType<typeof createClient> | undefined;
  private starting: Promise<void> | undefined;

  /** Starts listening for one project; resolves once Redis is subscribed. */
  async subscribe(
    organizationId: string,
    projectId: string,
    listener: Listener,
  ): Promise<() => void> {
    const channel = projectChannel(organizationId, projectId);
    const set = this.listeners.get(channel) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(channel, set);
    try {
      await this.start();
    } catch (error) {
      this.remove(channel, listener);
      throw error;
    }
    return () => this.remove(channel, listener);
  }

  /** Delivers one raw message; public so tests can inject events. */
  deliver(channel: string, message: string): void {
    const set = this.listeners.get(channel);
    if (!set) return;
    let event: ProjectEvent;
    try {
      event = projectEventSchema.parse(JSON.parse(message));
    } catch {
      return;
    }
    if (projectChannel(event.organizationId, event.projectId) !== channel)
      return;
    if (this.recent.has(event.id)) return;
    this.recent.add(event.id);
    if (this.recent.size > RECENT_LIMIT) {
      const oldest = this.recent.values().next().value;
      if (oldest) this.recent.delete(oldest);
    }
    for (const listener of set) listener(event);
  }

  private remove(channel: string, listener: Listener): void {
    const set = this.listeners.get(channel);
    set?.delete(listener);
    if (set?.size === 0) this.listeners.delete(channel);
  }

  private start(): Promise<void> {
    this.starting ??= (async () => {
      const client = createClient({
        url: parseEnvironment(process.env).REDIS_URL,
        socket: { reconnectStrategy: (n: number) => Math.min(n * 100, 2000) },
      });
      client.on('error', () => this.logger.error('event subscription error'));
      await client.connect();
      await client.pSubscribe('atlas:events:*', (message, channel) =>
        this.deliver(channel, message),
      );
      this.subscriber = client;
    })().catch((error: unknown) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  onApplicationShutdown(): void {
    this.subscriber?.destroy();
    this.subscriber = undefined;
    this.starting = undefined;
  }
}
