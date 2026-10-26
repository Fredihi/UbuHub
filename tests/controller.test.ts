import test from 'node:test';
import assert from 'node:assert/strict';
import { RepeatGate } from '../lib/controller';

test('direction fires immediately, waits, then repeats; release and reversal reset the delay', () => {
  const gate = new RepeatGate();
  assert.equal(gate.update(1, 0), 1);
  assert.equal(gate.update(1, 200), 0);
  assert.equal(gate.update(1, 380), 1);
  assert.equal(gate.update(1, 400), 0);
  assert.equal(gate.update(1, 525), 1);
  assert.equal(gate.update(-1, 526), -1);
  assert.equal(gate.update(0, 527), 0);
  assert.equal(gate.update(-1, 528), -1);
});
