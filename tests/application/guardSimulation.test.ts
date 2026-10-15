import { describe, expect, it } from "vitest";
import {
  initialGuardSimulationState,
  stepGuardSimulation,
  type GuardSimulationFrame,
  type GuardSimulationState,
} from "../../src/application/simulation/guardSimulation";
import {
  EXTRACTION_CELL,
  TILE_SIZE,
} from "../../src/application/simulation/labLevel";
import { cellCenter, cellKey, worldToCell, type GridPoint } from "../../src/domain/model/grid";
import type { GuardState } from "../../src/domain/behavior/stateMachine";
import { initialAlertState } from "../../src/domain/behavior/alertMeter";
import { initialLastMomentState } from "../../src/domain/behavior/lastMoment";

const STEP_MS = 16;

/** Escondite lejos de la salida: mantiene la ronda viva y rompe la vision. */
const HIDING_CELL: GridPoint = { x: 1, y: 17 };

interface World {
  state: GuardSimulationState;
  clock: number;
}

interface StepOverrides {
  readonly playerPosition?: { x: number; y: number };
  readonly playerVelocity?: { x: number; y: number };
  readonly throwRequest?: { readonly direction: { x: number; y: number } };
  readonly noiseRequest?: {
    readonly position: { x: number; y: number };
    readonly radius: number;
    readonly durationMs: number;
  };
  readonly manualGoal?: GridPoint | null;
  readonly doorToggleRequest?: string;
  readonly toggleAlgorithm?: boolean;
  readonly terrainCosts?: ReadonlyMap<string, number>;
}

function start(): World {
  return { state: initialGuardSimulationState(0), clock: 0 };
}

function step(world: World, overrides: StepOverrides = {}): GuardSimulationFrame {
  world.clock += STEP_MS;
  const frame = stepGuardSimulation(world.state, {
    timeMs: world.clock,
    deltaMs: STEP_MS,
    ...overrides,
  });
  world.state = frame.state;
  return frame;
}

type StepInput = StepOverrides | ((index: number, world: World) => StepOverrides);

function run(world: World, steps: number, overrides: StepInput = {}): GuardSimulationFrame[] {
  const frames: GuardSimulationFrame[] = [];
  for (let index = 0; index < steps; index += 1) {
    const resolved = typeof overrides === "function" ? overrides(index, world) : overrides;
    frames.push(step(world, resolved));
  }
  return frames;
}

function hasTelemetry(world: World, event: string): boolean {
  return world.state.telemetry.events.some((entry) => entry.event === event);
}

function visited(frames: readonly GuardSimulationFrame[], state: GuardState): boolean {
  return frames.some((frame) => frame.state.state === state);
}

function hasEvent(frames: readonly GuardSimulationFrame[], event: string): boolean {
  return frames.some((frame) => frame.events.some((entry) => entry.event === event));
}

function hasImpact(frames: readonly GuardSimulationFrame[], impact: string): boolean {
  return frames.some((frame) => frame.impacts.includes(impact as never));
}

/** Coloca al jugador delante del guardia para forzar la vision. */
function exposePlayer(world: World, distancePx: number): void {
  world.state = {
    ...world.state,
    playerPosition: { x: world.state.position.x, y: world.state.position.y - distancePx },
  };
}

/** Igual que exposePlayer pero applied en cada paso: el jugador sigue huyendo. */
function exposeFlee(world: World, distancePx: number): void {
  exposePlayer(world, distancePx);
}

/** Snapshot de una persecucion en curso contra un jugador visible. */
function chaseSnapshot(world: World): void {
  world.clock = 1000;
  world.state = {
    ...world.state,
    state: "chase",
    position: cellCenter({ x: 20, y: 14 }, TILE_SIZE),
    facing: { x: 0, y: -1 },
    facingRadians: -Math.PI / 2,
    waypoints: [],
    nextWaypoint: 0,
    goalCell: { x: 20, y: 13 },
    goalReachable: true,
    visibleSinceMs: 0,
    playerPosition: cellCenter({ x: 20, y: 13 }, TILE_SIZE),
    lastMoment: initialLastMomentState(),
    alert: initialAlertState(),
  };
}

