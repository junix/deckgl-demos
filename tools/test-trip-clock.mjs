// Regression test for the trip playback clock: positions must depend on
// elapsed time, not on the number of animation callbacks. Run with node
// (type stripping) via `npm test`.
import assert from 'node:assert/strict';
import {
  createTripClock,
  TRIP_EXPORT_TIME,
  TRIP_LOOP_UNITS,
  TRIP_UNITS_PER_SECOND
} from '../src/tripClock.ts';

function runClock(hz, durationMs) {
  const clock = createTripClock();
  const step = 1000 / hz;
  const ticks = Math.round(durationMs / step);
  for (let index = 1; index <= ticks; index += 1) clock.tick(index * step);
  return clock.time;
}

// Equal elapsed time under simulated 30/60/120 Hz callbacks reaches an equal
// position: within one 30 Hz callback quantum of the ideal 4 s * 20 units/s.
const quantum = (1000 / 30) * (TRIP_UNITS_PER_SECOND / 1000);
const ideal = (TRIP_UNITS_PER_SECOND * 4 * 1000) / 1000;
const rates = [30, 60, 120];
const positions = new Map(rates.map(hz => [hz, runClock(hz, 4000)]));
for (const hz of rates) {
  const position = positions.get(hz);
  assert.ok(
    ideal - quantum - 1e-6 <= position && position <= ideal + 1e-6,
    `${hz} Hz clock reached ${position} after 4 s, expected ~${ideal}`
  );
}
for (const [hzA, positionA] of positions) {
  for (const [hzB, positionB] of positions) {
    assert.ok(
      Math.abs(positionA - positionB) <= quantum + 1e-9,
      `positions at ${hzA} Hz (${positionA}) and ${hzB} Hz (${positionB}) diverge beyond one callback quantum`
    );
  }
}

// Same callback count at different rates must land at different positions:
// 120 callbacks are 4 s at 30 Hz but only 1 s at 120 Hz.
assert.notEqual(runClock(30, 4000), runClock(120, 1000));

// Pausing freezes the clock and resuming never jumps over paused time.
const clock = createTripClock();
clock.tick(0);
clock.tick(1000);
assert.equal(clock.time, TRIP_UNITS_PER_SECOND);
clock.setPaused(true);
clock.tick(6000);
clock.tick(7000);
assert.equal(clock.time, TRIP_UNITS_PER_SECOND, 'paused clock kept advancing');
clock.setPaused(false);
clock.tick(7100);
assert.equal(clock.time, TRIP_UNITS_PER_SECOND + 2, 'resumed clock jumped over paused time');

// The clock wraps at the loop length instead of growing unbounded.
const wrapped = createTripClock();
wrapped.tick(0);
wrapped.tick((TRIP_LOOP_UNITS / TRIP_UNITS_PER_SECOND) * 1000 + 500);
assert.ok(Math.abs(wrapped.time - TRIP_UNITS_PER_SECOND / 2) < 1e-6, `wrap produced ${wrapped.time}`);

assert.equal(TRIP_EXPORT_TIME, 90);
console.log('trip clock: rate-independent playback, pause/resume, and wrap verified');
