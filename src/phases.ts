export type PhaseStatus = 'done' | 'active' | 'todo';

export interface Phase {
  id: string;
  name: string;
  status: PhaseStatus;
}

export const PHASES: readonly Phase[] = [
  { id: 'P0', name: '地基', status: 'done' },
  { id: 'P1', name: '数据层', status: 'active' },
  { id: 'P2', name: '球体', status: 'todo' },
  { id: 'P3', name: '图钉', status: 'todo' },
  { id: 'P4', name: '音频', status: 'todo' },
  { id: 'P5', name: '降落', status: 'todo' },
  { id: 'P6', name: '收尾', status: 'todo' },
];

export const STATUS_MARK: Record<PhaseStatus, string> = {
  done: '✓',
  active: '→',
  todo: '·',
};
