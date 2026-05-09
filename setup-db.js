const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function setupDatabase() {
  try {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    console.log("Creando tablas en PostgreSQL...");
    await pool.query(schema);

    console.log("Tablas creadas correctamente.");
  } catch (error) {
    console.error("Error creando tablas:", error);
  } finally {
    await pool.end();
  }
}

setupDatabase();