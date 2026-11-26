const {
  compareLogicalClocks,
  LamportClock,
  mergeCredentials,
  resolveRecordConflict
} = require('../conflictResolver');

describe('Universal Conflict Resolution Engine', () => {
  describe('compareLogicalClocks', () => {
    test('higher logical counter wins unconditionally', () => {
      const older = { counter: 5, peerId: 'device-zzz', updatedAt: 9999999999 };
      const newer = { counter: 6, peerId: 'device-aaa', updatedAt: 1000 };
      expect(compareLogicalClocks(newer, older)).toBe(1);
      expect(compareLogicalClocks(older, newer)).toBe(-1);
    });

    test('identical logical counters use deterministic peer ID tie-breaking', () => {
      const peerA = { counter: 10, peerId: 'peer-alpha' };
      const peerB = { counter: 10, peerId: 'peer-beta' };
      // 'peer-beta' > 'peer-alpha' lexicographically
      expect(compareLogicalClocks(peerB, peerA)).toBe(1);
      expect(compareLogicalClocks(peerA, peerB)).toBe(-1);
      expect(compareLogicalClocks(peerA, peerA)).toBe(0);
    });

    test('supports logicalCounter field interchangeably with counter', () => {
      const itemA = { logicalCounter: 15, peerId: 'dev-1' };
      const itemB = { counter: 12, peerId: 'dev-2' };
      expect(compareLogicalClocks(itemA, itemB)).toBe(1);
      expect(compareLogicalClocks(itemB, itemA)).toBe(-1);
    });

    test('falls back to physical timestamp when counters are identical and peerIds match', () => {
      const itemA = { counter: 0, peerId: 'same', updatedAt: 5000 };
      const itemB = { counter: 0, peerId: 'same', updatedAt: 6000 };
      expect(compareLogicalClocks(itemB, itemA)).toBe(1);
      expect(compareLogicalClocks(itemA, itemB)).toBe(-1);
    });
  });

  describe('LamportClock', () => {
    test('initializes with peerId and zero or initial counter', () => {
      const clock = new LamportClock('node-1', 4);
      expect(clock.peerId).toBe('node-1');
      expect(clock.counter).toBe(4);
    });

    test('tick increments local clock', () => {
      const clock = new LamportClock('node-1', 0);
      const res = clock.tick();
      expect(res.counter).toBe(1);
      expect(clock.counter).toBe(1);
    });

    test('update advances local clock beyond remote counter', () => {
      const clock = new LamportClock('node-1', 2);
      const res = clock.update(10);
      expect(res.counter).toBe(10);
      expect(clock.counter).toBe(10);

      // Updating with lower counter keeps existing counter
      clock.update(5);
      expect(clock.counter).toBe(10);
    });
  });

  describe('resolveRecordConflict', () => {
    test('suppressed by tombstone if tombstone clock is newer or equal', () => {
      const remoteRecord = { logicalCounter: 5, peerId: 'p1', service: 'github.com', credential: 'pass' };
      const tombstone = { logicalCounter: 6, peerId: 'p2', deletedAt: Date.now() };
      const action = resolveRecordConflict(remoteRecord, null, tombstone);
      expect(action).toBe('suppressed_by_tombstone');
    });

    test('resurrects record if remote record is strictly newer than tombstone', () => {
      const remoteRecord = { logicalCounter: 8, peerId: 'p1', service: 'github.com', credential: 'pass' };
      const tombstone = { logicalCounter: 6, peerId: 'p2', deletedAt: Date.now() };
      const action = resolveRecordConflict(remoteRecord, null, tombstone);
      expect(action).toBe('resurrect');
    });

    test('updates local record when remote record has higher logical clock', () => {
      const localRecord = { logicalCounter: 2, peerId: 'p1', credential: 'old' };
      const remoteRecord = { logicalCounter: 3, peerId: 'p2', credential: 'new' };
      const action = resolveRecordConflict(remoteRecord, localRecord, null);
      expect(action).toBe('update');
    });

    test('keeps local record when local record has higher logical clock', () => {
      const localRecord = { logicalCounter: 5, peerId: 'p1', credential: 'mine' };
      const remoteRecord = { logicalCounter: 4, peerId: 'p2', credential: 'theirs' };
      const action = resolveRecordConflict(remoteRecord, localRecord, null);
      expect(action).toBe('keep_local');
    });
  });
});
