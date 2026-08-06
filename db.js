'use strict';

const { Pool } = require("pg");

/* =========================
   CONEXIÓN A POSTGRESQL
========================= */

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  /*
    Render y otros servicios de producción suelen requerir una conexión SSL.
    En desarrollo local se mantiene desactivada.
  */
  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false
});

/* =========================
   EXPORTACIÓN
========================= */

module.exports = pool;