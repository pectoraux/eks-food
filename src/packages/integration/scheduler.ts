/**
 * Scheduling engine — cron, interval, manual, event-triggered, dependency-aware,
 * maintenance windows, blackout periods.
 */
import { db } from "@/lib/db";

export type ScheduleType = "CRON" | "INTERVAL" | "MANUAL" | "EVENT";

export interface ScheduleConfig {
  readonly configId: string;
  readonly type: ScheduleType;
  readonly expression: string; // cron | interval-sec | event-type
  readonly blackoutPeriods?: readonly { start: string; end: string }[];
}

export class Scheduler {
  /** Create a schedule for a connector configuration. */
  async create(config: ScheduleConfig): Promise<{ scheduleId: string; nextTriggerAt: Date }> {
    const nextTriggerAt = this.computeNextTrigger(config);
    const schedule = await db.connectorSchedule.create({
      data: {
        configId: config.configId,
        type: config.type,
        expression: config.expression,
        active: true,
        blackoutPeriods: JSON.stringify(config.blackoutPeriods ?? []),
        nextTriggerAt,
      },
    });
    return { scheduleId: schedule.id, nextTriggerAt };
  }

  /** Compute the next trigger time for a schedule. */
  computeNextTrigger(config: ScheduleConfig): Date {
    const now = new Date();
    switch (config.type) {
      case "INTERVAL": {
        const sec = parseInt(config.expression, 10);
        return new Date(now.getTime() + sec * 1000);
      }
      case "CRON": {
        // Simplified: production uses cron-parser. Here, parse "every N minutes".
        const match = config.expression.match(/\*\/(\d+)/);
        if (match) {
          const min = parseInt(match[1], 10);
          return new Date(now.getTime() + min * 60_000);
        }
        return new Date(now.getTime() + 60_000); // default 1 min
      }
      case "EVENT":
      case "MANUAL":
        return now; // event-triggered fires immediately when the event arrives
    }
  }

  /** Check if the current time is within a blackout period. */
  isBlackout(blackoutPeriods: readonly { start: string; end: string }[], now = new Date()): boolean {
    const hour = now.getHours();
    for (const period of blackoutPeriods) {
      const start = parseInt(period.start, 10);
      const end = parseInt(period.end, 10);
      if (hour >= start && hour < end) return true;
    }
    return false;
  }

  /** Get due schedules (for the scheduler worker to pick up). */
  async getDueSchedules(): Promise<readonly unknown[]> {
    return db.connectorSchedule.findMany({
      where: { active: true, nextTriggerAt: { lte: new Date() } },
      take: 50,
    });
  }

  /** Mark a schedule as triggered + compute the next trigger. */
  async markTriggered(scheduleId: string, config: ScheduleConfig): Promise<void> {
    const nextTriggerAt = this.computeNextTrigger(config);
    await db.connectorSchedule.update({ where: { id: scheduleId }, data: { lastTriggeredAt: new Date(), nextTriggerAt } });
  }

  /** List schedules for a connector configuration. */
  async list(configId: string): Promise<readonly unknown[]> {
    return db.connectorSchedule.findMany({ where: { configId }, orderBy: { createdAt: "desc" } });
  }
}
