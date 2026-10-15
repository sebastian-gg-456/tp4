import { assessCover, type CoverAssessment } from "../../domain/behavior/cover";
import {
  createAlertConfig,
  initialAlertState,
  updateAlert,
  type AlertBand,
  type AlertConfig,
  type AlertState,
} from "../../domain/behavior/alertMeter";
import {
  initialLastMomentState,
  updateLastMoment,
  type LastMomentEscape,
  type LastMomentState,
} from "../../domain/behavior/lastMoment";
import {
  advancePatrol,
  currentPatrolCell,
  currentPatrolPoint,
  degreesToRadians,
  initialPatrolCursor,
  patrolGazeRadians,
  type PatrolCursor,
} from "../../domain/behavior/patrol";
import {
  decide,
  distanceToCell,
  sameCell,
  type GuardContext,
  type GuardDecision,
  type GuardState,
  type GoalReason,
} from "../../domain/behavior/stateMachine";
import {
  planSearch,
  searchExpired,
  searchPointAt,
  type SearchPlan,
} from "../../domain/behavior/search";
import {
  advanceDoors,
  composeNavigationMap,
  initialDoors,
  toggleDoor,
  validateDoorSpecs,
  type DoorRuntime,
} from "../../domain/environment/doors";
import { cellCenter, withEntryCosts, worldToCell, type GridMap, type GridPoint } from "../../domain/model/grid";
import { distanceBetween, type Vector2 } from "../../domain/model/vector";
import {
  findPathAStar,
  findPathBfs,
  type SearchAlgorithm,
  type SearchResult,
} from "../../domain/navigation/search";
import { timeSinceLastPerception, type PerceptionMemory } from "../../domain/perception/memory";
import type { VisionResult } from "../../domain/perception/perception";
import {
  emptyTelemetryLog,
  pushTelemetry,
  type TelemetryEvent,
  type TelemetryLog,
} from "../../domain/telemetry/telemetry";
import {
  DISTRACTION_CAPACITY,
  impactWorldPoint,
  initialDistractorState,
  throwDistraction,
  updateDistractors,
  type DistractorState,
} from "./distractors";
import { advanceGuard } from "./locomotion";
import {
  DOOR_SPECS,
  EXTRACTION_CELL,
  GUARD_START,
  LAB_MAP,
  PATROL_ROUTE,
  PLAYER_START,
  RETURN_POINT,
  TILE_SIZE,
} from "./labLevel";
import {
  initialPerceptionState,
  updatePerceptionSimulation,
  withSoundEvent,
  type PerceptionSimulationState,
} from "./perceptionSimulation";

export const SOUND_RADIUS = 190;
export const SOUND_DURATION_MS = 800;
export const STONE_RADIUS_PX = 160;
export const STONE_DURATION_MS = 600;
export const STONE_SPEED = 320;
export const STONE_FLIGHT_MS = 380;
export const VISION_RANGE = 220;
export const FIELD_OF_VIEW = Math.PI / 2;
export const EXTRACTION_RADIUS_PX = 20;

const CAPTURE_RADIUS = 20;
const LAST_MOMENT_RADIUS = 78;
const CONFIRM_MS = 180;
const SEARCH_DURATION_MS = 6000;
const SEARCH_RADIUS_CELLS = 4;
const SEARCH_POINT_COUNT = 4;
const REPLAN_INTERVAL_MS = 400;
const COVER_RADIUS_CELLS = 5;
const GOAL_TOLERANCE_PX = TILE_SIZE * 0.45;

/** Velocidad base del guardia por conducta (px/s). */
const SPEED_BY_STATE: Readonly<Record<GuardState, number>> = {
  patrol: 105,
  investigate: 128,
  chase: 168,
  search: 116,
  return: 118,
  captured: 0,
};

/** Upgrade 8: la banda de alerta modifica la velocidad del guardia. */
const SPEED_BY_BAND: Readonly<Record<AlertBand, number>> = {
  calm: 1,
  suspicious: 1.06,
  alert: 1.14,
};

export type LevelPhase =
  | "infiltration"
  | "suspicion"
  | "alerta"
  | "persecucion"
  | "busqueda"
  | "capturado"
  | "extraccion";