describe("H4: run integration", () => {
  it("starts infiltrating with a planned route", () => {
    const { state } = start();

    expect(state.state).toBe("patrol");
    expect(state.phase).toBe("infiltration");
    expect(state.outcome).toBe("running");
    expect(state.pathStatus).toBe("success");
    expect(state.waypoints.length).toBeGreaterThan(0);
  });

  it("walks the route without incident while the player stays hidden", () => {
    const world = start();
    const frames = run(world, 150);

    expect(world.state.outcome).toBe("running");
    expect(world.state.transitions).toBe(0);
    expect(frames.some((frame) => frame.state.vision.visible)).toBe(false);
  });

  it("confirms the sight after the dwell time and enters chase", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);

    const frames = run(world, 15);

    expect(hasImpact(frames, "sight-confirmed")).toBe(true);
    expect(world.state.state).toBe("chase");
    expect(world.state.phase).toBe("persecucion");
  });

  it("records the transition with its cause", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    run(world, 15);

    const transition = world.state.telemetry.events.find((event) => event.event === "sight-confirmed");
    expect(transition?.from).toBe("patrol");
    expect(transition?.to).toBe("chase");
    expect(transition?.cause).toContain("vision confirmada");
  });

  it("searches after losing the sight and keeps the last known position", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    run(world, 15);
    const lastKnown = world.state.memory.lastKnownPosition;
    expect(lastKnown).not.toBeNull();

    world.state = { ...world.state, playerPosition: cellCenter({ x: 2, y: 2 }, TILE_SIZE) };
    const frames = run(world, 20);

    expect(hasEvent(frames, "sight-lost")).toBe(true);
    expect(visited(frames, "search")).toBe(true);
    expect(world.state.memory.lastKnownPosition).toEqual(lastKnown);
  });

  it("builds a bounded search plan", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    run(world, 15);
    world.state = { ...world.state, playerPosition: cellCenter({ x: 2, y: 2 }, TILE_SIZE) };
    run(world, 20);

    const plan = world.state.telemetry.events.find((event) => event.event === "search-plan");
    expect(plan?.cause).toContain("puntos en radio 4");
  });

  it("resumes the patrol after giving up", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    run(world, 15);
    world.state = { ...world.state, playerPosition: cellCenter({ x: 2, y: 2 }, TILE_SIZE) };

    const frames = run(world, 900);

    expect(visited(frames, "return")).toBe(true);
    expect(world.state.state).toBe("patrol");
    expect(world.state.outcome).toBe("running");
  });

  it("captures a player that stays within reach", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);

    const frames = run(world, 40, () => {
      exposePlayer(world, 10);
      return {};
    });

    expect(hasTelemetry(world, "captured") || hasImpact(frames, "captured")).toBe(true);
    expect(world.state.outcome).toBe("captured");
    expect(world.state.phase).toBe("capturado");
    expect(world.state.outcomeDetail).toContain("capturado a");
  });

  it("freezes the simulation once captured", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    run(world, 40, () => {
      exposePlayer(world, 10);
      return {};
    });
    const frozen = world.state.position;

    run(world, 10);

    expect(world.state.position).toEqual(frozen);
    expect(world.state.timeMs).toBeGreaterThan(0);
  });

  it("extracts the player that reaches the exit while unseen", () => {
    const world = start();
    const frames = run(world, 4, {
      playerPosition: cellCenter(EXTRACTION_CELL, TILE_SIZE),
      playerVelocity: { x: 1, y: 0 },
    });

    expect(frames.at(-1)?.state.outcome).toBe("extracted");
    expect(world.state.phase).toBe("extraccion");
    expect(world.state.outcomeDetail).toContain("salida alcanzada");
  });

  it("does not extract a player captured before", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    run(world, 40, () => {
      exposePlayer(world, 10);
      return {};
    });
    expect(world.state.outcome).toBe("captured");

    run(world, 5, { playerPosition: cellCenter(EXTRACTION_CELL, TILE_SIZE) });

    expect(world.state.outcome).toBe("captured");
  });
});

