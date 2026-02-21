import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

/**
 * 📝 NOTA PARA CONEXIÓN CON FIREBASE (Backend - Firebase Admin SDK)
 * 
 * Para migrar de SQLite a Firebase, sigue estos pasos:
 * 
 * 1. Instala el SDK: npm install firebase-admin
 * 2. Configura las credenciales en .env:
 *    FIREBASE_PROJECT_ID=...
 *    FIREBASE_CLIENT_EMAIL=...
 *    FIREBASE_PRIVATE_KEY=...
 * 
 * 3. Inicializa Firebase aquí:
 * 
 * import admin from "firebase-admin";
 * 
 * if (!admin.apps.length) {
 *   admin.initializeApp({
 *     credential: admin.credential.cert({
 *       projectId: process.env.FIREBASE_PROJECT_ID,
 *       clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
 *       privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
 *     }),
 *     databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
 *   });
 * }
 * 
 * const firestore = admin.firestore();
 * // O si usas Realtime Database:
 * // const rtdb = admin.database();
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("church_shifts.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS volunteers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    functions TEXT NOT NULL, -- JSON array
    availability TEXT NOT NULL, -- JSON array
    restrictions TEXT NOT NULL, -- JSON array
    total_score INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volunteer_id INTEGER,
    puntualidad INTEGER DEFAULT 0,
    responsabilidad INTEGER DEFAULT 0,
    orden INTEGER DEFAULT 0,
    date TEXT NOT NULL,
    week_start TEXT NOT NULL,
    FOREIGN KEY(volunteer_id) REFERENCES volunteers(id)
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start TEXT NOT NULL,
    service_type TEXT NOT NULL,
    function_name TEXT NOT NULL,
    volunteer_id INTEGER,
    FOREIGN KEY(volunteer_id) REFERENCES volunteers(id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/volunteers", (req, res) => {
    /**
     * 📝 NOTA FIREBASE:
     * const snapshot = await firestore.collection('volunteers').get();
     * const volunteers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
     * res.json(volunteers);
     */
    const volunteers = db.prepare("SELECT * FROM volunteers").all();
    res.json(volunteers.map(v => ({
      ...v,
      functions: JSON.parse(v.functions as string),
      availability: JSON.parse(v.availability as string),
      restrictions: JSON.parse(v.restrictions as string)
    })));
  });

  app.get("/api/volunteers/top10", (req, res) => {
    const volunteers = db.prepare("SELECT * FROM volunteers ORDER BY total_score DESC LIMIT 10").all();
    res.json(volunteers);
  });

  app.post("/api/volunteers", (req, res) => {
    const { name, functions, availability, restrictions } = req.body;
    /**
     * 📝 NOTA FIREBASE:
     * const docRef = await firestore.collection('volunteers').add({
     *   name, functions, availability, restrictions, total_score: 0
     * });
     * res.json({ id: docRef.id });
     */
    const info = db.prepare(
      "INSERT INTO volunteers (name, functions, availability, restrictions) VALUES (?, ?, ?, ?)"
    ).run(name, JSON.stringify(functions), JSON.stringify(availability), JSON.stringify(restrictions));
    res.json({ id: info.lastInsertRowid });
  });

  app.post("/api/volunteers/:id/score", (req, res) => {
    const { puntualidad, responsabilidad, orden, date, week_start } = req.body;
    const volunteerId = req.params.id;
    
    const insertScore = db.prepare(
      "INSERT INTO scores (volunteer_id, puntualidad, responsabilidad, orden, date, week_start) VALUES (?, ?, ?, ?, ?, ?)"
    );
    
    const updateTotal = db.prepare(
      "UPDATE volunteers SET total_score = total_score + ? WHERE id = ?"
    );

    const transaction = db.transaction(() => {
      insertScore.run(volunteerId, puntualidad, responsabilidad, orden, date, week_start);
      updateTotal.run(puntualidad + responsabilidad + orden, volunteerId);
    });

    transaction();
    res.json({ success: true });
  });

  app.post("/api/volunteers/reset-scores", (req, res) => {
    db.prepare("UPDATE volunteers SET total_score = 0").run();
    db.prepare("DELETE FROM scores").run();
    res.json({ success: true });
  });

  app.get("/api/stats/scores", (req, res) => {
    const { period } = req.query;
    // Simplified period logic for demo
    const scores = db.prepare(`
      SELECT v.name, SUM(s.puntualidad + s.responsabilidad + s.orden) as score
      FROM scores s
      JOIN volunteers v ON s.volunteer_id = v.id
      GROUP BY v.id
      ORDER BY score DESC
    `).all();
    res.json(scores);
  });

  app.delete("/api/volunteers/:id", (req, res) => {
    db.prepare("DELETE FROM volunteers WHERE id = ?").run(req.params.id);
    db.prepare("DELETE FROM scores WHERE volunteer_id = ?").run(req.params.id);
    db.prepare("DELETE FROM schedules WHERE volunteer_id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/schedules/:weekStart", (req, res) => {
    const schedules = db.prepare("SELECT * FROM schedules WHERE week_start = ?").all(req.params.weekStart);
    res.json(schedules);
  });

  app.get("/api/schedules/history/:volunteerId", (req, res) => {
    const history = db.prepare("SELECT * FROM schedules WHERE volunteer_id = ? ORDER BY week_start DESC").all(req.params.volunteerId);
    res.json(history);
  });

  app.post("/api/schedules", (req, res) => {
    const { week_start, assignments } = req.body;
    
    const deleteOld = db.prepare("DELETE FROM schedules WHERE week_start = ?");
    const insert = db.prepare(
      "INSERT INTO schedules (week_start, service_type, function_name, volunteer_id) VALUES (?, ?, ?, ?)"
    );

    const transaction = db.transaction((data) => {
      deleteOld.run(week_start);
      for (const item of data) {
        insert.run(week_start, item.service_type, item.function_name, item.volunteer_id);
      }
    });

    transaction(assignments);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
