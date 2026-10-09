// Trip playback clock: advances the TripsLayer currentTime by elapsed
// wall-clock time instead of callback count, so a 120 Hz display does not
// play the same trajectory twice as fast as a 60 Hz display.
export const TRIP_UNITS_PER_SECOND = 20;
export const TRIP_LOOP_UNITS = 180;
// Deterministic mid-loop timestamp pinned for export captures.
export const TRIP_EXPORT_TIME = 90;

export interface TripClock {
  readonly time: number;
  setPaused(paused: boolean): void;
  tick(now: number): void;
}

export function createTripClock(): TripClock {
  let time = 0;
  let lastTick: number | undefined;
  let paused = false;
  return {
    get time() {
      return time;
    },
    setPaused(value: boolean) {
      paused = value;
    },
    tick(now: number) {
      // While paused the baseline keeps moving so resuming never jumps ahead.
      if (!paused && lastTick !== undefined) {
        time = (time + ((now - lastTick) / 1000) * TRIP_UNITS_PER_SECOND) % TRIP_LOOP_UNITS;
      }
      lastTick = now;
    }
  };
}