export type ScreenImpact =
  | "sight-confirmed"
  | "last-moment-escape"
  | "captured"
  | "extracted"
  | "shutter"
  | "alert-threshold";

export interface GuardSimulationState {
  readonly timeMs: number;
  readonly position: Vector2;
  readonly facing: Vector2;
  readonly facingRadians: number;
  readonly state: GuardState;
  readonly enteredStateAtMs: number;
  readonly goalCell: GridPoint | null;
  readonly goalReason: GoalReason | null;
  readonly goalReachable: boolean;
  readonly waypoints: readonly Vector2[];
  readonly nextWaypoint: number;
  readonly lastPlannedGoal: GridPoint | null;
  readonly lastPlannedAtMs: number;
  readonly pathStatus: SearchResult["status"];
  /** Algoritmo con el que se calculo la ruta activa (H3, conmutable con Espacio). */
  readonly algorithm: SearchAlgorithm;
  readonly totalCost: number | null;
  readonly expandedNodes: number;
  readonly maximumFrontier: number;
  readonly explored: readonly GridPoint[];
  readonly visibleSinceMs: number | null;
  readonly patrol: PatrolCursor;
  readonly patrolPause: boolean;
  readonly search: SearchPlan | null;
  readonly searchIndex: number;
  readonly manualGoal: GridPoint | null;
  readonly lastSpeedPxPerSecond: number;
  readonly memory: PerceptionMemory;
  readonly vision: VisionResult;
  readonly doors: readonly DoorRuntime[];
  readonly alert: AlertState;
  readonly lastMoment: LastMomentState;
  readonly perception: PerceptionSimulationState;
  readonly distractors: DistractorState;
  readonly playerPosition: Vector2;
  readonly playerFacing: Vector2;
  /** Configuracion explicita del modo ponderado (variante A). Vacio = unitario. */
  readonly terrainCosts: ReadonlyMap<string, number>;
  readonly escapes: number;
  readonly lastEscape: LastMomentEscape | null;
  readonly transitions: number;
  readonly noisesThrown: number;
  readonly stonesThrown: number;
  readonly telemetry: TelemetryLog;
  readonly phase: LevelPhase;
  readonly outcome: "running" | "captured" | "extracted";
  readonly outcomeAtMs: number | null;
  readonly outcomeDetail: string;
}

export interface GuardSimulationInput {
  readonly timeMs: number;
  readonly deltaMs: number;
  readonly playerPosition?: Vector2;
  readonly playerVelocity?: Vector2;
  readonly throwRequest?: { readonly direction: Vector2 };
  readonly noiseRequest?: { readonly position: Vector2; readonly radius: number; readonly durationMs: number };
  readonly manualGoal?: GridPoint | null;
  readonly doorToggleRequest?: string;
  /** Conmuta BFS/A* para inspeccionar el algoritmo desde la escena (H3). */
  readonly toggleAlgorithm?: boolean;
  /** Activa el terreno lento (variante A) sin crear una interfaz nueva. */
  readonly terrainCosts?: ReadonlyMap<string, number>;
}

export interface GuardSimulationFrame {
  readonly state: GuardSimulationState;
  readonly map: GridMap;
  readonly cover: CoverAssessment;
  readonly impacts: readonly ScreenImpact[];
  readonly events: readonly TelemetryEvent[];
  readonly doorChanges: readonly string[];
  readonly soundHeard: boolean;
  readonly memoryAgeMs: number | null;
  readonly distanceToPlayer: number;
  readonly distanceToCover: number | null;
}

export const ALERT_CONFIG: AlertConfig = createAlertConfig();

validateDoorSpecs(LAB_MAP, DOOR_SPECS);

