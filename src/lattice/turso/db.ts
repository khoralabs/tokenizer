import { connect } from "@tursodatabase/database";

export type TursoDatabase = Awaited<ReturnType<typeof connect>>;

export async function connectTurso(filename = ":memory:"): Promise<TursoDatabase> {
  const db = await connect(filename);
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA synchronous = OFF;");
  await db.exec("PRAGMA temp_store = MEMORY;");
  return db;
}
