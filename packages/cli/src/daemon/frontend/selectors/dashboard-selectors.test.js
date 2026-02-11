import { describe, expect, it } from 'bun:test';
import {
  selectFilteredActivity,
  selectJobCounts,
} from './dashboard-selectors.js';

describe('dashboard selectors', () => {
  it('sums running and queued jobs across repos', () => {
    const counts = selectJobCounts([
      { runningJobs: 2, queuedJobs: 3 },
      { runningJobs: 0, queuedJobs: 1 },
      { runningJobs: undefined, queuedJobs: undefined },
    ]);

    expect(counts).toEqual({ runningJobs: 2, queuedJobs: 4 });
  });

  it('filters and reverses activity for info+', () => {
    const events = [
      { level: 'debug', topic: 'debug', eventId: 1 },
      { level: 'info', topic: 'info', eventId: 2 },
      { level: 'warn', topic: 'warn', eventId: 3 },
      { level: 'error', topic: 'error', eventId: 4 },
    ];

    const filtered = selectFilteredActivity(events, 'info+');
    expect(filtered.map((event) => event.topic)).toEqual([
      'error',
      'warn',
      'info',
    ]);
  });

  it('filters and reverses activity for warn+ and error', () => {
    const events = [
      { level: 'info', topic: 'info' },
      { level: 'warn', topic: 'warn' },
      { level: 'error', topic: 'error' },
    ];

    expect(
      selectFilteredActivity(events, 'warn+').map((event) => event.topic),
    ).toEqual(['error', 'warn']);
    expect(
      selectFilteredActivity(events, 'error').map((event) => event.topic),
    ).toEqual(['error']);
  });

  it('returns all levels for all filter including unknown levels', () => {
    const events = [
      { level: 'debug', topic: 'debug' },
      { level: 'custom', topic: 'custom' },
      { level: 'info', topic: 'info' },
    ];

    expect(
      selectFilteredActivity(events, 'all').map((event) => event.topic),
    ).toEqual(['info', 'custom', 'debug']);
  });
});