export function initialGuardSimulationState(timeMs = 0): GuardSimulationState {
  const doors = initialDoors(DOOR_SPECS);
  const map = composeNavigationMap(LAB_MAP, doors);
  const patrol = initialPatrolCursor(PATROL_ROUTE, 0);
  const goalCell = currentPatrolCell(PATROL_ROUTE, patrol);
  const path = findPathAStar(map, GUARD_START, goalCell);

  return {
    timeMs,
    position: cellCenter(GUARD_START, TILE_SIZE),
    facing: { x: 0, y: -1 },
    facingRadians: -Math.PI / 2,
    state: "patrol",
    enteredStateAtMs: timeMs,
    goalCell,
    goalReason: "patrol",
    goalReachable: path.status === "success",
    waypoints: path.status === "success"
      ? path.path.map((cell) => cellCenter(cell, TILE_SIZE))
      : [],
    nextWaypoint: 0,
    lastPlannedGoal: goalCell,
    lastPlannedAtMs: timeMs,
    pathStatus: path.status,
    algorithm: "astar",
    totalCost: path.totalCost,
    expandedNodes: path.expandedNodes,
    maximumFrontier: path.maximumFrontier,
    explored: path.explored,
    visibleSinceMs: null,
    patrol,
    patrolPause: false,
    search: null,
    searchIndex: 0,
    manualGoal: null,
    lastSpeedPxPerSecond: 0,
    memory: initialPerceptionState().memory,
    vision: { visible: false, reason: "out-of-range", distance: 0 },
    doors,
    alert: initialAlertState(),
    lastMoment: initialLastMomentState(),
    perception: initialPerceptionState(),
    distractors: initialDistractorState(timeMs),
    playerPosition: cellCenter(PLAYER_START, TILE_SIZE),
    playerFacing: { x: 1, y: 0 },
    terrainCosts: new Map(),
    escapes: 0,
    lastEscape: null,
    transitions: 0,
    noisesThrown: 0,
    stonesThrown: 0,
    telemetry: emptyTelemetryLog(),
    phase: "infiltration",
    outcome: "running",
    outcomeAtMs: null,
    outcomeDetail: "",
  };
}

