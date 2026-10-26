import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One vector per thread for semantic search (ThreadSearch.searchArchived).
  // A row is current while its model and source_updated_at match the thread's
  // updated_at; anything else is re-embedded on the next search. Rows are a
  // cache derived from projections, so dropping them only costs re-indexing.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_embeddings (
      thread_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      source_updated_at TEXT NOT NULL,
      vector BLOB NOT NULL
    )
  `;
});
