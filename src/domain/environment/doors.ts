import { cellKey, isInside, type GridMap, type GridPoint } from "../model/grid";

/**
 * Upgrade 10 - Puertas, atajos o rutas bloqueables.
 *
 * El dominio no sabe que existe Phaser ni tiempo real: las puertas son un
 * conjunto de celdas transitables o bloqueadas que evolucionan por tick.
 * La capa de aplicacion decide quien abre la persiana; aqui solo se aplica
 * el ciclo y la composicion del mapa navegable.
 *
 * `holdShutter` mantiene la persiana abierta durante toda la busqueda: el
 * guardia ya confirmo intrusion, asi que el atajo queda como via de escape
 * para el jugador y el atajo de persecucion para el guardia.
 */

export type DoorKind = "auto" | "shutter";

export interface DoorSpec {
  readonly id: string;
  readonly kind: DoorKind;
  readonly cells: readonly GridPoint[];
  /** Tiempo que permanece abierta una puerta `auto`. */
  readonly openMs: number;
  /** Tiempo que permanece cerrada una puerta `auto`, o cuanto dura abierta la `shutter`. */
  readonly closedMs: number;
  readonly startOpen: boolean;
}

export interface DoorRuntime {
  readonly id: string;
  readonly kind: DoorKind;
  readonly cells: readonly GridPoint[];
  readonly open: boolean;
  readonly remainingMs: number;
  readonly openMs: number;
  readonly closedMs: number;
}

export interface DoorAdvanceOptions {
  /** Indica que el guardia confirmo una persecucion y por lo tanto habilita el atajo. */
  readonly requestShutter: boolean;
  /** Durante la busqueda una persiana se mantiene abierta para que el guardia pueda pasar. */
  readonly holdShutter: boolean;
}

export interface DoorAdvanceResult {
  readonly doors: readonly DoorRuntime[];
  readonly changedIds: readonly string[];
  readonly shutterOpened: boolean;
  readonly shutterClosed: boolean;
}

const NEVER = Number.POSITIVE_INFINITY;

export function initialDoors(specs: readonly DoorSpec[]): readonly DoorRuntime[] {
  return specs.map((spec) => ({
    id: spec.id,
    kind: spec.kind,
    cells: spec.cells.map((cell) => ({ ...cell })),
    open: spec.startOpen,
    remainingMs: spec.startOpen ? spec.closedMs : spec.openMs,
    openMs: spec.openMs,
    closedMs: spec.closedMs,
  }));
}

export function findDoor(doors: readonly DoorRuntime[], id: string): DoorRuntime | null {
  return doors.find((door) => door.id === id) ?? null;
}

/**
 * Alterna el estado de una puerta a pedido del operador. Las puertas `auto`
 * conservan sus tiempos de ciclo; la `shutter` queda abierta o cerrada de
 * forma estable. Devuelve el mismo arreglo si el identificador no existe.
 */
export function toggleDoor(
  doors: readonly DoorRuntime[],
  id: string,
): readonly DoorRuntime[] {
  if (!doors.some((door) => door.id === id)) {
    return doors;
  }
  return doors.map((door) => {
    if (door.id !== id) {
      return door;
    }
    const open = !door.open;
    return {
      ...door,
      open,
      remainingMs: door.kind === "shutter"
        ? (open ? door.closedMs : Number.POSITIVE_INFINITY)
        : (open ? door.closedMs : door.openMs),
    };
  });
}

export function advanceDoors(
  doors: readonly DoorRuntime[],
  deltaMs: number,
  options: DoorAdvanceOptions,
): DoorAdvanceResult {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error("Door advance requires a finite non-negative delta.");
  }

  const changedIds: string[] = [];
  let shutterOpened = false;
  let shutterClosed = false;

  const next = doors.map((door) => {
    let open = door.open;
    let remainingMs = door.remainingMs - deltaMs;

    if (door.kind === "shutter") {
      if (!open && (options.requestShutter || options.holdShutter)) {
        open = true;
        remainingMs = door.closedMs;
        changedIds.push(door.id);
        shutterOpened = true;
      } else if (open && options.holdShutter) {
        return { ...door, open: true, remainingMs: door.closedMs };
      } else if (open && remainingMs <= 0) {
        open = false;
        remainingMs = NEVER;
        changedIds.push(door.id);
        shutterClosed = true;
      } else if (remainingMs <= 0) {
        remainingMs = NEVER;
      }
      return { ...door, open, remainingMs };
    }

    if (remainingMs > 0) {
      return { ...door, open, remainingMs };
    }

    open = !open;
    remainingMs = open ? door.closedMs : door.openMs;
    changedIds.push(door.id);
    return { ...door, open, remainingMs };
  });

  return { doors: next, changedIds, shutterOpened, shutterClosed };
}

/**
 * Compone el mapa navegable a partir del mapa estatico y el estado de las
 * puertas. Una celda de puerta siempre es transitable cuando la puerta esta
 * abierta, incluso si el mapa estatico la declaraba muro.
 */
export function composeNavigationMap(
  base: GridMap,
  doors: readonly DoorRuntime[],
): GridMap {
  const doorCells = new Set<string>();
  for (const door of doors) {
    for (const cell of door.cells) {
      if (!isInside(base, cell)) {
        throw new Error(`Door ${door.id} references a cell outside the grid: ${cellKey(cell)}.`);
      }
      doorCells.add(cellKey(cell));
    }
  }

  const blocked = new Set<string>();
  for (const key of base.blocked) {
    if (!doorCells.has(key)) {
      blocked.add(key);
    }
  }

  for (const door of doors) {
    if (door.open) {
      continue;
    }
    for (const cell of door.cells) {
      blocked.add(cellKey(cell));
    }
  }

  return {
    width: base.width,
    height: base.height,
    blocked,
    entryCosts: base.entryCosts,
  };
}

/** Verifica que cada puerta recorte un muro real y que sus tiempos sean utilizables. */
export function validateDoorSpecs(base: GridMap, specs: readonly DoorSpec[]): void {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (spec.id.length === 0) {
      throw new Error("Door id cannot be empty.");
    }
    if (seen.has(spec.id)) {
      throw new Error(`Duplicated door id: ${spec.id}.`);
    }
    seen.add(spec.id);
    if (spec.cells.length === 0) {
      throw new Error(`Door ${spec.id} has no cells.`);
    }
    if (!Number.isFinite(spec.openMs) || spec.openMs <= 0) {
      throw new Error(`Door ${spec.id} needs a positive openMs.`);
    }
    if (!Number.isFinite(spec.closedMs) || spec.closedMs <= 0) {
      throw new Error(`Door ${spec.id} needs a positive closedMs.`);
    }
    for (const cell of spec.cells) {
      if (!isInside(base, cell)) {
        throw new Error(`Door ${spec.id} is outside the grid: ${cellKey(cell)}.`);
      }
      if (!base.blocked.has(cellKey(cell))) {
        throw new Error(
          `Door ${spec.id} must carve a wall cell, otherwise it changes no route: ${cellKey(cell)}.`,
        );
      }
    }
  }
}
