# GDD simplificado — navegación con terreno lento (práctica 7 al 14/10/2026)

## Juego y experiencia
- Género y situación de juego: sigilo 2D cenital dentro de un laboratorio; el
  guardia patrulla, percibe e investiga, y el jugador se infiltra para llegar a
  la salida sin ser capturado.
- Rol del jugador: infiltrador que provoca y observa las transiciones del
  guardia; no combate ni depende de puntería fina.
- Experiencia buscada: que quien juega entienda que el guardia elige el camino
  de **menor costo** y no sólo el de menos pasos, y pueda leer por qué rodea una
  franja del piso más cara.

## Comportamiento a resolver
- Entidad: el guardia, en su capa de navegación.
- Problema actual: la búsqueda A* usa un costo unitario fijo (`search.ts`), por
  lo que trata todas las celdas transitables como equivalentes y no puede
  expresar preferencias de diseño sobre el terreno.
- Comportamiento esperado: con costo de entrada 5 en la franja central
  `(1,1),(2,1),(3,1)`, el guardia prefiere un rodeo más largo pero de menor
  costo total; sin franja, vuelve al camino más corto.

## Reglas
- Estados, condiciones o eventos relevantes: cada celda declara un costo de
  entrada positivo (por defecto 1); la franja lenta cuesta 5. BFS sigue siendo
  no informada y unitaria; A* suma costos de entrada y usa Manhattan * 1 como
  heurística admisible.
- Acción del jugador o del entorno: el diseñador activa o desactiva la franja
  mediante configuración explícita de costos, sin editor de mapas ni interfaz
  nueva. El guardia replantea su ruta con esos datos.
- Resultado esperado: ruta directa de 4 pasos y costo 16 (5+5+5+1); ruta
  ponderada de 6 pasos y costo total 6 evitando las celdas lentas.
- Caso límite: inicio igual a meta es éxito de costo 0; una barrera completa es
  inaccesible; extremos fuera del mapa son inválidos; al volver la franja a
  costo 1, la búsqueda recupera el mínimo unitario de 4 pasos y costo 4.

## Límites
- Fuera de alcance: modificar la velocidad física del guardia, crear terrenos
  gráficos, editar niveles, tocar percepción o FSM, y agregar dependencias o UI.
- Restricciones técnicas: dominio puro TypeScript sin Phaser; el motor sólo
  representa; sin despliegue ni secretos; escritura acotada a navegación, su
  consumidor y las pruebas previstas en el plan.
- Criterios de aceptación: BASE-AC1 a BASE-AC6 (spec común) más A-AC1, A-AC2 y
  A-AC3 del anexo A, verificables con `npm run test:run -- tests/navigation`,
  `npm run test:run -- tests/application` y `npm run validate`.

El GDD delimita la intención de diseño. La especificación y el plan la
convierten en una intervención técnica verificable.
