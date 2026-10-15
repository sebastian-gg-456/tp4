import { describe, expect, it } from "vitest";
import { calculateRoute } from "../../src/application/simulation/navigationDemo";
import { createGridMap, type GridPoint } from "../../src/domain/model/grid";

const START: GridPoint = { x: 0, y: 1 };
const GOAL: GridPoint = { x: 4, y: 1 };
const FREE_MAP = createGridMap(5, 3, []);
const SLOW_COSTS: ReadonlyMap<string, number> = new Map([
  ["1,1", 5],
  ["2,1", 5],
  ["3,1", 5],
]);

/**
 * A-AC3: el consumidor real (`calculateRoute`, entrada de navegacion) usa el
 * modo ponderado cuando se le entrega la configuracion `terrainCosts` y
 * conserva el resultado unitario cuando no hay franja.
 */
describe("A-AC3: consumidor de navegacion con terreno lento", () => {
  it("con franja lenta obtiene el rodeo de 6 pasos y costo 6", () => {
    const result = calculateRoute(FREE_MAP, START, GOAL, "astar", SLOW_COSTS);

    expect(result.status).toBe("success");
    expect(result.path.length - 1).toBe(6);
    expect(result.totalCost).toBe(6);
  });

  it("sin franja conserva 4 pasos y costo 4", () => {
    const result = calculateRoute(FREE_MAP, START, GOAL, "astar");

    expect(result.status).toBe("success");
    expect(result.path.length - 1).toBe(4);
    expect(result.totalCost).toBe(4);
  });

  it("con configuracion vacia no reutiliza costos anteriores", () => {
    const result = calculateRoute(FREE_MAP, START, GOAL, "astar", new Map());

    expect(result.path.length - 1).toBe(4);
    expect(result.totalCost).toBe(4);
  });

  it("BFS conserva su resultado unitario aunque se declare la franja", () => {
    const result = calculateRoute(FREE_MAP, START, GOAL, "bfs", SLOW_COSTS);

    expect(result.path.length - 1).toBe(4);
    expect(result.totalCost).toBe(4);
  });
});
