import { Lattice as SqliteLattice } from "../lattice/sqlite/lattice.ts";
import { Lattice as TursoLattice } from "../lattice/turso/lattice.ts";
import type { TknConfig } from "./config.schema.ts";

export type SqliteLatticeHandle = {
  backend: "sqlite";
  lattice: SqliteLattice;
};

export type TursoLatticeHandle = {
  backend: "turso";
  lattice: TursoLattice;
};

export type LatticeHandle = SqliteLatticeHandle | TursoLatticeHandle;

export type OpenLatticeOptions = {
  config: TknConfig;
  readonly?: boolean;
  bulkIngest?: boolean;
};

export function openSqliteLattice(options: OpenLatticeOptions): SqliteLattice {
  const { config, readonly = false, bulkIngest = false } = options;
  return new SqliteLattice({
    filename: config.lattice.path,
    readonly,
    bulkIngest,
  });
}

export async function openTursoLattice(options: OpenLatticeOptions): Promise<TursoLattice> {
  const { config, bulkIngest = false } = options;
  return await TursoLattice.open({ filename: config.lattice.path, bulkIngest });
}

export function openSqliteLatticeFromConfig(
  config: TknConfig,
  options?: Omit<OpenLatticeOptions, "config">,
): SqliteLattice {
  if (config.lattice.backend !== "sqlite") {
    throw new Error(`expected sqlite backend, got ${config.lattice.backend}`);
  }
  return openSqliteLattice({ config, ...options });
}

export async function openTursoLatticeFromConfig(
  config: TknConfig,
  options?: Omit<OpenLatticeOptions, "config">,
): Promise<TursoLattice> {
  if (config.lattice.backend !== "turso") {
    throw new Error(`expected turso backend, got ${config.lattice.backend}`);
  }
  return await openTursoLattice({ config, ...options });
}

export async function closeLatticeHandle(handle: LatticeHandle): Promise<void> {
  if (handle.backend === "turso") {
    await handle.lattice.close();
  } else {
    handle.lattice.close();
  }
}
