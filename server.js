require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

// --- App config ---
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

// --- SSL config ---
const ssl = { rejectUnauthorized: false };

// ✅ Minimal boot markers (print BEFORE connecting)
console.log("BOOT: build=ssl-noverify-2025-12-15");
console.log("DB config:", process.env.DATABASE_URL ? "DATABASE_URL" : "DB_* vars");
console.log("PG ssl rejectUnauthorized:", ssl.rejectUnauthorized);

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl,
      }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || "postgres",
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl,
      }
);

// Create table automatically (idempotent)
async function initDb() {
  const sql = `
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;
  await pool.query(sql);
  console.log("DB init ok: ensured notes table exists");
}

// Helper: wrap async route handlers
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// --- Routes ---
app.get(
  "/health",
  asyncHandler(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  })
);

app.get(
  "/notes",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, title, content, created_at, updated_at FROM notes ORDER BY id DESC"
    );
    res.json(rows);
  })
);

app.post(
  "/notes",
  asyncHandler(async (req, res) => {
    const { title, content = "" } = req.body;
    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "Title is required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO notes(title, content)
       VALUES ($1, $2)
       RETURNING id, title, content, created_at, updated_at`,
      [title.trim(), String(content)]
    );

    res.status(201).json(rows[0]);
  })
);

app.put(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { title, content = "" } = req.body;

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "Title is required" });
    }

    const { rows } = await pool.query(
      `UPDATE notes
       SET title = $1, content = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, title, content, created_at, updated_at`,
      [title.trim(), String(content), id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Note not found" });
    }

    res.json(rows[0]);
  })
);

app.delete(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const result = await pool.query("DELETE FROM notes WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Note not found" });
    }

    res.status(204).send();
  })
);

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// --- Graceful shutdown (nice for ECS) ---
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await pool.end().catch(() => {});
  process.exit(0);
});

// --- Start server only after DB init ---
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("DB init failed:", err);
    process.exit(1);
  });