export function stepGuardSimulation(
  previous: GuardSimulationState,
  input: GuardSimulationInput,
): GuardSimulationFrame {
  const { timeMs, deltaMs } = input;
  const events: TelemetryEvent[] = [];
  const impacts: ScreenImpact[] = [];
  let state = previous;
  if (input.terrainCosts !== undefined) {
    state = { ...state, terrainCosts: input.terrainCosts };
  }
  let map = applyTerrainCosts(composeNavigationMap(LAB_MAP, state.doors), state.terrainCosts);

  const playerPosition = input.playerPosition ?? previous.playerPosition;
  const playerFacing = resolveFacing(input.playerVelocity, previous.playerFacing);

  if (state.outcome !== "running") {
    return {
      state,
      map,
      cover: assessCover(LAB_MAP, map, TILE_SIZE, state.position, playerPosition, COVER_RADIUS_CELLS),
      impacts,
      events,
      doorChanges: [],
      soundHeard: false,
      memoryAgeMs: timeSinceLastPerception(state.memory, state.timeMs),
      distanceToPlayer: distanceBetween(state.position, playerPosition),
      distanceToCover: null,
    };
  }

  // 1. Puertas, atajos y rutas bloqueables (upgrade 10).
  const doorStep = advanceDoors(state.doors, deltaMs, {
    requestShutter: state.state === "chase",
    holdShutter: state.state === "search" || state.state === "return",
  });
  const toggled = input.doorToggleRequest === undefined
    ? doorStep.doors
    : toggleDoor(doorStep.doors, input.doorToggleRequest);
  state = { ...state, doors: toggled };
  map = applyTerrainCosts(composeNavigationMap(LAB_MAP, state.doors), state.terrainCosts);

  // H3: el operador puede alternar BFS/A* para inspeccionar ambos algoritmos.
  if (input.toggleAlgorithm) {
    const algorithm: SearchAlgorithm = state.algorithm === "astar" ? "bfs" : "astar";
    state = { ...state, algorithm };
    events.push({
      atMs: timeMs,
      kind: "navigation",
      from: null,
      to: null,
      event: "algorithm-toggle",
      cause: `operador cambia a ${algorithm.toUpperCase()}`,
    });
  }

  if (doorStep.shutterOpened) {
    impacts.push("shutter");
  }
  if (input.doorToggleRequest !== undefined && toggled !== doorStep.doors) {
    const door = state.doors.find((candidate) => candidate.id === input.doorToggleRequest);
    events.push({
      atMs: timeMs,
      kind: "level",
      from: null,
      to: null,
      event: "door-toggle",
      cause: `operador alterna ${input.doorToggleRequest} a ${door?.open ? "abierta" : "cerrada"}`,
    });
  }
  if (doorStep.changedIds.length > 0) {
    events.push({
      atMs: timeMs,
      kind: "level",
      from: null,
      to: null,
      event: "door-cycle",
      cause: doorStep.changedIds
        .map((id) => {
          const door = state.doors.find((candidate) => candidate.id === id);
          return `${id} ${door?.open ? "abierta" : "cerrada"}`;
        })
        .join(" | "),
    });
  }

  // 2. Intencion del jugador: ruido, piedra, destino manual.
  if (input.noiseRequest) {
    state = {
      ...state,
      perception: withSoundEvent(state.perception, {
        position: input.noiseRequest.position,
        radius: input.noiseRequest.radius,
        emittedAtMs: timeMs,
        durationMs: input.noiseRequest.durationMs,
      }),
      noisesThrown: state.noisesThrown + 1,
    };
    events.push(distractionEvent(timeMs, "noise-emitted", "ruido del jugador", input.noiseRequest.position));
  }

  if (input.throwRequest) {
    const impact = predictImpact(map, TILE_SIZE, playerPosition, input.throwRequest.direction);
    if (impact) {
      const thrown = throwDistraction(
        state.distractors,
        playerPosition,
        input.throwRequest.direction,
        timeMs,
        {
          id: "piedra",
          speedPxPerSecond: STONE_SPEED,
          timeToImpactMs: STONE_FLIGHT_MS,
          radiusPx: STONE_RADIUS_PX,
          durationMs: STONE_DURATION_MS,
          gravityPxPerSecondSquared: 240,
          elevationPx: 10,
        },
      );
      state = { ...state, distractors: thrown.state, stonesThrown: state.stonesThrown + 1 };
      events.push(distractionEvent(timeMs, "stone-thrown", "piedra lanzada", impact));
    } else {
      events.push({
        atMs: timeMs,
        kind: "distractor",
        from: null,
        to: null,
        event: "stone-rejected",
        cause: "el impacto previsto cae fuera del mapa",
      });
    }
  }

  const distractionFrame = updateDistractors(state.distractors, timeMs);
  state = { ...state, distractors: distractionFrame.state };
  for (const landed of distractionFrame.landed) {
    const point = impactWorldPoint(landed, TILE_SIZE);
    state = {
      ...state,
      perception: withSoundEvent(state.perception, {
        position: point,
        radius: STONE_RADIUS_PX,
        emittedAtMs: timeMs,
        durationMs: STONE_DURATION_MS,
      }),
    };
    events.push(distractionEvent(timeMs, "stone-landed", "impacto de piedra", point));
  }

  if (input.manualGoal !== undefined && input.manualGoal !== null) {
    state = { ...state, manualGoal: input.manualGoal };
    events.push({
      atMs: timeMs,
      kind: "manual",
      from: null,
      to: null,
      event: "manual-goal",
      cause: `destino manual en ${input.manualGoal.x},${input.manualGoal.y}`,
    });
  }

  // 3. Percepcion: vision con oclusion y sonido concurrente.
  const perceptionFrame = updatePerceptionSimulation(state.perception, {
    map,
    tileSize: TILE_SIZE,
    observer: state.position,
    facing: state.facing,
    target: playerPosition,
    visionRange: VISION_RANGE,
    fieldOfViewRadians: FIELD_OF_VIEW,
    timeMs,
  });
  state = {
    ...state,
    perception: perceptionFrame.state,
    memory: perceptionFrame.state.memory,
    vision: perceptionFrame.vision,
    visibleSinceMs: perceptionFrame.vision.visible ? (state.visibleSinceMs ?? timeMs) : null,
  };

  // 4. Medidor de alerta y banda (upgrade 8).
  const previousBand = state.alert.band;
  const alert = updateAlert(ALERT_CONFIG, state.alert, {
    timeMs,
    deltaMs,
    visionVisible: perceptionFrame.vision.visible,
    visionDistance: perceptionFrame.vision.distance,
    visionRange: VISION_RANGE,
    soundHeard: perceptionFrame.soundHeard,
    searching: state.state === "search",
  });
  state = { ...state, alert };
  if (previousBand !== "alert" && alert.band === "alert") {
    impacts.push("alert-threshold");
    events.push({
      atMs: timeMs,
      kind: "level",
      from: null,
      to: null,
      event: "alert-threshold",
      cause: "el medidor de alerta supera el umbral de alerta",
    });
  }

  // 5. Ventana de escape de ultimo momento (upgrade 9).
  const distanceToPlayer = distanceBetween(state.position, playerPosition);
  const previousEscapes = state.escapes;
  // La ventana se arma con vision continua: hay que leer el flag previo al
  // update, porque `updateLastMoment` ya lo desarma en el tick en que se rompe.
  const windowWasArmed = state.lastMoment.armed;
  const lastMoment = updateLastMoment(state.lastMoment, {
    timeMs,
    chasing: state.state === "chase",
    visionVisible: perceptionFrame.vision.visible,
    distancePx: distanceToPlayer,
    lastMomentRadius: LAST_MOMENT_RADIUS,
    captureRadius: CAPTURE_RADIUS,
  });
  // El modulo de ultimo momento decide si la rotura de vision cuenta como
  // escape: solo si la ventana estaba armada y el jugador sigue dentro del
  // radio. Si se salvo pordistance, es una huida normal y no un escape.
  const lastMomentBroken = windowWasArmed && lastMoment.escapes > previousEscapes;
  state = { ...state, lastMoment, escapes: lastMoment.escapes, lastEscape: lastMoment.lastEscape };
  if (lastMoment.escapes > previousEscapes && lastMoment.lastEscape) {
    events.push({
      atMs: lastMoment.lastEscape.atMs,
      kind: "impact",
      from: "chase",
      to: "search",
      event: "last-moment-escape",
      cause: `se salvo por ${lastMoment.lastEscape.marginPx.toFixed(1)} px tras ${lastMoment.lastEscape.heldMs} ms de presion`,
      detail: `alivio ${(lastMoment.lastEscape.relief * 100).toFixed(0)}%`,
    });
  }

  // 6. Decision (H4.1 a H4.5).
  const guardCell = worldToCell(state.position, TILE_SIZE);
  const lastKnownCell = state.memory.lastKnownPosition
    ? worldToCell(state.memory.lastKnownPosition, TILE_SIZE)
    : null;
  const soundCell = perceptionFrame.closestSound
    ? worldToCell(perceptionFrame.closestSound.position, TILE_SIZE)
    : null;
  const atGoal = state.goalCell !== null
    && distanceToCell(state.position, state.goalCell, TILE_SIZE) <= GOAL_TOLERANCE_PX;

  const decision = decide({
    timeMs,
    state: state.state,
    enteredStateAtMs: state.enteredStateAtMs,
    visionVisible: perceptionFrame.vision.visible,
    visibleSinceMs: state.visibleSinceMs,
    confirmMs: CONFIRM_MS,
    soundHeard: perceptionFrame.soundHeard,
    soundCell,
    lastKnownCell,
    goalCell: state.goalCell,
    atGoal,
    goalReachable: state.goalReachable,
    searchPointsRemaining: state.search !== null && searchPointAt(state.search, state.searchIndex + 1) !== null,
    searchExpired: state.search !== null ? searchExpired(state.search, timeMs) : false,
    distanceToPlayer,
    captureRadius: CAPTURE_RADIUS,
    lastMomentBroken,
    manualOverride: state.manualGoal !== null,
  } satisfies GuardContext);

  const previousState = state.state;
  state = applyDecision(state, decision, previousState, timeMs);
  impacts.push(...impactsOf(decision));
  if (decision.event !== null) {
    events.push({
      atMs: timeMs,
      kind: "transition",
      from: previousState,
      to: decision.state,
      event: decision.event,
      cause: decision.cause,
      ...(decision.requestShutter ? { detail: "se abre el atajo de la persiana" } : {}),
    });
  }

  // 7. Plan de busqueda acotada (H4.4).
  if (decision.startSearch) {
    const origin = lastKnownCell ?? soundCell ?? guardCell;
    const plan = planSearch(map, origin, {
      radiusCells: SEARCH_RADIUS_CELLS,
      pointCount: SEARCH_POINT_COUNT,
      durationMs: SEARCH_DURATION_MS,
      timeMs,
    });
    state = { ...state, search: plan, searchIndex: 0 };
    events.push({
      atMs: timeMs,
      kind: "navigation",
      from: null,
      to: null,
      event: "search-plan",
      cause: `${plan.points.length} puntos en radio ${SEARCH_RADIUS_CELLS} alrededor de ${origin.x},${origin.y}`,
    });
  }
  if (decision.advanceSearch) {
    state = { ...state, searchIndex: state.searchIndex + 1 };
  }
  if (decision.state !== "search") {
    state = { ...state, search: null, searchIndex: 0 };
  }

  // 8. Objetivo, replanificacion y rutas (H4.3 y H4.5).
  const goal = resolveGoal(state, decision, soundCell);
  state = { ...state, goalCell: goal, goalReason: decision.goalReason };

  if (decision.event === "destination-unreachable" && decision.goalCell === null && decision.state === "patrol") {
    const skipped = advancePatrol(PATROL_ROUTE, state.patrol, true, 0);
    state = {
      ...state,
      patrol: skipped.cursor,
      patrolPause: skipped.cursor.phase === "pausing",
    };
  }

  if (goal !== null && shouldReplan(state, goal, timeMs)) {
    const result = state.algorithm === "astar"
      ? findPathAStar(map, guardCell, goal)
      : findPathBfs(map, guardCell, goal);
    const reachable = result.status === "success";
    state = {
      ...state,
      goalReachable: reachable,
      waypoints: reachable ? result.path.map((cell) => cellCenter(cell, TILE_SIZE)) : [],
      nextWaypoint: 0,
      lastPlannedGoal: goal,
      lastPlannedAtMs: timeMs,
      pathStatus: result.status,
      totalCost: result.totalCost,
      expandedNodes: result.expandedNodes,
      maximumFrontier: result.maximumFrontier,
      explored: result.explored,
    };
  }

  // 9. Locomocion: la unica capa que mueve al guardia.
  const locomotion = advanceGuard({
    position: state.position,
    waypoints: state.waypoints,
    nextWaypoint: state.nextWaypoint,
    speedPxPerSecond: (SPEED_BY_STATE[state.state] ?? 100) * SPEED_BY_BAND[state.alert.band],
    deltaMs,
    facing: state.facing,
  }, GOAL_TOLERANCE_PX);
  state = { ...state, position: locomotion.position, nextWaypoint: locomotion.nextWaypoint };
  state = {
    ...state,
    lastSpeedPxPerSecond: deltaMs > 0 ? (locomotion.movedDistance / deltaMs) * 1000 : 0,
  };

  // 10. Antipatrulla ante rutas bloqueadas por una puerta cerrada.
  state = resolveStuck(state, locomotion.movedDistance, timeMs, events);

  // 11. Ciclo de patrulla con pausas (upgrade 1).
  const patrolStep = advancePatrol(
    PATROL_ROUTE,
    state.patrol,
    state.state === "patrol" && state.manualGoal === null && atGoal,
    deltaMs,
  );
  state = {
    ...state,
    patrol: patrolStep.cursor,
    patrolPause: patrolStep.cursor.phase === "pausing",
  };
  if (patrolStep.arrived) {
    events.push({
      atMs: timeMs,
      kind: "transition",
      from: "patrol",
      to: "patrol",
      event: "patrol-paused",
      cause: `pausa de ${currentPatrolPoint(PATROL_ROUTE, state.patrol).pauseMs} ms con barrido de mirada`,
    });
  }
  if (patrolStep.resumed) {
    events.push({
      atMs: timeMs,
      kind: "transition",
      from: "patrol",
      to: "patrol",
      event: "patrol-resumed",
      cause: "pausa terminada, retoma el ciclo",
    });
  }

  // 12. Mirada direccional (upgrade 1).
  state = resolveFacingState(state, locomotion.movedDistance, locomotion.facing, timeMs);

  // 13. Resultado de la ronda (upgrade 8 y 9).
  const finalDistance = distanceBetween(state.position, playerPosition);
  if (state.state === "chase" && finalDistance <= CAPTURE_RADIUS && state.outcome === "running") {
    state = {
      ...state,
      state: "captured",
      enteredStateAtMs: timeMs,
      outcome: "captured",
      outcomeAtMs: timeMs,
      outcomeDetail: `capturado a ${finalDistance.toFixed(1)} px, radio ${CAPTURE_RADIUS}`,
    };
    impacts.push("captured");
    events.push({
      atMs: timeMs,
      kind: "transition",
      from: "chase",
      to: "captured",
      event: "captured",
      cause: state.outcomeDetail,
    });
  }
  if (
    state.outcome === "running"
    && distanceToCell(playerPosition, EXTRACTION_CELL, TILE_SIZE) <= EXTRACTION_RADIUS_PX
  ) {
    state = {
      ...state,
      outcome: "extracted",
      outcomeAtMs: timeMs,
      outcomeDetail: "salida alcanzada sin captura",
    };
  }

  state = {
    ...state,
    timeMs,
    playerPosition,
    playerFacing,
    phase: phaseOf(state.state, state.alert.band, state.outcome),
  };

  let telemetry = state.telemetry;
  for (const event of events) {
    telemetry = pushTelemetry(telemetry, event);
  }
  state = { ...state, telemetry };

  const cover = assessCover(LAB_MAP, map, TILE_SIZE, state.position, playerPosition, COVER_RADIUS_CELLS);

  return {
    state,
    map,
    cover,
    impacts,
    events,
    doorChanges: doorStep.changedIds,
    soundHeard: perceptionFrame.soundHeard,
    memoryAgeMs: timeSinceLastPerception(state.memory, timeMs),
    distanceToPlayer: finalDistance,
    distanceToCover: Number.isFinite(cover.distanceToNearestCover) ? cover.distanceToNearestCover : null,
  };
}

