# Plan — práctica de navegación
Estado: Aprobado
Variante: A (terreno lento)
Spec: spec.md

| Incremento | Trabajo | Archivos reales | Criterios | Comprobación |
|---|---|---|---|---|
| 1 | Costo de entrada ponderado en el modelo de mapa y suma de `g` en A*, conservando BFS unitario; prueba de franja y de restauración | `src/domain/model/grid.ts`, `src/domain/navigation/search.ts`, `src/domain/environment/doors.ts`, `tests/navigation/search.test.ts` | A-01, A-02, A-AC1, A-AC2, A-04 | `npm run test:run -- tests/navigation` |
| 2 | Conectar el modo ponderado con el consumidor existente (`calculateRoute` y `guardSimulation`) mediante configuración explícita; prueba del consumidor y del contrato unitario previo | `src/application/simulation/navigationDemo.ts`, `src/application/simulation/guardSimulation.ts`, `tests/application/navigationDemo.test.ts`, `tests/application/guardSimulation.test.ts` | A-03, A-AC3, BASE-AC5 | `npm run test:run -- tests/application` |
| 3 | Validación final, diff y cierre de evidencia | `docs/practica-navegacion/spec.md`, `docs/practica-navegacion/plan.md`, `docs/practica-navegacion/evidencia.md` | BASE-AC1 a BASE-AC6 | `npm run validate` |

Referencia previa: comparación y casos comunes BASE-01 a BASE-04 completados.
Riesgos:
- Cambiar `totalCost` de A* para que cuente pasos y no costos, ocultando la diferencia en la ruta directa de costo 16.
- Perder el contrato unitario de BFS o de A* en mapas sin franja al introducir costos.
Detenerse si: faltan permisos, hay cambios ajenos, conflicto de contrato,
regresión nueva o se requiere dependencia/UI/refactorización fuera del alcance.
No crear commits ni publicar automáticamente.
