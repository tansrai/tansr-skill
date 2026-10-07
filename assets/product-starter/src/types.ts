export type Mode = 'offline' | 'platform';
export interface BusinessRecord {
  id: string; title: string; content: string; source: string;
  status: 'new' | 'reviewed' | 'resolved';
  createdAt: string; updatedAt: string;
}
export type RunStatus = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface SafeError { code: string; message: string }
export interface RunResult { text: string; readIds: string[]; toolCalls: number }
export interface Run {
  id: string; status: RunStatus; mode: Mode; recordIds: string[];
  inputRecords: BusinessRecord[]; createdAt: string; finishedAt?: string;
  result?: RunResult; error?: SafeError;
}
export interface Database {
  version: 1; revision: number; records: BusinessRecord[]; runs: Run[];
  requests: Record<string, string>;
}
export interface RunEvent {
  id: number; type: 'progress' | 'tool' | 'result' | 'error' | 'done';
  runId: string; time: string; message?: string; text?: string;
  replace?: boolean; name?: string; recordIds?: string[];
  result?: RunResult; error?: SafeError; status?: RunStatus;
}
export type EventInput = Omit<RunEvent, 'id' | 'runId' | 'time'>;
export const terminal = (status: RunStatus): boolean => !['running', 'cancelling'].includes(status);
