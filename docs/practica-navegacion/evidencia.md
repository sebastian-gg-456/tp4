# Evidencia — práctica de navegación
Repositorio: https://github.com/sebastian-gg-456/tp4.git
Commit inicial: 25c21a6dbca1e0807af2b2240884d3660000060f
Commit de implementación: bbbab0ddd32c845df3e49c663932751224717903
Versión de entrega: commit final informado por el estudiante en la plataforma.
Variante: A (terreno lento)
Herramienta/modelo o trabajo manual: OpenCode sobre el repositorio canónico
`piapc-guardia-sigilo`; comandos ejecutados localmente con Node v25.2.1 / npm 11.6.2.
Cambios previos: copia del repositorio canónico en el commit 25c21a6
(H0–H4 más los diez upgrades de comportamiento). Sin cambios de navegación previos.
Línea base: `npm run validate` sobre el commit inicial → `typecheck` OK,
`Test Files 17 passed` / `Tests 219 passed`, `vite build` OK. Sin fallos previos.

## Exploración mínima
| Capa | Ruta/símbolo | Capacidad comprobada |
|---|---|---|
| Búsqueda | `src/domain/navigation/search.ts` (`findPathBfs`, `findPathAStar`) | BFS no informada; A* con costo unitario y heurística Manhattan; devuelve `status`, `path`, `totalCost`, `expandedNodes`, `maximumFrontier`, `explored` |
| Vecinos | `src/domain/navigation/gridGraph.ts` (`walkableNeighbors`, `manhattanDistance`) | Cuatro vecinos cardinales sin diagonales; Manhattan |
| Seguimiento | `src/domain/navigation/pathFollower.ts` (`advanceAlongPath`) | Consume waypoints por distancia; separado de la búsqueda |
| Mapa | `src/domain/model/grid.ts` (`GridMap`, `createGridMap`) | Estado de cuadrícula con `blocked`; no había costos de entrada |
| Consumidor | `src/application/simulation/navigationDemo.ts` (`calculateRoute`) y `src/application/simulation/guardSimulation.ts` | Entrada de navegación y simulación que piden la ruta |
| Pruebas | `tests/navigation/search.test.ts`, `tests/application/guardSimulation.test.ts` | Fixture de 5x5 y de simulación; sin fixture 5x3 de la práctica |

Contraste y decisión humana: se supuso que haría falta una estructura de costos
nueva, pero al leer el código `GridMap` ya concentra el estado de la cuadrícula y
`composeNavigationMap` ya lo propaga. Decidí **extender `GridMap` con
`entryCosts`** y reutilizar `calculateRoute` y `guardSimulation` como
consumidores, en lugar de crear una interfaz paralela; A* suma costos y BFS
permanece unitaria, sin agregar Dijkstra.
Spec/plan aprobados: paso 3 (spec adaptada y aprobada) y paso 5 (plan de tres
incrementos aprobado) antes de editar código.

## Comparación común — fixture libre 5x3
Vecinos y desempate reales: vecinos arriba, derecha, abajo, izquierda
(`gridGraph.ts:3`); sin diagonales. A* desempata por menor `cost + heuristic`,
luego por menor heurística y luego por orden de inserción (`search.ts:137`).
Fixture: `createGridMap(5, 3, [])`, S=(0,1), G=(4,1), costo 1.

| Algoritmo | Estado | Ruta | Pasos | Costo | Expandidos | Frontera máxima |
|---|---|---|---:|---:|---|---|
| BFS | success | 0,1 → 1,1 → 2,1 → 3,1 → 4,1 | 4 | 4 | 12 | 4 |
| A* | success | 0,1 → 1,1 → 2,1 → 3,1 → 4,1 | 4 | 4 | 5 | 9 |

(Valores observados ejecutando el fixture con cada buscador; A* expande menos
nodos y alcanza la misma ruta y costo.)

DFS: con pila e inserción de vecinos en orden inverso, la traza es
S→A→C→X→G, cuatro pasos; BFS encuentra S→B→D→G, tres pasos. Encontrar primero
una meta sólo demuestra que esa rama se exploró antes, no que la ruta tenga
menos pasos ni menor costo.

Dijkstra (traza guiada): extraer S=0 descubre A=1 y B=3; extraer A=1 descubre
G=10; extraer B=3 mejora G=6; extraer G entrega la ruta S-B-G con costo 6. No
hay que terminar al descubrir G por primera vez porque aún puede aparecer una
ruta más barata; de hecho G pasó de 10 a 6. Ambas rutas tienen dos acciones y
BFS no distingue sus costos por contar acciones.

