export type OperationsContext = {
  source: 'import'; sessionId: string; sessionLabel: string;
  personId?: string; assignmentId?: string; hotelId?: string; roomTypeId?: string; quotaKey?: string;
};
export type OperationsLocationState = { operationsContext?: OperationsContext };
export function recordString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) { const value = record[key]; if (typeof value === 'string' || typeof value === 'number') return String(value); }
  return undefined;
}
