const { MultiLeaderReplica, LamportClock } = require('../multiLeaderReplica');

describe('MultiLeaderReplica & LamportClock', () => {
  test('LamportClock increments monotonically and tracks peerId', () => {
    const clock = new LamportClock('peer-desktop-1');
    expect(clock.counter).toBe(0);
    expect(clock.peerId).toBe('peer-desktop-1');

    const t1 = clock.tick();
    expect(t1.counter).toBe(1);
    expect(t1.peerId).toBe('peer-desktop-1');

    const t2 = clock.tick();
    expect(t2.counter).toBe(2);

    // Receiving remote clock that is ahead advances local clock to match it
    clock.update(10);
    expect(clock.counter).toBe(10);
    // Subsequent local event ticks to 11
    expect(clock.tick().counter).toBe(11);
  });

  test('LamportClock compares clocks deterministically with tie-breaker', () => {
    const c1 = { counter: 5, peerId: 'device-b' };
    const c2 = { counter: 4, peerId: 'device-b' };
    const c3 = { counter: 5, peerId: 'device-a' };
    const c4 = { counter: 5, peerId: 'device-b' };

    expect(LamportClock.compare(c1, c2)).toBe(1);
    expect(LamportClock.compare(c2, c1)).toBe(-1);
    // Same counter: tie broken by peerId lexicographical order
    expect(LamportClock.compare(c1, c3)).toBe(1); // 'device-b' > 'device-a'
    expect(LamportClock.compare(c3, c1)).toBe(-1);
    expect(LamportClock.compare(c1, c4)).toBe(0);
  });

  test('Autonomous local writes succeed without network connection', () => {
    const leaderA = new MultiLeaderReplica('peer-A');
    const rec1 = leaderA.setRecord('rec-1', {
      service: 'github.com',
      username: 'dev@nexvault.local',
      password: 'password-123',
      otpSecret: 'JBSWY3DPEHPK3PXP'
    });

    expect(rec1.id).toBe('rec-1');
    expect(rec1.clock.counter).toBe(1);
    expect(rec1.clock.peerId).toBe('peer-A');
    expect(rec1.isDeleted).toBe(false);

    const retrieved = leaderA.getRecord('rec-1');
    expect(retrieved.service).toBe('github.com');
  });

  test('Concurrent edits on separate leaders resolve deterministically using logical clock', () => {
    const leaderA = new MultiLeaderReplica('peer-A');
    const leaderB = new MultiLeaderReplica('peer-B');

    // Both leaders start with same initial record
    leaderA.setRecord('rec-1', { service: 'github.com', password: 'initial-pwd' });
    leaderB.applyDelta([leaderA.getRecord('rec-1')]);

    // Leader A updates offline: counter moves to 2
    leaderA.setRecord('rec-1', { service: 'github.com', password: 'pwd-from-A' });

    // Leader B updates offline twice: counter moves to 3
    leaderB.setRecord('rec-1', { service: 'github.com', password: 'pwd-from-B-v1' });
    leaderB.setRecord('rec-1', { service: 'github.com', password: 'pwd-from-B-v2' });

    // Reconcile: B has higher logical clock counter (3 > 2), B wins on both nodes
    const deltaForA = leaderB.computeDelta(leaderA.getDigest());
    leaderA.applyDelta(deltaForA);

    const deltaForB = leaderA.computeDelta(leaderB.getDigest());
    leaderB.applyDelta(deltaForB);

    expect(leaderA.getRecord('rec-1').password).toBe('pwd-from-B-v2');
    expect(leaderB.getRecord('rec-1').password).toBe('pwd-from-B-v2');
    expect(leaderA.getRecord('rec-1').clock.counter).toBe(3);
    expect(leaderB.getRecord('rec-1').clock.counter).toBe(3);
  });

  test('Tombstones propagate across all leaders and win against older writes', () => {
    const leaderA = new MultiLeaderReplica('peer-A');
    const leaderB = new MultiLeaderReplica('peer-B');

    leaderA.setRecord('rec-1', { service: 'gitlab.com', password: 'gitlab-pwd' });
    leaderB.applyDelta([leaderA.getRecord('rec-1')]);

    // Leader A deletes the record
    leaderA.deleteRecord('rec-1');
    expect(leaderA.getRecord('rec-1')).toBeNull(); // null for active query
    expect(leaderA.getRawRecord('rec-1').isDeleted).toBe(true);

    // Delta sync to Leader B
    const deltaForB = leaderA.computeDelta(leaderB.getDigest());
    leaderB.applyDelta(deltaForB);

    expect(leaderB.getRecord('rec-1')).toBeNull();
    expect(leaderB.getRawRecord('rec-1').isDeleted).toBe(true);
  });

  test('Immunity to clock skew: out-of-order physical time does not alter logical ordering', () => {
    const leaderA = new MultiLeaderReplica('peer-A');
    const leaderB = new MultiLeaderReplica('peer-B');

    // Clock counter is strictly logical, independent of system timestamp
    leaderA.setRecord('rec-skew', { service: 'skew-test', password: 'v1' });
    const delta1 = [leaderA.getRecord('rec-skew')];
    leaderB.applyDelta(delta1);

    // Even if device B's physical clock was set 5 years in the past or 5 years in the future,
    // the Lamport clock ensures that a subsequent update from B has counter > A's counter
    leaderB.setRecord('rec-skew', { service: 'skew-test', password: 'v2' });
    expect(leaderB.getRecord('rec-skew').clock.counter).toBe(2);

    leaderA.applyDelta([leaderB.getRecord('rec-skew')]);
    expect(leaderA.getRecord('rec-skew').password).toBe('v2');
  });
});
