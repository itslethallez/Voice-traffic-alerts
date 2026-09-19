import type { WazeAlert } from './types';

/** Later lists win on a duplicate alert_id, though in practice duplicates should be identical. */
export function mergeAlertsById(alertLists: WazeAlert[][]): WazeAlert[] {
  const byId = new Map<string, WazeAlert>();
  for (const list of alertLists) {
    for (const alert of list) {
      byId.set(alert.alert_id, alert);
    }
  }
  return [...byId.values()];
}
