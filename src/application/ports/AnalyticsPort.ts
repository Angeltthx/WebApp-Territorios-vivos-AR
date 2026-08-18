export interface AnalyticsPort {
  track(event: string, payload?: Record<string, unknown>): void;
}