## Variante A — terreno lento
Fixture: mismo 5x3, costo de entrada 5 en (1,1),(2,1),(3,1); el resto 1.
- Ruta directa: 4 pasos, costo 16 (=5+5+5+1).
- BFS sobre el mapa lento: 4 pasos, `totalCost` 4 (semántica unitaria); su costo
  ponderado real es 16: BFS no es oráculo del mínimo ponderado.
- A* ponderado: 6 pasos, costo total 6, ruta
  `0,1 → 0,0 → 1,0 → 2,0 → 3,0 → 4,0 → 4,1` (evita las tres celdas lentas).
- Restauración: con costos vacíos A* vuelve a 4 pasos y costo 4.

## Criterio → evidencia
| Criterio | Prueba/archivo y comando o reproducción | Observado | Cumple/pendiente |
|---|---|---|---|
| BASE-AC1 | Tabla de exploración + `git rev-parse HEAD` + `npm run validate` sobre el commit inicial | Commit 25c21a6, 219 pruebas en verde; capas y consumidor identificados | Cumple |
| BASE-AC2 | `tests/navigation/practicaNavegacion.test.ts` → `npm run test:run -- tests/navigation` | BFS y A*: 4 pasos, costo 4, ruta cardinal válida; métricas reales arriba | Cumple |
| BASE-AC3 | Mismo archivo, describe «BASE-AC3» | inicio=meta éxito costo 0; barrera → `unreachable` sin explorar más allá; extremos → `invalid-start` / `invalid-goal` con 0 expandidos | Cumple |
| BASE-AC4 | `docs/practica-navegacion/spec.md` (Estado: Aprobada) y `plan.md` (Aprobado) + decisión humana arriba | Spec y plan aprobados antes de editar; sólo se desarrolló el anexo A | Cumple |
| A-AC1 | `tests/navigation/practicaNavegacion.test.ts`, describe «Anexo A» | Directa 4 pasos/costo 16; ponderada 6 pasos/costo 6 sin tocar celdas lentas | Cumple |
| A-AC2 | Mismo describe | Sin franja: 4 pasos, costo 4 | Cumple |
| A-AC3 | `tests/application/navigationDemo.test.ts` y bloque «variant A» de `tests/application/guardSimulation.test.ts` → `npm run test:run -- tests/application` | `calculateRoute` obtiene costo 6 con franja y 4 sin ella; `guardSimulation` suma costos de entrada configurados y conserva el costo unitario sin configurar | Cumple |
| BASE-AC5 | `npm run validate` (237 pruebas) + revisión de diff | Sin regresiones; sólo navegación, su consumidor y pruebas previstas | Cumple |
| BASE-AC6 | URL, commit de implementación bbbab0d y los tres documentos en `docs/practica-navegacion/` | Documentos, URL y commit identifican la misma versión | Cumple |

## Registro mínimo de intervención
Prompts: se siguieron los pasos de la guía; para la variante A se usó el prompt
orientativo A (exploración en lectura de costos, `g`, heurística y consumidor;
contraste de la ruta de costo 16 y el rodeo de costo 6). Cambios relevantes:
extender `GridMap` en lugar de crear una estructura nueva y elegir
`calculateRoute`/`guardSimulation` como consumidores.
Decisión tras incremento 1: aceptar; A* ponderado y BFS unitario con pruebas de
franja y restauración en verde.
Decisión tras incremento 2: aceptar; el consumidor usa el modo ponderado y el
contrato unitario previo se conserva.
Validación final: `npm run validate` → `typecheck` OK, `Test Files 19 passed`,
`Tests 237 passed`, `vite build` OK.
Diff revisado: `src/domain/model/grid.ts`, `src/domain/navigation/search.ts`,
`src/domain/environment/doors.ts`, `src/application/simulation/navigationDemo.ts`,
`src/application/simulation/guardSimulation.ts` y las pruebas de navegación y
aplicación. Cambios previos (H0–H4 y upgrades) intactos.
Conclusión: para este caso conviene modelar el costo de entrada en el mapa y
dejarlo sumar en A*, porque permite expresar preferencias de diseño (una franja
más cara) sin tocar la locomoción ni la decisión. A* con Manhattan admisible
encuentra el rodeo de costo 6 frente a la ruta directa de costo 16. BFS se
conserva unitaria como referencia, de modo que sigue sirviendo para comparar.
La mejora queda conectada al consumidor real mediante configuración explícita.
Limitaciones: la traza DFS/Dijkstra es conceptual (provista por la guía), no una
ejecución del proyecto; el fixture 5x3 no se dibuja en el editor. La franja lenta
de la escena principal del laboratorio se activa por configuración; no se agregó
UI para cambiarla en vivo.