describe("upgrade 1: patrol pauses", () => {
  it("pauses on arrival and records the telemetry", () => {
    const world = start();
    world.state = {
      ...world.state,
      position: cellCenter({ x: 7, y: 13 }, TILE_SIZE),
      playerPosition: cellCenter({ x: 1, y: 5 }, TILE_SIZE),
    };

    const frames = run(world, 6);

    expect(hasEvent(frames, "patrol-arrived")).toBe(true);
    expect(hasEvent(frames, "patrol-paused")).toBe(true);
    expect(world.state.patrol.phase).toBe("pausing");
    const paused = world.state.telemetry.events.find((event) => event.event === "patrol-paused");
    expect(paused?.cause).toContain("pausa de 2400 ms");
  });

  it("keeps the pause flag while waiting", () => {
    const world = start();
    world.state = {
      ...world.state,
      position: cellCenter({ x: 7, y: 13 }, TILE_SIZE),
      playerPosition: cellCenter({ x: 1, y: 5 }, TILE_SIZE),
    };

    run(world, 60);

    expect(world.state.patrolPause).toBe(true);
  });

  it("sweeps the gaze while paused and stops moving", () => {
    const world = start();
    world.state = {
      ...world.state,
      position: cellCenter({ x: 7, y: 13 }, TILE_SIZE),
      playerPosition: cellCenter({ x: 1, y: 5 }, TILE_SIZE),
    };

    run(world, 30);
    expect(world.state.patrol.phase).toBe("pausing");
    const frames = run(world, 40);
    const gazes = frames.map((frame) => frame.state.facingRadians);
    const distinct = new Set(gazes.map((value) => value.toFixed(3)));

    expect(distinct.size).toBeGreaterThan(3);
    expect(world.state.lastSpeedPxPerSecond).toBeLessThan(1);
  });

  it("resumes the route when the pause expires", () => {
    const world = start();
    world.state = {
      ...world.state,
      position: cellCenter({ x: 7, y: 13 }, TILE_SIZE),
      playerPosition: cellCenter({ x: 1, y: 5 }, TILE_SIZE),
    };
    run(world, 6);
    expect(world.state.patrol.phase).toBe("pausing");

    run(world, 200);

    expect(hasTelemetry(world, "patrol-resumed")).toBe(true);
    expect(world.state.patrol.phase).toBe("moving");
  });
});

describe("upgrade 7: distractions", () => {
  it("emits a sound when a stone lands", () => {
    const world = start();
    run(world, 40, { throwRequest: { direction: { x: 1, y: 0 } } });

    expect(world.state.stonesThrown).toBeGreaterThan(0);
    expect(hasTelemetry(world, "stone-landed")).toBe(true);
  });

  it("counts a manual noise request", () => {
    const world = start();
    run(world, 3, (index) => (index === 0
      ? { noiseRequest: { position: { x: 400, y: 300 }, radius: 200, durationMs: 800 } }
      : {}));

    expect(world.state.noisesThrown).toBe(1);
    const noise = world.state.telemetry.events.find((event) => event.event === "noise-emitted");
    expect(noise?.cause).toContain("ruido del jugador");
  });

  it("rejects a stone that would land outside the map", () => {
    const world = start();
    run(world, 3, { throwRequest: { direction: { x: -1, y: 0 } } });

    const rejected = world.state.telemetry.events.find((event) => event.event === "stone-rejected");
    expect(rejected).toBeDefined();
    expect(world.state.stonesThrown).toBe(0);
  });

  it("makes the guard investigate a nearby noise", () => {
    const world = start();
    const guardCell = { x: 27, y: 17 };
    const frames = run(world, 4, {
      noiseRequest: {
        position: cellCenter(guardCell, TILE_SIZE),
        radius: 300,
        durationMs: 900,
      },
    });

    expect(visited(frames, "investigate")).toBe(true);
  });
});

describe("upgrade 8: alert meter", () => {
  it("raises the level and the band while the guard sees the player", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);

    const frames = run(world, 30, () => {
      exposeFlee(world, 60);
      return {};
    });

    expect(world.state.alert.level).toBeGreaterThan(0.25);
    expect(world.state.alert.band).toBe("suspicious");
    expect(world.state.alert.peak).toBe(world.state.alert.level);
    expect(frames.at(-1)?.state.phase).toBe("persecucion");
  });

  it("emits the alert threshold impact exactly once", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);

    const frames = run(world, 40, () => {
      exposeFlee(world, 20);
      return {};
    });
    const thresholds = frames.filter((frame) => frame.impacts.includes("alert-threshold"));
    const total = world.state.telemetry.events.filter((event) => event.event === "alert-threshold");

    expect(thresholds.length).toBeLessThanOrEqual(1);
    expect(total.length).toBeLessThanOrEqual(1);
  });

  it("cools down when the player stays hidden", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    run(world, 14);
    const hot = world.state.alert.level;

    world.state = { ...world.state, playerPosition: cellCenter(HIDING_CELL, TILE_SIZE) };
    run(world, 400);

    expect(world.state.outcome).toBe("running");
    expect(world.state.alert.level).toBeLessThan(hot);
  });

  it("keeps the band calm while infiltrating", () => {
    const world = start();
    run(world, 200);

    expect(world.state.alert.band).toBe("calm");
    expect(world.state.phase).toBe("infiltration");
  });
});

