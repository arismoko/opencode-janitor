import { LEVEL_RANK } from '../ui-constants.js';

export function selectJobCounts(repos) {
  const runningJobs = repos.reduce(
    (sum, repo) => sum + (repo.runningJobs || 0),
    0,
  );
  const queuedJobs = repos.reduce(
    (sum, repo) => sum + (repo.queuedJobs || 0),
    0,
  );

  return {
    runningJobs,
    queuedJobs,
  };
}

function minLevelForFilter(activityFilter) {
  return activityFilter === 'all'
    ? 0
    : activityFilter === 'info+'
      ? 1
      : activityFilter === 'warn+'
        ? 2
        : 3;
}

export function selectFilteredActivity(events, activityFilter) {
  const minLevel = minLevelForFilter(activityFilter);
  const result = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if ((LEVEL_RANK[event.level] ?? 0) >= minLevel) {
      result.push(event);
    }
  }
  return result;
}
