import { DAY, type Assignment } from './types';
import { hourAt } from './farming';

// Need rates preserve game-day duration; work/door delays preserve real seconds.
export const defaultSchedule = (): Assignment[] =>
  Array.from({ length: 24 }, (_, h) => (h < 6 || h >= 22 ? 'sleep' : 'anything'));
export const assignmentAt = (schedule: Assignment[], tick: number) =>
  schedule[Math.floor(hourAt(tick))];
export const restLoss = (rest: number) =>
  (95 / DAY) * (rest < 1 ? 0.6 : rest < 14 ? 0.3 : rest < 28 ? 0.7 : 1);
export const restGain = (inBed: boolean) => (228.57144 / DAY) * (inBed ? 1 : 0.8);
export const wantsSleep = (rest: number, assignment: Assignment) =>
  rest < 1 || (assignment === 'sleep' ? rest < 75 : assignment === 'anything' && rest < 30);
export const ASSIGNMENT_NAMES: Record<Assignment, string> = {
  anything: '自由',
  work: '工作',
  sleep: '睡眠',
};