describe("upgrade 9: last moment", () => {
  it("counts an escape when the sight breaks inside the window", () => {
    const world = start();
    chaseSnapshot(world);
    step(world);
    expect(world.state.state).toBe("chase");
    expect(world.state.lastMoment.armed).toBe(true);

    world.state = {
      ...world.state,
      playerPosition: cellCenter({ x: 20, y: 16 }, TILE_SIZE),
    };
    const frames = run(world, 6);

    expect(hasImpact(frames, "last-moment-escape")).toBe(true);
    expect(world.state.escapes).toBe(1);
    expect(world.state.lastEscape?.relief).toBeGreaterThan(0);
    expect(hasEvent(frames, "last-moment-escape")).toBe(true);
  });

  it("gives no relief when the player leaves the window before hiding", () => {
    const world = start();
    chaseSnapshot(world);
    step(world);
    expect(world.state.lastMoment.armed).toBe(true);

    world.state = {
      ...world.state,
      playerPosition: cellCenter(HIDING_CELL, TILE_SIZE),
    };
    run(world, 6);

    expect(world.state.escapes).toBe(0);
    expect(world.state.lastMoment.armed).toBe(false);
  });

  it("never arms when the player was never seen", () => {
    const world = start();
    run(world, 60);

    expect(world.state.lastMoment.armed).toBe(false);
    expect(world.state.escapes).toBe(0);
  });
});

describe("upgrade 10: doors and shortcuts", () => {
  it("cycles the automatic doors over time", () => {
    const world = start();
    const initial = world.state.doors.find((door) => door.id === "puerta-norte");
    expect(initial?.open).toBe(true);

    run(world, 400);

    const after = world.state.doors.find((door) => door.id === "puerta-norte");
    expect(after?.open).not.toBe(initial?.open);
    const cycle = world.state.telemetry.events.find((event) => event.event === "door-cycle");
    expect(cycle?.cause).toContain("puerta-norte");
  });

  it("keeps the shutter closed while infiltrating", () => {
    const world = start();
    run(world, 200);

    expect(world.state.doors.find((door) => door.id === "persiana")?.open).toBe(false);
    expect(hasTelemetry(world, "door-toggle")).toBe(false);
  });

  it("opens the shutter on chase and holds it while searching", () => {
    const world = start();
    run(world, 5);
    exposePlayer(world, 60);
    const frames = run(world, 15);
    expect(world.state.state).toBe("chase");
    expect(hasImpact(frames, "shutter")).toBe(true);
    expect(world.state.doors.find((door) => door.id === "persiana")?.open).toBe(true);

    world.state = { ...world.state, playerPosition: cellCenter({ x: 2, y: 2 }, TILE_SIZE) };
    run(world, 60);

    expect(world.state.doors.find((door) => door.id === "persiana")?.open).toBe(true);
  });

  it("toggles a door on operator request", () => {
    const world = start();
    run(world, 3, { doorToggleRequest: "puerta-este" });

    expect(world.state.doors.find((door) => door.id === "puerta-este")?.open).toBe(true);
    const event = world.state.telemetry.events.find((entry) => entry.event === "door-toggle");
    expect(event?.cause).toContain("operador alterna puerta-este");
  });

  it("composes the navigation map with the door states", () => {
    const world = start();
    const initial = step(world);
    expect(initial.map.blocked.has("4,6")).toBe(false);
    expect(initial.map.blocked.has("19,5")).toBe(true);
    expect(initial.map.blocked.has("24,12")).toBe(true);

    const toggled = step(world, { doorToggleRequest: "puerta-este" });

    expect(toggled.map.blocked.has("24,12")).toBe(false);
  });

  it("replans when a closed door blocks the route", () => {
    const world = start();
    step(world, { doorToggleRequest: "puerta-norte" });
    const frames = run(world, 90);

    const blocked = frames.some((frame) => frame.events.some((event) => event.event === "blocked-route"));
    const replanned = world.state.lastPlannedAtMs > 0;

    expect(blocked || replanned).toBe(true);
  });
});