function impactsOf(decision: GuardDecision): readonly ScreenImpact[] {
  switch (decision.event) {
    case "sight-confirmed":
      return ["sight-confirmed"];
    case "last-moment-escape":
      return ["last-moment-escape"];
    case "captured":
      return ["captured"];
    default:
      return [];
  }
}

function applyDecision(
  state: GuardSimulationState,
  decision: GuardDecision,
  previousState: GuardState,
  timeMs: number,
): GuardSimulationState {
  const next: GuardSimulationState = {
    ...state,
    state: decision.state,
    goalCell: decision.goalCell,
    goalReason: decision.goalReason,
    manualGoal: decision.clearManual ? null : state.manualGoal,
  };
  if (decision.state === previousState) {
    return next;
  }
  return {
    ...next,
    enteredStateAtMs: timeMs,
    transitions: state.transitions + 1,
  };
}

function resolveGoal(
  state: GuardSimulationState,
  decision: GuardDecision,
  soundCell: GridPoint | null,
): GridPoint | null {
  switch (decision.state) {
    case "captured":
      return null;
    case "patrol":
      return state.manualGoal ?? currentPatrolCell(PATROL_ROUTE, state.patrol);
    case "return":
      return RETURN_POINT;
    case "search":
      return state.search
        ? searchPointAt(state.search, state.searchIndex) ?? state.search.origin
        : state.memory.lastKnownPosition
          ? worldToCell(state.memory.lastKnownPosition, TILE_SIZE)
          : decision.goalCell;
    case "investigate":
      return soundCell ?? decision.goalCell;
    case "chase":
      return state.memory.lastKnownPosition
        ? worldToCell(state.memory.lastKnownPosition, TILE_SIZE)
        : decision.goalCell;
    default:
      return decision.goalCell;
  }
}

