import { withEntryCosts, type GridMap, type GridPoint } from "../../domain/model/grid";
import {
  findPathAStar,
  findPathBfs,
  type SearchAlgorithm,
  type SearchResult,
} from "../../domain/navigation/search";

/**
 * Entrada de navegacion existente. La configuracion explicita del modo
 * ponderado es `terrainCosts`: un mapa de costos de entrada por celda. Si se
 * omite (o queda vacio) la busqueda conserva su resultado unitario; si se
 * provee, A* suma esos costos. BFS los ignora por diseno.
 */
export function calculateRoute(
  map: GridMap,
  start: GridPoint,
  goal: GridPoint,
  algorithm: SearchAlgorithm,
  terrainCosts?: ReadonlyMap<string, number>,
): SearchResult {
  const navigationMap = terrainCosts && terrainCosts.size > 0
    ? withEntryCosts(map, terrainCosts)
    : map;
  return algorithm === "astar"
    ? findPathAStar(navigationMap, start, goal)
    : findPathBfs(navigationMap, start, goal);
}
