import { describe, it, expect } from 'vitest';
import { __NORMAL_MODE_FOR_TESTS as NORMAL, __reducerForTests as reducer } from './mobileMode';

describe('mobileMode reducer', () => {
  it('enters and exits move mode', () => {
    const s1 = reducer(NORMAL, { type: 'enterMove', taskId: 7, source: 'list' });
    expect(s1.kind).toBe('move');
    if (s1.kind !== 'move') throw new Error('type');
    expect(s1.originatingTaskId).toBe(7);
    expect(s1.source).toBe('list');
    expect(s1.groupMemberIds).toEqual([]);
    expect(s1.hasMoved).toBe(false);

    const s2 = reducer(s1, { type: 'exitMove' });
    expect(s2.kind).toBe('normal');
  });

  it('refuses to group the originating task with itself', () => {
    const s1 = reducer(NORMAL, { type: 'enterMove', taskId: 1, source: 'list' });
    const s2 = reducer(s1, { type: 'addMoveGroupMember', taskId: 1 });
    if (s2.kind !== 'move') throw new Error('type');
    expect(s2.groupMemberIds).toEqual([]);
  });

  it('adds, dedupes, and removes group members', () => {
    let s = reducer(NORMAL, { type: 'enterMove', taskId: 1, source: 'list' });
    s = reducer(s, { type: 'addMoveGroupMember', taskId: 2 });
    s = reducer(s, { type: 'addMoveGroupMember', taskId: 3 });
    s = reducer(s, { type: 'addMoveGroupMember', taskId: 2 }); // dedupe
    if (s.kind !== 'move') throw new Error('type');
    expect(s.groupMemberIds).toEqual([2, 3]);

    s = reducer(s, { type: 'removeMoveGroupMember', taskId: 2 });
    if (s.kind !== 'move') throw new Error('type');
    expect(s.groupMemberIds).toEqual([3]);

    // Cannot remove originating
    s = reducer(s, { type: 'removeMoveGroupMember', taskId: 1 });
    if (s.kind !== 'move') throw new Error('type');
    expect(s.originatingTaskId).toBe(1);
  });

  it('marks hasMoved idempotently', () => {
    let s = reducer(NORMAL, { type: 'enterMove', taskId: 1, source: 'schedule' });
    s = reducer(s, { type: 'markMoveHasMoved' });
    if (s.kind !== 'move') throw new Error('type');
    expect(s.hasMoved).toBe(true);

    const sameRef = reducer(s, { type: 'markMoveHasMoved' });
    expect(sameRef).toBe(s);
  });

  it('enters and exits resize mode', () => {
    const s1 = reducer(NORMAL, {
      type: 'enterResize',
      targetKind: 'task',
      targetId: 9,
      edge: 'top',
    });
    expect(s1.kind).toBe('resize');
    if (s1.kind !== 'resize') throw new Error('type');
    expect(s1.targetId).toBe(9);
    expect(s1.edge).toBe('top');

    const s2 = reducer(s1, { type: 'exitResize' });
    expect(s2.kind).toBe('normal');
  });

  it('enter/exit edit and bulkSelect modes are isolated', () => {
    const e1 = reducer(NORMAL, { type: 'enterEdit', taskId: 42 });
    expect(e1.kind).toBe('edit');
    const e2 = reducer(e1, { type: 'exitEdit' });
    expect(e2.kind).toBe('normal');

    const b1 = reducer(NORMAL, { type: 'enterBulkSelect' });
    expect(b1.kind).toBe('bulkSelect');
    const b2 = reducer(b1, { type: 'exitBulkSelect' });
    expect(b2.kind).toBe('normal');
  });

  it('resetToNormal always returns NORMAL', () => {
    const s1 = reducer(NORMAL, { type: 'enterMove', taskId: 1, source: 'list' });
    const s2 = reducer(s1, { type: 'resetToNormal' });
    expect(s2.kind).toBe('normal');
  });
});