function shouldReplan(
  state: GuardSimulationState,
  goal: GridPoint | null,
  timeMs: number,
): boolean {
  if (goal === null) {
    return false;
  }
  if (state.nextWaypoint >= state.waypoints.length) {
    return true;
  }
  if (!sameCell(state.lastPlannedGoal, goal)) {
    return true;
  }
  return timeMs - state.lastPlannedAtMs >= REPLAN_INTERVAL_MS;
}

function resolveStuck(
  state: GuardSimulationState,
  movedDistance: number,
  timeMs: number,
  events: TelemetryEvent[],
): GuardSimulationState {
  if (state.waypoints.length === 0 || state.state === "captured" || movedDistance >= 0.05) {
    return state;
  }

  events.push({
    atMs: timeMs,
    kind: "navigation",
    from: null,
    to: null,
    event: "blocked-route",
    cause: "la ruta activa quedo bloqueada por una puerta cerrada, recalcula",
  });

  if (state.state === "patrol") {
    const skipped = advancePatrol(PATROL_ROUTE, state.patrol, true, 0);
    return {
      ...state,
      patrol: skipped.cursor,
      patrolPause: skipped.cursor.phase === "pausing",
    };
  }
  return { ...state };
}

function resolveFacingState(
  state: GuardSimulationState,
  movedDistance: number,
  movementFacing: Vector2,
  timeMs: number,
): GuardSimulationState {
  if (state.state === "captured") {
    return state;
  }
  if (movedDistance > 0.05) {
    const radians = Math.atan2(movementFacing.y, movementFacing.x);
    return withFacing(
      state,
      state.patrolPause ? patrolGazeRadians(PATROL_ROUTE, state.patrol, radians) : radians,
    );
  }
  if (state.patrolPause) {
    return withFacing(
      state,
      patrolGazeRadians(PATROL_ROUTE, state.patrol, state.facingRadians),
    );
  }
  if (state.state === "investigate" || state.state === "search") {
    const amplitude = degreesToRadians(state.state === "search" ? 52 : 30);
    return withFacing(state, state.facingRadians + Math.sin(timeMs / 620) * amplitude);
  }
  return state;
}