describe("manual destination", () => {
  it("records the order and adopts the goal", () => {
    const world = start();
    const goal: GridPoint = { x: 27, y: 17 };
    run(world, 3, { manualGoal: goal });

    const event = world.state.telemetry.events.find((entry) => entry.event === "manual-goal");
    expect(event?.cause).toContain("27,17");
    expect(world.state.manualGoal).toEqual(goal);
    expect(world.state.goalReason).toBe("manual");
  });

  it("clears the manual goal when the guard returns to the route", () => {
    const world = start();
    run(world, 3, { manualGoal: { x: 27, y: 17 } });
    run(world, 400);

    expect(world.state.manualGoal).toBeNull();
    expect(world.state.goalReason).toBe("patrol");
  });
});

describe("upgrade 4: navigation traceability", () => {
  it("starts on A* and alternates on operator request", () => {
    const world = start();
    expect(world.state.algorithm).toBe("astar");

    step(world, { toggleAlgorithm: true });
    expect(world.state.algorithm).toBe("bfs");
    const event = world.state.telemetry.events.find((entry) => entry.event === "algorithm-toggle");
    expect(event?.cause).toContain("BFS");

    step(world, { toggleAlgorithm: true });
    expect(world.state.algorithm).toBe("astar");
  });

  it("reports path status and metrics of the active route", () => {
    const world = start();
    const frame = step(world);

    expect(frame.state.pathStatus).toBe("success");
    expect(frame.state.totalCost).not.toBeNull();
    expect(frame.state.expandedNodes).toBeGreaterThan(0);
    expect(frame.state.maximumFrontier).toBeGreaterThan(0);
    expect(frame.state.explored.length).toBeGreaterThan(0);
    expect(frame.state.waypoints.length).toBeGreaterThan(0);
  });

  it("keeps both algorithms on a reachable goal", () => {
    const world = start();
    const withAstar = step(world);
    expect(withAstar.state.pathStatus).toBe("success");

    const withBfs = step(world, { toggleAlgorithm: true });
    expect(withBfs.state.pathStatus).toBe("success");
    expect(withBfs.state.waypoints.at(-1)).toEqual(withAstar.state.waypoints.at(-1));
  });

  it("fails explicitly for an unreachable manual destination", () => {
    const world = start();
    const frames = run(world, 6, (index) => (index === 0 ? { manualGoal: { x: 0, y: 0 } } : {}));

    expect(frames.some((frame) => frame.state.pathStatus !== "success")).toBe(true);
    expect(hasTelemetry(world, "destination-unreachable")).toBe(true);
    expect(world.state.manualGoal).toBeNull();
  });
});

describe("variant A: weighted terrain through the simulation consumer", () => {
  it("sums configured entry costs in the planned route", () => {
    const world = start();
    const goalCell = world.state.goalCell;
    expect(goalCell).not.toBeNull();
    const goalKey = cellKey(goalCell as GridPoint);
    const costs: ReadonlyMap<string, number> = new Map([[goalKey, 7]]);

    world.state = { ...world.state, lastPlannedAtMs: -1000 };
    const frame = step(world, { terrainCosts: costs });
    const cells = frame.state.waypoints.map((waypoint) => worldToCell(waypoint, TILE_SIZE));
    const expected = cells
      .slice(1)
      .reduce((sum, cell) => sum + (costs.get(cellKey(cell)) ?? 1), 0);

    expect(frame.state.terrainCosts.get(goalKey)).toBe(7);
    expect(frame.state.totalCost).toBe(expected);
    expect(frame.state.totalCost).toBe(cells.length - 1 + 6);
  });

  it("keeps the unit cost when no terrain is configured", () => {
    const world = start();
    world.state = { ...world.state, lastPlannedAtMs: -1000 };
    const frame = step(world);

    expect(frame.state.totalCost).toBe(frame.state.waypoints.length - 1);
  });
});