import type { AnalyticsPort } from '@application/ports/AnalyticsPort';

export class ConsoleAnalyticsAdapter implements AnalyticsPort {
  track(event: string, payload: Record<string, unknown> = {}): void {
    console.info(`[analytics] ${event}`, payload);
  }
}