function withFacing(state: GuardSimulationState, radians: number): GuardSimulationState {
  return {
    ...state,
    facingRadians: radians,
    facing: { x: Math.cos(radians), y: Math.sin(radians) },
  };
}

function resolveFacing(velocity: Vector2 | undefined, fallback: Vector2): Vector2 {
  if (!velocity) {
    return fallback;
  }
  const length = Math.hypot(velocity.x, velocity.y);
  if (length === 0) {
    return fallback;
  }
  return { x: velocity.x / length, y: velocity.y / length };
}

function phaseOf(
  state: GuardState,
  band: AlertBand,
  outcome: GuardSimulationState["outcome"],
): LevelPhase {
  if (outcome === "captured") {
    return "capturado";
  }
  if (outcome === "extracted") {
    return "extraccion";
  }
  if (state === "captured") {
    return "capturado";
  }
  if (state === "chase") {
    return "persecucion";
  }
  if (state === "search" || state === "investigate") {
    return "busqueda";
  }
  if (band === "alert") {
    return "alerta";
  }
  if (band === "suspicious") {
    return "suspicion";
  }
  return "infiltration";
}

function distractionEvent(
  timeMs: number,
  event: string,
  cause: string,
  position: Vector2,
): TelemetryEvent {
  return {
    atMs: timeMs,
    kind: "distractor",
    from: null,
    to: null,
    event,
    cause: `${cause} en ${position.x.toFixed(0)},${position.y.toFixed(0)}`,
  };
}

