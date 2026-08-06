'use strict';

const fs = require("fs/promises");
const path = require("path");

const pool = require("./db");

/* =========================
   CONFIGURACIÓN INICIAL
========================= */

const schemaPath = path.join(__dirname, "schema.sql");

/* =========================
   PREPARAR BASE DE DATOS
========================= */

async function setupDatabase() {
  try {
    console.log("Leyendo el archivo schema.sql...");

    const schema = await fs.readFile(
      schemaPath,
      "utf8"
    );

    if (!schema.trim()) {
      throw new Error(
        "El archivo schema.sql está vacío."
      );
    }

    console.log(
      "Creando las tablas en PostgreSQL..."
    );

    await pool.query(schema);

    console.log(
      "Verificando las columnas adicionales..."
    );

    await pool.query(`
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS genero_uniforme
      TEXT DEFAULT '';
    `);

    await pool.query(`
      ALTER TABLE producto_tallas
      ADD COLUMN IF NOT EXISTS precio
      NUMERIC(10, 2) DEFAULT 0;
    `);

    console.log(
      "La base de datos quedó preparada correctamente."
    );
  } catch (error) {
    console.error(
      "No fue posible preparar la base de datos:",
      error
    );

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

setupDatabase();