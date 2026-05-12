const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function setupDatabase() {
  try {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    console.log("Creando tablas en PostgreSQL...");
    await pool.query(schema);

    console.log("Verificando columnas nuevas...");

    await pool.query(`
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS genero_uniforme TEXT DEFAULT '';
    `);

    await pool.query(`
      ALTER TABLE producto_tallas
      ADD COLUMN IF NOT EXISTS precio NUMERIC(10, 2) DEFAULT 0;
    `);

    console.log("Tablas creadas correctamente.");
  } catch (error) {
    console.error("Error creando tablas:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

setupDatabase();