function predictImpact(
  map: GridMap,
  tileSize: number,
  origin: Vector2,
  direction: Vector2,
): Vector2 | null {
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0) {
    return null;
  }
  const travel = STONE_SPEED * (STONE_FLIGHT_MS / 1000);
  const dir = { x: direction.x / length, y: direction.y / length };
  const cell = worldToCell(
    { x: origin.x + dir.x * travel, y: origin.y + dir.y * travel },
    tileSize,
  );
  if (cell.x < 0 || cell.y < 0 || cell.x >= map.width || cell.y >= map.height) {
    return null;
  }
  return cellCenter(cell, tileSize);
}

function applyTerrainCosts(
  map: GridMap,
  terrainCosts: ReadonlyMap<string, number>,
): GridMap {
  return terrainCosts.size > 0 ? withEntryCosts(map, terrainCosts) : map;
}

export const GUARD_TUNING = {
  visionRange: VISION_RANGE,
  fieldOfViewRadians: FIELD_OF_VIEW,
  captureRadius: CAPTURE_RADIUS,
  lastMomentRadius: LAST_MOMENT_RADIUS,
  confirmMs: CONFIRM_MS,
  searchDurationMs: SEARCH_DURATION_MS,
  searchRadiusCells: SEARCH_RADIUS_CELLS,
  searchPointCount: SEARCH_POINT_COUNT,
  coverRadiusCells: COVER_RADIUS_CELLS,
  distractionCapacity: DISTRACTION_CAPACITY,
  extractionCell: EXTRACTION_CELL,
  extractionRadiusPx: EXTRACTION_RADIUS_PX,
} as const;

export const VISION_RANGE_PX = VISION_RANGE;
export const FIELD_OF_VIEW_RADIANS = FIELD_OF_VIEW;
