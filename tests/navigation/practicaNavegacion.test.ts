import { describe, expect, it } from "vitest";
import {
  createGridMap,
  entryCostAt,
  isWalkable,
  withEntryCosts,
  type GridMap,
  type GridPoint,
} from "../../src/domain/model/grid";
import { manhattanDistance } from "../../src/domain/navigation/gridGraph";
import {
  findPathAStar,
  findPathBfs,
  type SearchResult,
} from "../../src/domain/navigation/search";

/** Fixture comun de la practica: x=0..4, y=0..2, S y G en la fila central. */
const START: GridPoint = { x: 0, y: 1 };
const GOAL: GridPoint = { x: 4, y: 1 };

const FREE_MAP = createGridMap(5, 3, []);
const BARRIER_MAP = createGridMap(5, 3, [
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 2, y: 2 },
]);

/** Anexo A: franja central lenta a costo de entrada 5. */
const SLOW_CELLS: readonly GridPoint[] = [
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 3, y: 1 },
];
const SLOW_COSTS: ReadonlyMap<string, number> = new Map([
  ["1,1", 5],
  ["2,1", 5],
  ["3,1", 5],
]);
const SLOW_MAP = createGridMap(5, 3, [], SLOW_COSTS);

/** Ruta directa teorica: cuatro pasos por la franja lenta. */
const DIRECT_ROUTE: readonly GridPoint[] = [
  START,
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 3, y: 1 },
  GOAL,
];

function stepsOf(result: SearchResult): number {
  return result.path.length - 1;
}

function weightedCost(map: GridMap, path: readonly GridPoint[]): number {
  let cost = 0;
  for (let index = 1; index < path.length; index += 1) {
    const cell = path[index];
    if (!cell) {
      throw new Error("Path invariant failed in test helper.");
    }
    cost += entryCostAt(map, cell);
  }
  return cost;
}

function isCardinalPath(path: readonly GridPoint[]): boolean {
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (!from || !to || manhattanDistance(from, to) !== 1) {
      return false;
    }
  }
  return true;
}

describe("BASE-AC2: comparacion BFS/A* en el fixture libre 5x3", () => {
  it.each([
    ["BFS", findPathBfs],
    ["A*", findPathAStar],
  ] as const)("%s devuelve 4 pasos y costo 4", (_name, findPath) => {
    const result = findPath(FREE_MAP, START, GOAL);

    expect(result.status).toBe("success");
    expect(result.path[0]).toEqual(START);
    expect(result.path.at(-1)).toEqual(GOAL);
    expect(stepsOf(result)).toBe(4);
    expect(result.totalCost).toBe(4);
    expect(isCardinalPath(result.path)).toBe(true);
    expect(result.path.every((cell) => isWalkable(FREE_MAP, cell))).toBe(true);
    expect(result.expandedNodes).toBeGreaterThan(0);
    expect(result.maximumFrontier).toBeGreaterThan(0);
  });
});

describe("BASE-AC3: casos comunes con el contrato real", () => {
  it.each([
    ["BFS", findPathBfs],
    ["A*", findPathAStar],
  ] as const)("%s trata inicio=meta como exito de costo 0", (_name, findPath) => {
    const result = findPath(FREE_MAP, START, START);

    expect(result.status).toBe("success");
    expect(result.path).toEqual([START]);
    expect(result.totalCost).toBe(0);
    expect(result.expandedNodes).toBe(1);
  });

  it.each([
    ["BFS", findPathBfs],
    ["A*", findPathAStar],
  ] as const)("%s reporta inaccesible con barrera completa", (_name, findPath) => {
    const result = findPath(BARRIER_MAP, START, GOAL);

    expect(result.status).toBe("unreachable");
    expect(result.path).toEqual([]);
    expect(result.totalCost).toBeNull();
    expect(result.explored.every((cell) => cell.x < 2)).toBe(true);
  });

  it.each([
    ["BFS", findPathBfs],
    ["A*", findPathAStar],
  ] as const)("%s distingue extremos fuera del mapa", (_name, findPath) => {
    const invalidStart = findPath(FREE_MAP, { x: -1, y: 1 }, GOAL);
    const invalidGoal = findPath(FREE_MAP, START, { x: 5, y: 1 });

    expect(invalidStart.status).toBe("invalid-start");
    expect(invalidGoal.status).toBe("invalid-goal");
    expect(invalidStart.expandedNodes).toBe(0);
    expect(invalidGoal.expandedNodes).toBe(0);
  });
});

describe("Anexo A: terreno lento", () => {
  it("A-AC1: la ruta directa cuesta 16 y el rodeo ponderado cuesta 6", () => {
    expect(DIRECT_ROUTE.length - 1).toBe(4);
    expect(weightedCost(SLOW_MAP, DIRECT_ROUTE)).toBe(16);

    const result = findPathAStar(SLOW_MAP, START, GOAL);
    const slowKeys = new Set(SLOW_CELLS.map((cell) => `${cell.x},${cell.y}`));

    expect(result.status).toBe("success");
    expect(stepsOf(result)).toBe(6);
    expect(result.totalCost).toBe(6);
    expect(result.path[0]).toEqual(START);
    expect(result.path.at(-1)).toEqual(GOAL);
    expect(isCardinalPath(result.path)).toBe(true);
    expect(result.path.slice(1).some((cell) => slowKeys.has(`${cell.x},${cell.y}`))).toBe(false);
  });

  it("A-AC2: sin franja lenta la busqueda recupera 4 pasos y costo 4", () => {
    const result = findPathAStar(FREE_MAP, START, GOAL);

    expect(stepsOf(result)).toBe(4);
    expect(result.totalCost).toBe(4);
  });

  it("A-01: BFS conserva su semantica unitaria sobre la franja lenta", () => {
    const bfs = findPathBfs(SLOW_MAP, START, GOAL);

    expect(bfs.status).toBe("success");
    expect(stepsOf(bfs)).toBe(4);
    expect(bfs.totalCost).toBe(4);
    expect(weightedCost(SLOW_MAP, bfs.path)).toBe(16);
  });

  it("A-04: al vaciar los costos, A* usa datos frescos y recupera el minimo unitario", () => {
    const restored = findPathAStar(withEntryCosts(SLOW_MAP, new Map()), START, GOAL);

    expect(stepsOf(restored)).toBe(4);
    expect(restored.totalCost).toBe(4);
  });
});
