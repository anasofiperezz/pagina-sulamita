const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { Readable } = require("stream");
const { v2: cloudinary } = require("cloudinary");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const publicDir = __dirname;

app.set("trust proxy", 1);

const SESSION_COOKIE_NAME = "sulamita_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(req) {
  const cookieHeader = String(req.headers.cookie || "");
  const cookies = {};

  cookieHeader.split(";").forEach((part) => {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex < 0) return;

    const rawName = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();

    if (!rawName) return;

    try {
      cookies[rawName] = decodeURIComponent(rawValue);
    } catch (error) {
      cookies[rawName] = rawValue;
    }
  });

  return cookies;
}

function hashSessionToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

function isSecureRequest(req) {
  return (
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "")
      .toLowerCase()
      .split(",")[0]
      .trim() === "https" ||
    process.env.NODE_ENV === "production"
  );
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    maxAge: SESSION_DURATION_MS,
    path: "/"
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/"
  });
}

async function createUserSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await pool.query(
    `
    INSERT INTO sesiones_usuario (
      token_hash,
      usuario_id,
      expira_en
    )
    VALUES ($1, $2, $3)
    `,
    [tokenHash, Number(userId), expiresAt]
  );

  return token;
}

async function requireAuthenticatedSession(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const token = String(cookies[SESSION_COOKIE_NAME] || "").trim();

    if (!token) {
      return res.status(401).json({
        message: "Tu sesión terminó. Inicia sesión nuevamente."
      });
    }

    const tokenHash = hashSessionToken(token);

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.nombre,
        u.email,
        u.rol,
        u.activo,
        s.expira_en
      FROM sesiones_usuario s
      INNER JOIN usuarios u ON u.id = s.usuario_id
      WHERE
        s.token_hash = $1
        AND s.expira_en > NOW()
      LIMIT 1
      `,
      [tokenHash]
    );

    const user = result.rows[0];

    if (!user || user.activo === false) {
      await pool.query(
        "DELETE FROM sesiones_usuario WHERE token_hash = $1",
        [tokenHash]
      );

      clearSessionCookie(req, res);

      return res.status(401).json({
        message: "Tu sesión ya no es válida. Inicia sesión nuevamente."
      });
    }

    req.user = {
      id: Number(user.id),
      nombre: user.nombre,
      email: user.email,
      rol: user.rol
    };

    next();
  } catch (error) {
    console.error("Error validando sesión:", error);

    res.status(500).json({
      message: "No se pudo validar la sesión."
    });
  }
}

function requireAdminSession(req, res, next) {
  requireAuthenticatedSession(req, res, function () {
    if (!req.user || req.user.rol !== "admin") {
      return res.status(403).json({
        message: "Necesitas iniciar sesión como administrador."
      });
    }

    next();
  });
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(publicDir));

/* =========================
   CLOUDINARY
========================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP."));
    }

    cb(null, true);
  }
});

const uploadFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Solo se permiten archivos JPG, PNG, WEBP o PDF."));
    }

    cb(null, true);
  }
});

const uploadSchoolListPdf = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const isPdf =
      file.mimetype === "application/pdf" ||
      String(file.originalname || "").toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return cb(new Error("Solo se permiten archivos PDF."));
    }

    cb(null, true);
  }
});

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || "papeleria-sulamita/productos",
        resource_type: options.resource_type || "image"
      },
      function (error, result) {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    Readable.from(buffer).pipe(stream);
  });
}

/* =========================
   HELPERS PRODUCTOS
========================= */

function normalizeProduct(row) {
  let imagenesUrl = [];

  try {
    if (Array.isArray(row.imagenes_url)) {
      imagenesUrl = row.imagenes_url;
    } else if (typeof row.imagenes_url === "string" && row.imagenes_url.trim()) {
      imagenesUrl = JSON.parse(row.imagenes_url);
    }
  } catch (error) {
    imagenesUrl = [];
  }

  imagenesUrl = imagenesUrl
    .map((url) => String(url || "").trim())
    .filter(Boolean);

  const mainImage = String(row.imagen_url || "").trim();

  if (mainImage && !imagenesUrl.includes(mainImage)) {
    imagenesUrl.unshift(mainImage);
  }

  return {
    id: Number(row.id),
    escuela: row.escuela,
    nivel: row.nivel,
    grado: row.grado || "General",
    grado_secundaria: row.grado_secundaria || "",
    grado_prepa: row.grado_prepa || "",
    area_prepa: row.area_prepa || "",
    categoria: row.categoria,
    genero_uniforme: row.genero_uniforme || "",
    nombre: row.nombre,
    descripcion: row.descripcion || "",
    imagen_url: mainImage || imagenesUrl[0] || "",
    imagenes_url: imagenesUrl,
    precio: Number(row.precio || 0),
    disponible: row.disponible !== false,
    requiere_precio: row.requiere_precio === true,
    aplica_general: row.aplica_general === true,
    creado_en: row.creado_en,
    tallas: Array.isArray(row.tallas)
      ? row.tallas.map((t) => ({
          talla: String(t.talla || "Unidad"),
          stock: Number(t.stock || 0),
          precio: Number(t.precio || 0)
        }))
      : []
  };
}

function cleanProductImages(value, mainImage = "") {
  let images = [];

  if (Array.isArray(value)) {
    images = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      images = JSON.parse(value);
    } catch (error) {
      images = [value];
    }
  }

  images = images
    .map((url) => String(url || "").trim())
    .filter(Boolean);

  const cleanMainImage = String(mainImage || "").trim();

  if (cleanMainImage && !images.includes(cleanMainImage)) {
    images.unshift(cleanMainImage);
  }

  return Array.from(new Set(images));
}

async function getProductsWithSizes(whereSql = "", params = []) {
  const query = `
    SELECT
      p.*,
      COALESCE(
        json_agg(
          json_build_object(
            'talla', pt.talla,
            'stock', pt.stock,
            'precio', pt.precio
          )
          ORDER BY pt.id
        ) FILTER (WHERE pt.id IS NOT NULL),
        '[]'
      ) AS tallas
    FROM productos p
    LEFT JOIN producto_tallas pt ON pt.producto_id = p.id
    ${whereSql}
    GROUP BY p.id
    ORDER BY p.id DESC
  `;

  const result = await pool.query(query, params);
  return result.rows.map(normalizeProduct);
}

function cleanTallas(tallas, productPrice = 0) {
  if (!Array.isArray(tallas)) return [];

  const map = new Map();

  tallas.forEach((item) => {
    const talla = String(item.talla || "Unidad").trim();
    const stock = Math.max(0, Number(item.stock || 0));
    const precio = Math.max(0, Number(item.precio ?? productPrice ?? 0));

    if (!talla) return;

    const key = talla.toLowerCase();
    const current = map.get(key);

    if (current) {
      map.set(key, {
        talla,
        stock: current.stock + stock,
        precio: precio || current.precio
      });
    } else {
      map.set(key, {
        talla,
        stock,
        precio
      });
    }
  });

  return Array.from(map.values());
}

function cleanUniformGender(categoria, generoUniforme) {
  if (categoria !== "Uniformes") return "";

  const value = String(generoUniforme || "").trim();

  if (value === "Mujer" || value === "Hombre" || value === "Unisex") {
    return value;
  }

  return "";
}

function effectiveSizePrice(tallaData, product) {
  const sizePrice = Number(tallaData?.precio || 0);
  const productPrice = Number(product?.precio || 0);

  return sizePrice > 0 ? sizePrice : productPrice;
}

function cleanDiscount(value) {
  const numberValue = Number(value || 0);

  if (Number.isNaN(numberValue)) return 0;
  if (numberValue < 0) return 0;
  if (numberValue > 100) return 100;

  return numberValue;
}

function normalizePackageProductInput(productos) {
  if (!Array.isArray(productos)) return [];

  const ids = productos
    .map((item) => {
      if (typeof item === "number" || typeof item === "string") {
        return Number(item);
      }

      return Number(item.producto_id || item.id);
    })
    .filter((id) => Number.isFinite(id) && id > 0);

  return Array.from(new Set(ids));
}

/* =========================
   HELPERS PAQUETES
========================= */

async function getPackagesWithProducts(onlyActive = false) {
  const packageQuery = onlyActive
    ? `
      SELECT *
      FROM paquetes
      WHERE activo IS TRUE
      ORDER BY id DESC
      `
    : `
      SELECT *
      FROM paquetes
      ORDER BY id DESC
      `;

  const packagesResult = await pool.query(packageQuery);
  const packages = packagesResult.rows;

  if (!packages.length) {
    return [];
  }

  const packageIds = packages.map((item) => Number(item.id));

  const packageProductsResult = await pool.query(
    `
    SELECT
      pp.paquete_id,
      pp.producto_id,
      pp.orden
    FROM paquete_productos pp
    WHERE pp.paquete_id = ANY($1::int[])
    ORDER BY pp.paquete_id DESC, pp.orden ASC, pp.id ASC
    `,
    [packageIds]
  );

  const productIds = Array.from(
    new Set(packageProductsResult.rows.map((row) => Number(row.producto_id)))
  );

  let productsMap = {};

  if (productIds.length) {
    const products = await getProductsWithSizes(
      `WHERE p.id = ANY($1::int[])`,
      [productIds]
    );

    products.forEach((product) => {
      productsMap[String(product.id)] = product;
    });
  }

  return packages.map((pkg) => {
    const productos = packageProductsResult.rows
      .filter((row) => Number(row.paquete_id) === Number(pkg.id))
      .map((row) => {
        const product = productsMap[String(row.producto_id)] || null;

        return {
          producto_id: Number(row.producto_id),
          orden: Number(row.orden || 0),
          producto: product
        };
      })
      .filter((item) => item.producto);

    return {
      id: Number(pkg.id),
      nombre: pkg.nombre,
      descripcion: pkg.descripcion || "",
      descuento: Number(pkg.descuento || 0),
      activo: pkg.activo !== false,
      creado_en: pkg.creado_en,
      productos
    };
  });
}

/* =========================
   ACTUALIZACIONES BD
========================= */

async function ensureDatabaseUpdates() {
  try {
    await pool.query(`
      ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sesiones_usuario (
        token_hash TEXT PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        expira_en TIMESTAMP NOT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_id
      ON sesiones_usuario(usuario_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sesiones_expira_en
      ON sesiones_usuario(expira_en);
    `);

    await pool.query(`
      DELETE FROM sesiones_usuario
      WHERE expira_en <= NOW();
    `);

    await pool.query(`
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS imagen_url TEXT DEFAULT '';
    `);

    await pool.query(`
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS imagenes_url JSONB DEFAULT '[]'::jsonb;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS zonas_envio (
        id SERIAL PRIMARY KEY,
        numero INTEGER NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        costo NUMERIC(10, 2) NOT NULL,
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      INSERT INTO zonas_envio (numero, nombre, costo, activo)
      VALUES
        (1, 'Zona 1', 150.00, TRUE),
        (2, 'Zona 2', 175.00, TRUE),
        (3, 'Zona 3', 200.00, TRUE),
        (4, 'Zona 4', 225.00, TRUE),
        (5, 'Zona 5', 250.00, TRUE),
        (6, 'Zona 6', 275.00, TRUE)
      ON CONFLICT (numero)
      DO UPDATE SET
        nombre = EXCLUDED.nombre,
        costo = EXCLUDED.costo,
        activo = TRUE;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cobertura_envio (
        id SERIAL PRIMARY KEY,
        zona_id INTEGER NOT NULL REFERENCES zonas_envio(id) ON DELETE CASCADE,
        colonia TEXT NOT NULL,
        codigo_postal TEXT NOT NULL,
        municipio TEXT NOT NULL,
        estado TEXT NOT NULL,
        pais TEXT NOT NULL DEFAULT 'México',
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (codigo_postal, colonia, municipio, estado, pais)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cobertura_envio_cp
      ON cobertura_envio(codigo_postal);
    `);

    await pool.query(`
      ALTER TABLE cobertura_envio
      ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'México';
    `);

    await pool.query(`
      UPDATE cobertura_envio
      SET pais = 'México'
      WHERE pais IS NULL OR TRIM(pais) = '';
    `);

    await pool.query(`
      ALTER TABLE cobertura_envio
      ALTER COLUMN pais SET NOT NULL;
    `);

    await pool.query(`
      ALTER TABLE cobertura_envio
      DROP CONSTRAINT IF EXISTS cobertura_envio_codigo_postal_colonia_municipio_estado_key;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cobertura_envio_ubicacion_completa
      ON cobertura_envio (
        codigo_postal,
        colonia,
        municipio,
        estado,
        pais
      );
    `);


    await pool.query(`
      CREATE TABLE IF NOT EXISTS reglas_envio (
        id SERIAL PRIMARY KEY,
        zona_id INTEGER NOT NULL REFERENCES zonas_envio(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (
          tipo IN ('codigo_postal', 'colonia', 'municipio', 'estado', 'pais')
        ),
        valor TEXT NOT NULL,
        valor_normalizado TEXT NOT NULL,
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (zona_id, tipo, valor_normalizado)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reglas_envio_busqueda
      ON reglas_envio(tipo, valor_normalizado)
      WHERE activo IS NOT FALSE;
    `);

    await pool.query(`
      ALTER TABLE reglas_envio
      DROP CONSTRAINT IF EXISTS reglas_envio_tipo_valor_normalizado_key;
    `);

    await pool.query(`
      DROP INDEX IF EXISTS reglas_envio_tipo_valor_normalizado_key;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_envio_zona_tipo_valor
      ON reglas_envio(zona_id, tipo, valor_normalizado);
    `);

    /*
      Los códigos postales y las alcaldías/municipios pueden repetirse
      en varias zonas. Las colonias son exclusivas: una colonia solo
      puede apuntar a una zona.
    */
    await pool.query(`
      DELETE FROM reglas_envio anterior
      USING reglas_envio reciente
      WHERE
        anterior.tipo = 'colonia'
        AND reciente.tipo = 'colonia'
        AND anterior.valor_normalizado = reciente.valor_normalizado
        AND anterior.id < reciente.id;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_envio_colonia_unica
      ON reglas_envio(valor_normalizado)
      WHERE tipo = 'colonia';
    `);

    await pool.query(`
      ALTER TABLE pedidos
      ADD COLUMN IF NOT EXISTS requiere_factura BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS datos_factura JSONB,
      ADD COLUMN IF NOT EXISTS descuento NUMERIC(10, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'pendiente',
      ADD COLUMN IF NOT EXISTS mp_preference_id TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS mp_payment_id TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS mp_status TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS zona_envio_id INTEGER REFERENCES zonas_envio(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS zona_envio TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS datos_envio JSONB,
      ADD COLUMN IF NOT EXISTS tiempo_entrega TEXT DEFAULT '';
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS paquetes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        descripcion TEXT DEFAULT '',
        descuento NUMERIC(5, 2) DEFAULT 0,
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS paquete_productos (
        id SERIAL PRIMARY KEY,
        paquete_id INTEGER NOT NULL REFERENCES paquetes(id) ON DELETE CASCADE,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        orden INTEGER DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS listas_utiles (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        descripcion TEXT DEFAULT '',
        tipo TEXT DEFAULT 'Escuela',
        escuela TEXT DEFAULT '',
        nivel TEXT DEFAULT '',
        grado TEXT DEFAULT '',
        archivo_url TEXT NOT NULL,
        archivo_tipo TEXT DEFAULT '',
        archivo_nombre TEXT DEFAULT '',
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Base de datos actualizada correctamente.");
  } catch (error) {
    console.error("Error actualizando base de datos:", error);
  }
}


async function ensureShippingRulesSetup() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS zonas_envio (
        id SERIAL PRIMARY KEY,
        numero INTEGER NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        costo NUMERIC(10, 2) NOT NULL,
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const fixedZones = [
      [1, "Zona 1", 150],
      [2, "Zona 2", 175],
      [3, "Zona 3", 200],
      [4, "Zona 4", 225],
      [5, "Zona 5", 250],
      [6, "Zona 6", 275]
    ];

    for (const [numero, nombre, costo] of fixedZones) {
      await pool.query(
        `
        INSERT INTO zonas_envio (numero, nombre, costo, activo)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (numero)
        DO UPDATE SET
          nombre = EXCLUDED.nombre,
          costo = EXCLUDED.costo,
          activo = TRUE
        `,
        [numero, nombre, costo]
      );
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reglas_envio (
        id SERIAL PRIMARY KEY,
        zona_id INTEGER NOT NULL REFERENCES zonas_envio(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (
          tipo IN ('codigo_postal', 'colonia', 'municipio', 'estado', 'pais')
        ),
        valor TEXT NOT NULL,
        valor_normalizado TEXT NOT NULL,
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (zona_id, tipo, valor_normalizado)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reglas_envio_busqueda
      ON reglas_envio(tipo, valor_normalizado)
      WHERE activo IS NOT FALSE;
    `);

    await pool.query(`
      ALTER TABLE reglas_envio
      DROP CONSTRAINT IF EXISTS reglas_envio_tipo_valor_normalizado_key;
    `);

    await pool.query(`
      DROP INDEX IF EXISTS reglas_envio_tipo_valor_normalizado_key;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_envio_zona_tipo_valor
      ON reglas_envio(zona_id, tipo, valor_normalizado);
    `);

    /*
      Los códigos postales y las alcaldías/municipios pueden repetirse
      en varias zonas. Las colonias son exclusivas: una colonia solo
      puede apuntar a una zona.
    */
    await pool.query(`
      DELETE FROM reglas_envio anterior
      USING reglas_envio reciente
      WHERE
        anterior.tipo = 'colonia'
        AND reciente.tipo = 'colonia'
        AND anterior.valor_normalizado = reciente.valor_normalizado
        AND anterior.id < reciente.id;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_envio_colonia_unica
      ON reglas_envio(valor_normalizado)
      WHERE tipo = 'colonia';
    `);

    console.log("Catálogos de zonas de envío listos.");
  } catch (error) {
    console.error("Error preparando catálogos de zonas de envío:", error);
    throw error;
  }
}

/* =========================
   STATUS
========================= */

app.get("/api", (req, res) => {
  res.json({ message: "Papelería Sulamita API working with PostgreSQL" });
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: "Faltan datos para iniciar sesión." });
    }

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    const cleanRole = role === "admin" ? "admin" : "cliente";

    const result = await pool.query(
      `
      SELECT id, nombre, email, rol, activo
      FROM usuarios
      WHERE email = $1 AND password = $2 AND rol = $3
      LIMIT 1
      `,
      [cleanEmail, cleanPassword, cleanRole]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    if (user.activo === false) {
      return res.status(403).json({
        message: "Este usuario está desactivado. Contacta al administrador."
      });
    }

    const sessionToken = await createUserSession(user.id);
    setSessionCookie(req, res, sessionToken);

    res.json({
      message: "Login correcto",
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (error) {
    console.error("Error en /api/login:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/api/session", requireAuthenticatedSession, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user
  });
});

app.post("/api/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = String(cookies[SESSION_COOKIE_NAME] || "").trim();

    if (token) {
      await pool.query(
        "DELETE FROM sesiones_usuario WHERE token_hash = $1",
        [hashSessionToken(token)]
      );
    }

    clearSessionCookie(req, res);

    res.json({
      message: "Sesión cerrada correctamente."
    });
  } catch (error) {
    console.error("Error en POST /api/logout:", error);
    clearSessionCookie(req, res);

    res.status(500).json({
      message: "No se pudo cerrar la sesión correctamente."
    });
  }
});

/* =========================
   REGISTRO
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    const cleanName = String(nombre || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

    if (!cleanName || !cleanEmail || !cleanPassword) {
      return res.status(400).json({ message: "Faltan datos obligatorios." });
    }

    const exists = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1 LIMIT 1",
      [cleanEmail]
    );

    if (exists.rows.length) {
      return res.status(400).json({ message: "El correo ya está registrado" });
    }

    const result = await pool.query(
      `
      INSERT INTO usuarios (nombre, email, password, rol, activo)
      VALUES ($1, $2, $3, 'cliente', TRUE)
      RETURNING id
      `,
      [cleanName, cleanEmail, cleanPassword]
    );

    res.status(201).json({
      message: "Usuario registrado correctamente",
      userId: result.rows[0].id
    });
  } catch (error) {
    console.error("Error en /api/register:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

/* =========================
   ADMIN - USUARIOS
========================= */

function getAdminCodeFromRequest(req) {
  return String(req.headers["x-admin-code"] || req.body?.admin_code || "").trim();
}

function validateAdminCreationCode(req, res) {
  const serverCode = String(process.env.ADMIN_CREATION_CODE || "").trim();
  const requestCode = getAdminCodeFromRequest(req);

  if (!serverCode) {
    res.status(500).json({
      message: "Falta configurar ADMIN_CREATION_CODE en Render."
    });
    return false;
  }

  if (!requestCode || requestCode !== serverCode) {
    res.status(403).json({ message: "Clave de administrador incorrecta." });
    return false;
  }

  return true;
}

function cleanUserRole(role) {
  return role === "admin" ? "admin" : "cliente";
}

app.get("/api/admin/usuarios", async (req, res) => {
  try {
    if (!validateAdminCreationCode(req, res)) return;

    const result = await pool.query(
      `
      SELECT id, nombre, email, rol, activo
      FROM usuarios
      ORDER BY id DESC
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error en GET /api/admin/usuarios:", error);
    res.status(500).json({ message: "Error al obtener usuarios." });
  }
});

app.post("/api/admin/usuarios", async (req, res) => {
  try {
    if (!validateAdminCreationCode(req, res)) return;

    const { nombre, email, password, rol } = req.body;

    const cleanName = String(nombre || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    const cleanRole = cleanUserRole(rol);

    if (!cleanName || !cleanEmail || !cleanPassword) {
      return res.status(400).json({ message: "Completa todos los campos." });
    }

    const exists = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1 LIMIT 1",
      [cleanEmail]
    );

    if (exists.rows.length) {
      return res.status(400).json({ message: "El correo ya está registrado." });
    }

    const result = await pool.query(
      `
      INSERT INTO usuarios (nombre, email, password, rol, activo)
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING id, nombre, email, rol, activo
      `,
      [cleanName, cleanEmail, cleanPassword, cleanRole]
    );

    res.status(201).json({
      message: "Usuario creado correctamente.",
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Error en POST /api/admin/usuarios:", error);
    res.status(500).json({ message: "Error al crear usuario." });
  }
});

app.put("/api/admin/usuarios/:id", async (req, res) => {
  try {
    if (!validateAdminCreationCode(req, res)) return;

    const userId = Number(req.params.id);
    const { nombre, email, password, rol, activo } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "Usuario inválido." });
    }

    const exists = await pool.query(
      "SELECT * FROM usuarios WHERE id = $1 LIMIT 1",
      [userId]
    );

    if (!exists.rows.length) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const current = exists.rows[0];

    const newName = nombre != null ? String(nombre || "").trim() : current.nombre;
    const newEmail = email != null ? String(email || "").trim().toLowerCase() : current.email;
    const newPassword = password ? String(password) : current.password;
    const newRole = rol != null ? cleanUserRole(rol) : current.rol;
    const newActive = activo != null ? Boolean(activo) : current.activo !== false;

    if (!newName || !newEmail || !newPassword) {
      return res.status(400).json({
        message: "Nombre, correo y contraseña son obligatorios."
      });
    }

    const duplicate = await pool.query(
      `
      SELECT id
      FROM usuarios
      WHERE email = $1 AND id <> $2
      LIMIT 1
      `,
      [newEmail, userId]
    );

    if (duplicate.rows.length) {
      return res.status(400).json({
        message: "Ese correo ya está registrado en otro usuario."
      });
    }

    const result = await pool.query(
      `
      UPDATE usuarios
      SET nombre = $1, email = $2, password = $3, rol = $4, activo = $5
      WHERE id = $6
      RETURNING id, nombre, email, rol, activo
      `,
      [newName, newEmail, newPassword, newRole, newActive, userId]
    );

    res.json({
      message: "Usuario actualizado correctamente.",
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Error en PUT /api/admin/usuarios/:id:", error);
    res.status(500).json({ message: "Error al actualizar usuario." });
  }
});

app.delete("/api/admin/usuarios/:id", async (req, res) => {
  try {
    if (!validateAdminCreationCode(req, res)) return;

    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({
        message: "Usuario inválido."
      });
    }

    const userResult = await pool.query(
      `
      SELECT id, nombre, email, rol, activo
      FROM usuarios
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        message: "Usuario no encontrado."
      });
    }

    if (user.rol === "admin" && user.activo !== false) {
      const activeAdminsResult = await pool.query(
        `
        SELECT COUNT(*)::int AS total
        FROM usuarios
        WHERE rol = 'admin' AND activo IS NOT FALSE
        `
      );

      const activeAdmins = Number(activeAdminsResult.rows[0]?.total || 0);

      if (activeAdmins <= 1) {
        return res.status(400).json({
          message: "No puedes borrar el único administrador activo."
        });
      }
    }

    await pool.query(
      "DELETE FROM usuarios WHERE id = $1",
      [userId]
    );

    res.json({
      message: "Usuario eliminado correctamente."
    });
  } catch (error) {
    console.error("Error en DELETE /api/admin/usuarios/:id:", error);

    res.status(500).json({
      message: "Error al eliminar usuario."
    });
  }
});

/* =========================
   CATÁLOGO
========================= */

app.get("/api/catalogo", async (req, res) => {
  try {
    const { escuela, nivel } = req.query;

    const conditions = ["p.disponible IS NOT FALSE"];
    const params = [];

    if (escuela && nivel) {
      params.push(escuela, nivel);

      conditions.push(`
        (
          p.aplica_general = TRUE
          OR p.escuela = 'General'
          OR p.nivel = 'General'
          OR (p.escuela = $1 AND p.nivel = $2)
        )
      `);
    } else if (escuela) {
      params.push(escuela);

      conditions.push(`
        (
          p.aplica_general = TRUE
          OR p.escuela = 'General'
          OR p.escuela = $1
        )
      `);
    } else if (nivel) {
      params.push(nivel);

      conditions.push(`
        (
          p.aplica_general = TRUE
          OR p.nivel = 'General'
          OR p.nivel = $1
        )
      `);
    }

    const productos = await getProductsWithSizes(
      `WHERE ${conditions.join(" AND ")}`,
      params
    );

    res.json(productos);
  } catch (error) {
    console.error("Error en /api/catalogo:", error);
    res.status(500).json({ message: "Error al obtener catálogo" });
  }
});

/* =========================
   PAQUETES CLIENTE
========================= */

app.get("/api/paquetes", async (req, res) => {
  try {
    const paquetes = await getPackagesWithProducts(true);
    res.json(paquetes);
  } catch (error) {
    console.error("Error en GET /api/paquetes:", error);
    res.status(500).json({ message: "Error al obtener paquetes" });
  }
});

/* =========================
   ADMIN - PAQUETES
========================= */

app.get("/api/admin/paquetes", async (req, res) => {
  try {
    const paquetes = await getPackagesWithProducts(false);
    res.json(paquetes);
  } catch (error) {
    console.error("Error en GET /api/admin/paquetes:", error);
    res.status(500).json({ message: "Error al obtener paquetes" });
  }
});

app.post("/api/admin/paquetes", async (req, res) => {
  const client = await pool.connect();

  try {
    const { nombre, descripcion, descuento, activo, productos } = req.body;

    const cleanName = String(nombre || "").trim();
    const cleanDescription = String(descripcion || "").trim();
    const cleanProductIds = normalizePackageProductInput(productos);
    const cleanPackageDiscount = cleanDiscount(descuento);

    if (!cleanName) {
      return res.status(400).json({ message: "Escribe el nombre del paquete." });
    }

    if (!cleanProductIds.length) {
      return res.status(400).json({ message: "Selecciona productos para el paquete." });
    }

    const existingProducts = await client.query(
      `
      SELECT id
      FROM productos
      WHERE id = ANY($1::int[])
      `,
      [cleanProductIds]
    );

    if (existingProducts.rows.length !== cleanProductIds.length) {
      return res.status(400).json({
        message: "Uno o más productos seleccionados no existen."
      });
    }

    await client.query("BEGIN");

    const packageResult = await client.query(
      `
      INSERT INTO paquetes (
        nombre,
        descripcion,
        descuento,
        activo
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [
        cleanName,
        cleanDescription,
        cleanPackageDiscount,
        activo !== false
      ]
    );

    const paqueteId = packageResult.rows[0].id;

    for (let index = 0; index < cleanProductIds.length; index++) {
      await client.query(
        `
        INSERT INTO paquete_productos (
          paquete_id,
          producto_id,
          orden
        )
        VALUES ($1, $2, $3)
        `,
        [paqueteId, cleanProductIds[index], index + 1]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Paquete creado correctamente",
      paqueteId
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error en POST /api/admin/paquetes:", error);
    res.status(500).json({ message: "Error al crear paquete" });
  } finally {
    client.release();
  }
});

app.put("/api/admin/paquetes/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const paqueteId = Number(req.params.id);
    const { nombre, descripcion, descuento, activo, productos } = req.body;

    if (!paqueteId) {
      return res.status(400).json({ message: "Paquete inválido." });
    }

    const exists = await client.query(
      "SELECT * FROM paquetes WHERE id = $1 LIMIT 1",
      [paqueteId]
    );

    if (!exists.rows.length) {
      return res.status(404).json({ message: "Paquete no encontrado." });
    }

    const current = exists.rows[0];

    const cleanName =
      nombre != null ? String(nombre || "").trim() : current.nombre;

    const cleanDescription =
      descripcion != null ? String(descripcion || "").trim() : current.descripcion || "";

    const cleanPackageDiscount =
      descuento != null ? cleanDiscount(descuento) : Number(current.descuento || 0);

    const cleanActive =
      activo != null ? Boolean(activo) : current.activo !== false;

    if (!cleanName) {
      return res.status(400).json({ message: "Escribe el nombre del paquete." });
    }

    let cleanProductIds = null;

    if (Array.isArray(productos)) {
      cleanProductIds = normalizePackageProductInput(productos);

      if (!cleanProductIds.length) {
        return res.status(400).json({ message: "Selecciona productos para el paquete." });
      }

      const existingProducts = await client.query(
        `
        SELECT id
        FROM productos
        WHERE id = ANY($1::int[])
        `,
        [cleanProductIds]
      );

      if (existingProducts.rows.length !== cleanProductIds.length) {
        return res.status(400).json({
          message: "Uno o más productos seleccionados no existen."
        });
      }
    }

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE paquetes
      SET
        nombre = $1,
        descripcion = $2,
        descuento = $3,
        activo = $4
      WHERE id = $5
      `,
      [
        cleanName,
        cleanDescription,
        cleanPackageDiscount,
        cleanActive,
        paqueteId
      ]
    );

    if (cleanProductIds) {
      await client.query(
        "DELETE FROM paquete_productos WHERE paquete_id = $1",
        [paqueteId]
      );

      for (let index = 0; index < cleanProductIds.length; index++) {
        await client.query(
          `
          INSERT INTO paquete_productos (
            paquete_id,
            producto_id,
            orden
          )
          VALUES ($1, $2, $3)
          `,
          [paqueteId, cleanProductIds[index], index + 1]
        );
      }
    }

    await client.query("COMMIT");

    res.json({ message: "Paquete actualizado correctamente" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error en PUT /api/admin/paquetes/:id:", error);
    res.status(500).json({ message: "Error al actualizar paquete" });
  } finally {
    client.release();
  }
});

app.delete("/api/admin/paquetes/:id", async (req, res) => {
  try {
    const paqueteId = Number(req.params.id);

    if (!paqueteId) {
      return res.status(400).json({ message: "Paquete inválido." });
    }

    const result = await pool.query(
      "DELETE FROM paquetes WHERE id = $1 RETURNING id",
      [paqueteId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Paquete no encontrado." });
    }

    res.json({ message: "Paquete eliminado correctamente" });
  } catch (error) {
    console.error("Error en DELETE /api/admin/paquetes/:id:", error);
    res.status(500).json({ message: "Error al eliminar paquete" });
  }
});

/* =========================
   ADMIN - SUBIR IMAGEN PRODUCTO
========================= */

app.post("/api/admin/subir-imagen", function (req, res) {
  uploadImage.single("imagen")(req, res, async function (error) {
    try {
      if (error) {
        return res.status(400).json({
          message: error.message || "No se pudo procesar la imagen."
        });
      }

      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({
          message: "Faltan las variables de Cloudinary en Render."
        });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No se recibió ninguna imagen." });
      }

      const result = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "papeleria-sulamita/productos",
        resource_type: "image"
      });

      res.status(201).json({
        message: "Imagen subida correctamente",
        imagen_url: result.secure_url
      });
    } catch (uploadError) {
      console.error("Error en POST /api/admin/subir-imagen:", uploadError);

      res.status(500).json({
        message: uploadError.message || "Error al subir imagen."
      });
    }
  });
});

/* =========================
   SUBIR ARCHIVOS FACTURA
========================= */

app.post("/api/subir-archivo", function (req, res) {
  uploadFile.single("archivo")(req, res, async function (error) {
    try {
      if (error) {
        return res.status(400).json({
          message: error.message || "No se pudo procesar el archivo."
        });
      }

      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({
          message: "Faltan las variables de Cloudinary en Render."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "No se recibió ningún archivo."
        });
      }

      const result = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "papeleria-sulamita/facturacion",
        resource_type: "auto"
      });

      res.status(201).json({
        message: "Archivo subido correctamente",
        url: result.secure_url
      });
    } catch (uploadError) {
      console.error("Error en POST /api/subir-archivo:", uploadError);

      res.status(500).json({
        message: uploadError.message || "Error al subir archivo."
      });
    }
  });
});

/* =========================
   MERCADO PAGO - CREAR PREFERENCIA
========================= */

app.post("/api/mercadopago/crear-preferencia", async (req, res) => {
  try {
    const { pedido } = req.body;

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({
        message: "Falta configurar MP_ACCESS_TOKEN en Render."
      });
    }

    if (!pedido || !pedido.total || !Array.isArray(pedido.productos) || !pedido.productos.length) {
      return res.status(400).json({
        message: "Faltan datos del pedido para crear el pago."
      });
    }

    const total = Number(pedido.total || 0);

    if (total <= 0) {
      return res.status(400).json({
        message: "El total del pedido no es válido."
      });
    }

    const baseUrl =
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;

    const preferencePayload = {
      items: [
        {
          title: "Pedido Papelería Sulamita",
          description: "Compra en línea Papelería Sulamita",
          quantity: 1,
          currency_id: "MXN",
          unit_price: Number(total.toFixed(2))
        }
      ],
      payer: {
        name: pedido.nombre_cliente || "Cliente",
        email: pedido.email_cliente || ""
      },
      back_urls: {
        success: `${baseUrl}/pago-exitoso.html`,
        failure: `${baseUrl}/pago-cancelado.html`,
        pending: `${baseUrl}/pago-pendiente.html`
      },
      auto_return: "approved",
      statement_descriptor: "PAPELERIA",
      external_reference: `pedido-${Date.now()}`,
      metadata: {
        cliente: pedido.nombre_cliente || "",
        email: pedido.email_cliente || "",
        total: total
      }
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(preferencePayload)
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Error Mercado Pago:", mpData);

      return res.status(400).json({
        message: mpData.message || "No se pudo crear el pago con Mercado Pago.",
        error: mpData
      });
    }

    res.status(201).json({
      message: "Preferencia creada correctamente.",
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point
    });
  } catch (error) {
    console.error("Error en /api/mercadopago/crear-preferencia:", error);

    res.status(500).json({
      message: "Error al crear preferencia de Mercado Pago."
    });
  }
});

/* =========================
   ADMIN - VER PRODUCTOS
========================= */

app.get("/api/admin/productos", async (req, res) => {
  try {
    const productos = await getProductsWithSizes();
    res.json(productos);
  } catch (error) {
    console.error("Error en /api/admin/productos:", error);
    res.status(500).json({ message: "Error al obtener productos" });
  }
});

/* =========================
   ADMIN - AGREGAR PRODUCTO
========================= */

app.post("/api/admin/productos", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      escuela,
      nivel,
      grado,
      grado_secundaria,
      grado_prepa,
      area_prepa,
      categoria,
      genero_uniforme,
      nombre,
      descripcion,
      imagen_url,
      imagenes_url,
      precio,
      disponible,
      requiere_precio,
      aplica_general,
      tallas
    } = req.body;

    if (!categoria || !nombre) {
      return res.status(400).json({ message: "Faltan campos obligatorios." });
    }

    const esGeneral =
      aplica_general === true ||
      escuela === "General" ||
      nivel === "General";

    if (!esGeneral && (!escuela || !nivel)) {
      return res.status(400).json({
        message: "Selecciona escuela y nivel, o marca el producto como general."
      });
    }

    const productPrice = Number(precio) || 0;
    const tallasLimpias = cleanTallas(tallas, productPrice);

    if (!tallasLimpias.length) {
      return res.status(400).json({ message: "Agrega stock para el producto." });
    }

    const generoFinal = cleanUniformGender(categoria, genero_uniforme);
    const cleanImages = cleanProductImages(imagenes_url, imagen_url);
    const mainImage = cleanImages[0] || String(imagen_url || "").trim();

    await client.query("BEGIN");

    const productResult = await client.query(
      `
      INSERT INTO productos (
        escuela,
        nivel,
        grado,
        grado_secundaria,
        grado_prepa,
        area_prepa,
        categoria,
        genero_uniforme,
        nombre,
        descripcion,
        imagen_url,
        imagenes_url,
        precio,
        disponible,
        requiere_precio,
        aplica_general
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )
      RETURNING id
      `,
      [
        esGeneral ? "General" : escuela,
        esGeneral ? "General" : nivel,
        esGeneral ? "General" : (grado || "General"),
        !esGeneral && nivel === "Secundaria"
          ? String(grado_secundaria || grado || "")
          : "",
        !esGeneral && nivel === "Preparatoria"
          ? String(grado_prepa || grado || "")
          : "",
        !esGeneral && nivel === "Preparatoria"
          ? String(area_prepa || "")
          : "",
        categoria,
        generoFinal,
        nombre,
        descripcion || "",
        mainImage,
        JSON.stringify(cleanImages),
        productPrice,
        disponible !== false,
        Boolean(requiere_precio),
        esGeneral
      ]
    );

    const productId = productResult.rows[0].id;

    for (const tallaItem of tallasLimpias) {
      await client.query(
        `
        INSERT INTO producto_tallas (producto_id, talla, stock, precio)
        VALUES ($1, $2, $3, $4)
        `,
        [productId, tallaItem.talla, tallaItem.stock, tallaItem.precio]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Producto agregado correctamente",
      productId
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error en POST /api/admin/productos:", error);
    res.status(500).json({ message: "Error al agregar producto" });
  } finally {
    client.release();
  }
});

/* =========================
   ADMIN - ACTUALIZAR PRODUCTO
========================= */

app.put("/api/admin/productos/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const productId = Number(req.params.id);

    const {
      escuela,
      nivel,
      grado,
      grado_secundaria,
      grado_prepa,
      area_prepa,
      categoria,
      genero_uniforme,
      nombre,
      descripcion,
      imagen_url,
      imagenes_url,
      precio,
      disponible,
      requiere_precio,
      aplica_general,
      tallas
    } = req.body;

    const exists = await client.query(
      "SELECT * FROM productos WHERE id = $1 LIMIT 1",
      [productId]
    );

    if (!exists.rows.length) {
      return res.status(404).json({ message: "Producto no encontrado." });
    }

    const current = exists.rows[0];

    const newCategoria = categoria != null ? categoria : current.categoria;
    const newGeneroUniforme =
      genero_uniforme != null
        ? cleanUniformGender(newCategoria, genero_uniforme)
        : cleanUniformGender(newCategoria, current.genero_uniforme);

    let newAplicaGeneral =
      aplica_general != null ? Boolean(aplica_general) : current.aplica_general;

    let newEscuela = current.escuela;
    let newNivel = current.nivel;
    let newGrado = current.grado;
    let newGradoSecundaria = current.grado_secundaria;
    let newGradoPrepa = current.grado_prepa;
    let newAreaPrepa = current.area_prepa;

    if (newAplicaGeneral) {
      newEscuela = "General";
      newNivel = "General";
      newGrado = "General";
      newGradoSecundaria = "";
      newGradoPrepa = "";
      newAreaPrepa = "";
    } else {
      if (escuela != null) newEscuela = escuela;
      if (nivel != null) newNivel = nivel;
      if (grado != null) newGrado = grado || "General";
      if (grado_secundaria != null) newGradoSecundaria = String(grado_secundaria || "");
      if (grado_prepa != null) newGradoPrepa = String(grado_prepa || "");
      if (area_prepa != null) newAreaPrepa = String(area_prepa || "");
    }

    const newPrice =
      precio != null ? Number(precio) || 0 : Number(current.precio) || 0;

    const currentImages = cleanProductImages(current.imagenes_url, current.imagen_url);
    const cleanImages =
      imagenes_url != null
        ? cleanProductImages(imagenes_url, imagen_url != null ? imagen_url : current.imagen_url)
        : currentImages;

    const mainImage =
      imagen_url != null
        ? String(imagen_url || "").trim()
        : cleanImages[0] || String(current.imagen_url || "").trim();

    const finalImages = cleanProductImages(cleanImages, mainImage);

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE productos
      SET
        escuela = $1,
        nivel = $2,
        grado = $3,
        grado_secundaria = $4,
        grado_prepa = $5,
        area_prepa = $6,
        categoria = $7,
        genero_uniforme = $8,
        nombre = $9,
        descripcion = $10,
        imagen_url = $11,
        imagenes_url = $12,
        precio = $13,
        disponible = $14,
        requiere_precio = $15,
        aplica_general = $16
      WHERE id = $17
      `,
      [
        newEscuela,
        newNivel,
        newGrado,
        newGradoSecundaria || "",
        newGradoPrepa || "",
        newAreaPrepa || "",
        newCategoria,
        newGeneroUniforme,
        nombre != null ? nombre : current.nombre,
        descripcion != null ? descripcion : current.descripcion,
        mainImage,
        JSON.stringify(finalImages),
        newPrice,
        disponible != null ? Boolean(disponible) : current.disponible,
        requiere_precio != null ? Boolean(requiere_precio) : current.requiere_precio,
        newAplicaGeneral,
        productId
      ]
    );

    if (Array.isArray(tallas)) {
      const tallasLimpias = cleanTallas(tallas, newPrice);

      await client.query(
        "DELETE FROM producto_tallas WHERE producto_id = $1",
        [productId]
      );

      for (const tallaItem of tallasLimpias) {
        await client.query(
          `
          INSERT INTO producto_tallas (producto_id, talla, stock, precio)
          VALUES ($1, $2, $3, $4)
          `,
          [productId, tallaItem.talla, tallaItem.stock, tallaItem.precio]
        );
      }
    }

    await client.query("COMMIT");

    res.json({ message: "Producto actualizado correctamente" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error en PUT /api/admin/productos/:id:", error);
    res.status(500).json({ message: "Error al actualizar producto" });
  } finally {
    client.release();
  }
});

/* =========================
   ADMIN - ELIMINAR PRODUCTO
========================= */

app.delete("/api/admin/productos/:id", async (req, res) => {
  try {
    const productId = Number(req.params.id);

    const result = await pool.query(
      "DELETE FROM productos WHERE id = $1 RETURNING id",
      [productId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Producto no encontrado." });
    }

    res.json({ message: "Producto eliminado correctamente" });
  } catch (error) {
    console.error("Error en DELETE /api/admin/productos/:id:", error);
    res.status(500).json({ message: "Error al eliminar producto" });
  }
});

/* =========================
   ZONAS Y REGLAS DE ENVÍO
========================= */

const SHIPPING_RULE_TYPES = new Set([
  "codigo_postal",
  "colonia",
  "municipio",
  "estado",
  "pais"
]);

const SHIPPING_RULE_PRIORITY = [
  "codigo_postal",
  "colonia",
  "municipio",
  "estado",
  "pais"
];

function cleanPostalCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function normalizeComparableText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeShippingRuleType(value) {
  const type = String(value || "").trim().toLowerCase();
  return SHIPPING_RULE_TYPES.has(type) ? type : "";
}

function normalizeShippingRuleValue(type, value) {
  if (type === "codigo_postal") {
    const postalCode = cleanPostalCode(value);
    return /^\d{5}$/.test(postalCode) ? postalCode : "";
  }

  return normalizeComparableText(value);
}

function shippingRuleTypeLabel(type) {
  const labels = {
    codigo_postal: "Código postal",
    colonia: "Colonia",
    municipio: "Alcaldía o municipio",
    estado: "Estado o entidad federativa",
    pais: "País"
  };

  return labels[type] || type;
}

function normalizeShippingRule(row) {
  return {
    id: Number(row.id),
    zona_id: Number(row.zona_id),
    zona_numero: Number(row.zona_numero),
    zona: row.zona || `Zona ${Number(row.zona_numero || 0)}`,
    costo: Number(row.costo || 0),
    tipo: row.tipo || "",
    tipo_etiqueta: shippingRuleTypeLabel(row.tipo),
    valor: row.valor || "",
    activo: row.activo !== false,
    creado_en: row.creado_en
  };
}

function isValidReceiveTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);

  if (!match) return false;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;

  return hour >= 15;
}

function cleanShippingData(value) {
  const data = value && typeof value === "object" ? value : {};

  return {
    nombre_completo: String(data.nombre_completo || "").trim(),
    telefono: String(data.telefono || "").trim(),
    email: String(data.email || "").trim().toLowerCase(),
    calle: String(data.calle || "").trim(),
    numero_exterior: String(data.numero_exterior || "").trim(),
    numero_interior: String(data.numero_interior || "").trim(),
    colonia: String(data.colonia || "").trim(),
    codigo_postal: cleanPostalCode(data.codigo_postal),
    municipio: String(data.municipio || "").trim(),
    estado: String(data.estado || "").trim(),
    pais: String(data.pais || "").trim(),
    horario_recepcion: String(data.horario_recepcion || "").trim(),
    referencias: String(data.referencias || "").trim(),
    tiempo_estimado: "1 a 3 días hábiles"
  };
}

function buildShippingRuleCandidates(address) {
  const data = address && typeof address === "object" ? address : {};

  const sourceValues = {
    codigo_postal: cleanPostalCode(data.codigo_postal),
    colonia: String(data.colonia || "").trim(),
    municipio: String(data.municipio || "").trim(),
    estado: String(data.estado || "").trim(),
    pais: String(data.pais || "").trim()
  };

  return SHIPPING_RULE_PRIORITY
    .map((type) => ({
      tipo: type,
      valor: sourceValues[type],
      valor_normalizado: normalizeShippingRuleValue(type, sourceValues[type])
    }))
    .filter((candidate) => candidate.valor_normalizado);
}

async function resolveShippingRule(address) {
  const candidates = buildShippingRuleCandidates(address);
  const matchesByType = new Map();

  for (const candidate of candidates) {
    const result = await pool.query(
      `
      SELECT
        r.id,
        r.zona_id,
        r.tipo,
        r.valor,
        r.activo,
        r.creado_en,
        z.numero AS zona_numero,
        z.nombre AS zona,
        z.costo
      FROM reglas_envio r
      INNER JOIN zonas_envio z ON z.id = r.zona_id
      WHERE
        r.tipo = $1
        AND r.valor_normalizado = $2
        AND r.activo IS NOT FALSE
        AND z.activo IS NOT FALSE
      ORDER BY z.numero ASC, r.id ASC
      `,
      [candidate.tipo, candidate.valor_normalizado]
    );

    if (result.rows.length) {
      matchesByType.set(
        candidate.tipo,
        result.rows.map((row) => normalizeShippingRule(row))
      );
    }
  }

  const postalRules = matchesByType.get("codigo_postal") || [];
  const municipalityRules = matchesByType.get("municipio") || [];
  const neighborhoodRules = matchesByType.get("colonia") || [];

  /*
    La colonia es el dato definitivo para elegir la zona.
    C.P. y alcaldía/municipio sirven como filtros previos y ambos
    pueden estar registrados en varias zonas.
  */
  if (!neighborhoodRules.length) {
    return {
      resolucion_invalida: true,
      codigo: "COLONIA_NO_REGISTRADA",
      message:
        "La colonia todavía no está registrada en una zona de envío. Agrégala desde Zonas de envío."
    };
  }

  if (neighborhoodRules.length > 1) {
    return {
      resolucion_invalida: true,
      codigo: "COLONIA_DUPLICADA",
      message:
        "La colonia está registrada en más de una zona. Cada colonia debe pertenecer solamente a una zona."
    };
  }

  let candidateZoneIds = null;
  const usedMatches = [];

  if (postalRules.length) {
    candidateZoneIds = new Set(
      postalRules.map((rule) => Number(rule.zona_id))
    );
  }

  if (municipalityRules.length) {
    const municipalityZoneIds = new Set(
      municipalityRules.map((rule) => Number(rule.zona_id))
    );

    if (candidateZoneIds) {
      const intersection = new Set(
        [...candidateZoneIds].filter((zoneId) =>
          municipalityZoneIds.has(zoneId)
        )
      );

      if (!intersection.size) {
        return {
          resolucion_invalida: true,
          codigo: "CP_MUNICIPIO_NO_COINCIDEN",
          message:
            "El código postal y la alcaldía o municipio no coinciden en ninguna zona configurada."
        };
      }

      candidateZoneIds = intersection;
    } else {
      candidateZoneIds = municipalityZoneIds;
    }
  }

  const neighborhoodRule = neighborhoodRules[0];
  const selectedZoneId = Number(neighborhoodRule.zona_id);

  if (candidateZoneIds && !candidateZoneIds.has(selectedZoneId)) {
    return {
      resolucion_invalida: true,
      codigo: "COLONIA_NO_COINCIDE",
      message:
        "La colonia no corresponde a las zonas permitidas por el código postal y la alcaldía o municipio."
    };
  }

  const postalMatch = postalRules.find(
    (rule) => Number(rule.zona_id) === selectedZoneId
  );

  if (postalMatch) {
    usedMatches.push({
      regla_id: Number(postalMatch.id),
      tipo: postalMatch.tipo,
      tipo_etiqueta: postalMatch.tipo_etiqueta,
      valor: postalMatch.valor
    });
  }

  const municipalityMatch = municipalityRules.find(
    (rule) => Number(rule.zona_id) === selectedZoneId
  );

  if (municipalityMatch) {
    usedMatches.push({
      regla_id: Number(municipalityMatch.id),
      tipo: municipalityMatch.tipo,
      tipo_etiqueta: municipalityMatch.tipo_etiqueta,
      valor: municipalityMatch.valor
    });
  }

  usedMatches.push({
    regla_id: Number(neighborhoodRule.id),
    tipo: neighborhoodRule.tipo,
    tipo_etiqueta: neighborhoodRule.tipo_etiqueta,
    valor: neighborhoodRule.valor
  });

  return {
    ...neighborhoodRule,
    ambigua: false,
    coincidencias: usedMatches,
    criterio_final: "colonia"
  };
}

app.post("/api/zonas-envio/calcular", async (req, res) => {
  try {
    const matchedRule = await resolveShippingRule(req.body || {});

    if (!matchedRule) {
      return res.json({
        encontrada: false,
        ambigua: false,
        message: "No hay una tarifa configurada para estos datos de envío."
      });
    }

    if (matchedRule.resolucion_invalida) {
      return res.json({
        encontrada: false,
        ambigua: false,
        codigo: matchedRule.codigo || "DIRECCION_NO_RESUELTA",
        message: matchedRule.message
      });
    }

    res.json({
      encontrada: true,
      ambigua: false,
      regla_id: matchedRule.id,
      regla_tipo: matchedRule.tipo,
      regla_tipo_etiqueta: matchedRule.tipo_etiqueta,
      regla_valor: matchedRule.valor,
      coincidencias: matchedRule.coincidencias || [],
      criterio_final: matchedRule.criterio_final || "colonia",
      zona_id: matchedRule.zona_id,
      zona_numero: matchedRule.zona_numero,
      zona: matchedRule.zona,
      costo: matchedRule.costo,
      message: `${matchedRule.zona}: $${matchedRule.costo.toFixed(2)}`
    });
  } catch (error) {
    console.error("Error en POST /api/zonas-envio/calcular:", error);
    res.status(500).json({ message: "Error al calcular el costo de envío." });
  }
});

app.get("/api/admin/zonas-envio", requireAdminSession, async (req, res) => {
  try {
    const zonesResult = await pool.query(
      `
      SELECT id, numero, nombre, costo, activo
      FROM zonas_envio
      ORDER BY numero ASC
      `
    );

    const rulesResult = await pool.query(
      `
      SELECT
        r.id,
        r.zona_id,
        r.tipo,
        r.valor,
        r.activo,
        r.creado_en,
        z.numero AS zona_numero,
        z.nombre AS zona,
        z.costo
      FROM reglas_envio r
      INNER JOIN zonas_envio z ON z.id = r.zona_id
      ORDER BY
        z.numero ASC,
        CASE r.tipo
          WHEN 'codigo_postal' THEN 1
          WHEN 'colonia' THEN 2
          WHEN 'municipio' THEN 3
          WHEN 'estado' THEN 4
          WHEN 'pais' THEN 5
          ELSE 6
        END,
        r.valor ASC
      `
    );

    res.json({
      version_reglas_envio: 5,
      zonas: zonesResult.rows.map((zone) => ({
        id: Number(zone.id),
        numero: Number(zone.numero),
        nombre: zone.nombre,
        costo: Number(zone.costo || 0),
        activo: zone.activo !== false
      })),
      reglas: rulesResult.rows.map(normalizeShippingRule)
    });
  } catch (error) {
    console.error("Error en GET /api/admin/zonas-envio:", error);
    res.status(500).json({ message: "Error al obtener las reglas de envío." });
  }
});


app.post("/api/admin/zonas-envio/reglas/lote", requireAdminSession, async (req, res) => {
  const client = await pool.connect();

  try {
    const requestedZoneNumbers = Array.isArray(req.body.zona_numeros)
      ? req.body.zona_numeros
      : [req.body.zona_numero];

    const zoneNumbers = Array.from(
      new Set(
        requestedZoneNumbers
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );

    const tipo = normalizeShippingRuleType(req.body.tipo);
    const valoresEntrada = Array.isArray(req.body.valores)
      ? req.body.valores
      : [];

    if (!zoneNumbers.length || !tipo || !valoresEntrada.length) {
      return res.status(400).json({
        message:
          "Selecciona una zona, el tipo de dato y escribe al menos un valor."
      });
    }

    if (tipo === "colonia" && zoneNumbers.length !== 1) {
      return res.status(400).json({
        message:
          "Cada colonia debe pertenecer a una sola zona. Selecciona únicamente una zona para guardar colonias."
      });
    }

    const zonesResult = await client.query(
      `
      SELECT id, numero, nombre, costo
      FROM zonas_envio
      WHERE numero = ANY($1::int[])
        AND activo IS NOT FALSE
      ORDER BY numero ASC
      `,
      [zoneNumbers]
    );

    if (zonesResult.rows.length !== zoneNumbers.length) {
      return res.status(400).json({
        message: "Una o más zonas seleccionadas no existen."
      });
    }

    const validValues = [];
    const seen = new Set();

    for (const rawValue of valoresEntrada) {
      const valor = String(rawValue || "").trim();
      const valorNormalizado = normalizeShippingRuleValue(tipo, valor);

      if (!valor || !valorNormalizado) {
        return res.status(400).json({
          message:
            tipo === "codigo_postal"
              ? `El código postal "${valor || "(vacío)"}" debe tener exactamente 5 dígitos.`
              : `El valor "${valor || "(vacío)"}" no es válido.`
        });
      }

      const key = `${tipo}|||${valorNormalizado}`;

      if (!seen.has(key)) {
        seen.add(key);
        validValues.push({ valor, valorNormalizado });
      }
    }

    await client.query("BEGIN");

    const saved = [];

    if (tipo === "colonia") {
      const zone = zonesResult.rows[0];

      for (const item of validValues) {
        const existingResult = await client.query(
          `
          SELECT id
          FROM reglas_envio
          WHERE tipo = 'colonia'
            AND valor_normalizado = $1
          LIMIT 1
          `,
          [item.valorNormalizado]
        );

        let result;

        if (existingResult.rows.length) {
          result = await client.query(
            `
            UPDATE reglas_envio
            SET
              zona_id = $1,
              valor = $2,
              activo = TRUE
            WHERE id = $3
            RETURNING id
            `,
            [
              Number(zone.id),
              item.valor,
              Number(existingResult.rows[0].id)
            ]
          );
        } else {
          result = await client.query(
            `
            INSERT INTO reglas_envio (
              zona_id,
              tipo,
              valor,
              valor_normalizado,
              activo
            )
            VALUES ($1, 'colonia', $2, $3, TRUE)
            RETURNING id
            `,
            [
              Number(zone.id),
              item.valor,
              item.valorNormalizado
            ]
          );
        }

        saved.push({
          id: Number(result.rows[0].id),
          valor: item.valor,
          zona_numero: Number(zone.numero),
          zona: zone.nombre,
          costo: Number(zone.costo || 0)
        });
      }
    } else {
      for (const zone of zonesResult.rows) {
        for (const item of validValues) {
          const result = await client.query(
            `
            INSERT INTO reglas_envio (
              zona_id,
              tipo,
              valor,
              valor_normalizado,
              activo
            )
            VALUES ($1, $2, $3, $4, TRUE)
            ON CONFLICT (zona_id, tipo, valor_normalizado)
            DO UPDATE SET
              valor = EXCLUDED.valor,
              activo = TRUE
            RETURNING id
            `,
            [
              Number(zone.id),
              tipo,
              item.valor,
              item.valorNormalizado
            ]
          );

          saved.push({
            id: Number(result.rows[0].id),
            valor: item.valor,
            zona_numero: Number(zone.numero),
            zona: zone.nombre,
            costo: Number(zone.costo || 0)
          });
        }
      }
    }

    await client.query("COMMIT");

    const totalValues = validValues.length;
    const totalZones = zonesResult.rows.length;

    res.status(201).json({
      message:
        tipo === "colonia"
          ? `${totalValues} ${
              totalValues === 1 ? "colonia guardada" : "colonias guardadas"
            } en ${zonesResult.rows[0].nombre}.`
          : `${totalValues} ${
              totalValues === 1 ? "dato guardado" : "datos guardados"
            } en ${totalZones} ${
              totalZones === 1 ? "zona" : "zonas"
            } (${saved.length} registros en total).`,
      total_valores: totalValues,
      total_zonas: totalZones,
      total_guardados: saved.length,
      guardados: saved
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Error en POST /api/admin/zonas-envio/reglas/lote:",
      error
    );

    res.status(500).json({
      message: error.message || "Error al guardar los datos de envío."
    });
  } finally {
    client.release();
  }
});

app.post("/api/admin/zonas-envio/reglas", requireAdminSession, async (req, res) => {
  try {
    const zonaNumero = Number(req.body.zona_numero);
    const tipo = normalizeShippingRuleType(req.body.tipo);
    const valor = String(req.body.valor || "").trim();
    const valorNormalizado = normalizeShippingRuleValue(tipo, valor);

    if (!zonaNumero || !tipo || !valor || !valorNormalizado) {
      return res.status(400).json({
        message:
          tipo === "codigo_postal"
            ? "Selecciona una zona y escribe un código postal de 5 dígitos."
            : "Selecciona una zona, el tipo de dato y escribe su valor."
      });
    }

    const zoneResult = await pool.query(
      `
      SELECT id
      FROM zonas_envio
      WHERE numero = $1 AND activo IS NOT FALSE
      LIMIT 1
      `,
      [zonaNumero]
    );

    if (!zoneResult.rows.length) {
      return res.status(400).json({
        message: "La zona seleccionada no existe."
      });
    }

    const zoneId = Number(zoneResult.rows[0].id);

    if (tipo === "colonia") {
      const result = await pool.query(
        `
        INSERT INTO reglas_envio (
          zona_id,
          tipo,
          valor,
          valor_normalizado,
          activo
        )
        VALUES ($1, 'colonia', $2, $3, TRUE)
        ON CONFLICT (valor_normalizado)
        WHERE tipo = 'colonia'
        DO UPDATE SET
          zona_id = EXCLUDED.zona_id,
          valor = EXCLUDED.valor,
          activo = TRUE
        RETURNING id
        `,
        [zoneId, valor, valorNormalizado]
      );

      return res.status(201).json({
        message: "Colonia guardada en una sola zona.",
        id: Number(result.rows[0].id)
      });
    }

    const result = await pool.query(
      `
      INSERT INTO reglas_envio (
        zona_id,
        tipo,
        valor,
        valor_normalizado,
        activo
      )
      VALUES ($1, $2, $3, $4, TRUE)
      ON CONFLICT (zona_id, tipo, valor_normalizado)
      DO UPDATE SET
        valor = EXCLUDED.valor,
        activo = TRUE
      RETURNING id
      `,
      [zoneId, tipo, valor, valorNormalizado]
    );

    res.status(201).json({
      message: "Dato de envío agregado correctamente.",
      id: Number(result.rows[0].id)
    });
  } catch (error) {
    console.error("Error en POST /api/admin/zonas-envio/reglas:", error);
    res.status(500).json({
      message: error.message || "Error al agregar el dato de envío."
    });
  }
});

app.put("/api/admin/zonas-envio/reglas/:id", requireAdminSession, async (req, res) => {
  try {
    const ruleId = Number(req.params.id);
    const zonaNumero = Number(req.body.zona_numero);
    const tipo = normalizeShippingRuleType(req.body.tipo);
    const valor = String(req.body.valor || "").trim();
    const valorNormalizado = normalizeShippingRuleValue(tipo, valor);
    const activo = req.body.activo !== false;

    if (!ruleId || !zonaNumero || !tipo || !valor || !valorNormalizado) {
      return res.status(400).json({
        message: "Completa correctamente la zona, el tipo de dato y el valor."
      });
    }

    const zoneResult = await pool.query(
      `
      SELECT id
      FROM zonas_envio
      WHERE numero = $1 AND activo IS NOT FALSE
      LIMIT 1
      `,
      [zonaNumero]
    );

    if (!zoneResult.rows.length) {
      return res.status(400).json({ message: "La zona seleccionada no existe." });
    }

    if (tipo === "colonia") {
      const duplicateColony = await pool.query(
        `
        SELECT id
        FROM reglas_envio
        WHERE tipo = 'colonia'
          AND valor_normalizado = $1
          AND id <> $2
        LIMIT 1
        `,
        [valorNormalizado, ruleId]
      );

      if (duplicateColony.rows.length) {
        return res.status(400).json({
          message:
            "Esa colonia ya existe. Edita el registro de esa colonia en lugar de crear otro."
        });
      }
    }

    const result = await pool.query(
      `
      UPDATE reglas_envio
      SET
        zona_id = $1,
        tipo = $2,
        valor = $3,
        valor_normalizado = $4,
        activo = $5
      WHERE id = $6
      RETURNING id
      `,
      [
        Number(zoneResult.rows[0].id),
        tipo,
        valor,
        valorNormalizado,
        activo,
        ruleId
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Regla no encontrada." });
    }

    res.json({ message: "Regla de envío actualizada correctamente." });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        message: "Ese dato ya está registrado dentro de esa misma zona."
      });
    }

    console.error("Error en PUT /api/admin/zonas-envio/reglas/:id:", error);
    res.status(500).json({ message: "Error al actualizar la regla de envío." });
  }
});

app.delete("/api/admin/zonas-envio/reglas/:id", requireAdminSession, async (req, res) => {
  try {
    const ruleId = Number(req.params.id);

    if (!ruleId) {
      return res.status(400).json({ message: "Regla inválida." });
    }

    const result = await pool.query(
      "DELETE FROM reglas_envio WHERE id = $1 RETURNING id",
      [ruleId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Regla no encontrada." });
    }

    res.json({ message: "Regla de envío eliminada correctamente." });
  } catch (error) {
    console.error("Error en DELETE /api/admin/zonas-envio/reglas/:id:", error);
    res.status(500).json({ message: "Error al eliminar la regla de envío." });
  }
});

/* =========================
   CREAR PEDIDO
========================= */

app.post("/api/pedidos", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      usuario_id,
      nombre_cliente,
      email_cliente,
      telefono_cliente,
      direccion_envio,
      tipo_entrega,
      metodo_pago,
      requiere_factura,
      datos_factura,
      descuento,
      subtotal,
      envio,
      total,
      productos,
      estado_pago,
      mp_preference_id,
      mp_payment_id,
      mp_status,
      cobertura_envio_id,
      datos_envio,
      tiempo_entrega
    } = req.body;

    if (
      !nombre_cliente ||
      !email_cliente ||
      !tipo_entrega ||
      !metodo_pago ||
      subtotal == null ||
      envio == null ||
      total == null ||
      !Array.isArray(productos) ||
      productos.length === 0
    ) {
      return res.status(400).json({ message: "Faltan datos del pedido." });
    }

    const requiereFacturaFinal = Boolean(requiere_factura);
    const datosFacturaFinal = requiereFacturaFinal ? datos_factura || {} : null;
    const descuentoFinal = Math.max(0, Number(descuento || 0));
    const subtotalFinal = Math.max(0, Number(subtotal || 0));
    const isDelivery = tipo_entrega === "delivery";

    let shippingCostFinal = 0;
    let shippingZoneIdFinal = null;
    let shippingZoneNameFinal = "";
    let shippingDataFinal = null;
    let deliveryTimeFinal = "";
    let customerNameFinal = String(nombre_cliente || "").trim();
    let customerEmailFinal = String(email_cliente || "").trim().toLowerCase();
    let customerPhoneFinal = String(telefono_cliente || "").trim();
    let shippingAddressFinal = String(direccion_envio || "").trim();

    if (isDelivery) {
      shippingDataFinal = cleanShippingData(datos_envio);

      if (
        !shippingDataFinal.nombre_completo ||
        !shippingDataFinal.telefono ||
        !shippingDataFinal.email ||
        !shippingDataFinal.calle ||
        !shippingDataFinal.numero_exterior ||
        !shippingDataFinal.colonia ||
        !/^\d{5}$/.test(shippingDataFinal.codigo_postal) ||
        !shippingDataFinal.municipio ||
        !shippingDataFinal.estado ||
        !shippingDataFinal.pais ||
        !isValidReceiveTime(shippingDataFinal.horario_recepcion)
      ) {
        return res.status(400).json({
          message: "Completa correctamente todos los datos del envío a domicilio."
        });
      }

      const matchedRule = await resolveShippingRule(shippingDataFinal);

      if (!matchedRule) {
        return res.status(400).json({
          message:
            "No hay una tarifa configurada para esta dirección. Contacta a la papelería."
        });
      }

      if (matchedRule.resolucion_invalida) {
        return res.status(400).json({
          message: matchedRule.message
        });
      }

      shippingCostFinal = Number(matchedRule.costo || 0);
      shippingZoneIdFinal = Number(matchedRule.zona_id);
      shippingZoneNameFinal = matchedRule.zona || `Zona ${matchedRule.zona_numero}`;
      deliveryTimeFinal = "1 a 3 días hábiles";

      shippingDataFinal = {
        ...shippingDataFinal,
        regla_envio_id: matchedRule.id,
        regla_tipo: matchedRule.tipo,
        regla_tipo_etiqueta: matchedRule.tipo_etiqueta,
        regla_valor: matchedRule.valor,
        coincidencias_reglas: matchedRule.coincidencias || [],
        zona_id: shippingZoneIdFinal,
        zona: shippingZoneNameFinal,
        costo_envio: shippingCostFinal,
        tiempo_estimado: deliveryTimeFinal
      };

      customerNameFinal = shippingDataFinal.nombre_completo;
      customerEmailFinal = shippingDataFinal.email;
      customerPhoneFinal = shippingDataFinal.telefono;

      shippingAddressFinal = [
        `Nombre: ${shippingDataFinal.nombre_completo}`,
        `Contacto: ${shippingDataFinal.telefono}`,
        `Correo: ${shippingDataFinal.email}`,
        `${shippingDataFinal.calle} ${shippingDataFinal.numero_exterior}${shippingDataFinal.numero_interior ? " Int. " + shippingDataFinal.numero_interior : ""}`,
        `Col. ${shippingDataFinal.colonia}`,
        `C.P. ${shippingDataFinal.codigo_postal}`,
        `${shippingDataFinal.municipio}, ${shippingDataFinal.estado}, ${shippingDataFinal.pais}`,
        `${shippingZoneNameFinal} · Envío $${shippingCostFinal.toFixed(2)}`,
        `Tarifa determinada por: ${
          (matchedRule.coincidencias || [])
            .map((match) => `${match.tipo_etiqueta}: ${match.valor}`)
            .join(" + ") || `${matchedRule.tipo_etiqueta}: ${matchedRule.valor}`
        }`,
        `Horario para recibir: ${shippingDataFinal.horario_recepcion}`,
        `Tiempo estimado: ${deliveryTimeFinal}`,
        shippingDataFinal.referencias ? `Referencias: ${shippingDataFinal.referencias}` : ""
      ].filter(Boolean).join("\n");
    }

    const totalFinal = Number(
      Math.max(0, subtotalFinal + shippingCostFinal - descuentoFinal).toFixed(2)
    );

    if (requiereFacturaFinal) {
      const {
        constancia_fiscal_url,
        uso_cfdi,
        modo_pago_factura,
        nota_compra_url,
        voucher_url,
        correo_factura
      } = datosFacturaFinal;

      if (
        !constancia_fiscal_url ||
        !uso_cfdi ||
        !modo_pago_factura ||
        !nota_compra_url ||
        !correo_factura
      ) {
        return res.status(400).json({
          message: "Faltan datos de facturación."
        });
      }

      if (metodo_pago === "tarjeta" && !voucher_url) {
        return res.status(400).json({
          message: "Falta subir el voucher de pago con tarjeta."
        });
      }
    }

    await client.query("BEGIN");

    for (const item of productos) {
      const productResult = await client.query(
        `
        SELECT *
        FROM productos
        WHERE id = $1
        LIMIT 1
        `,
        [Number(item.producto_id)]
      );

      const product = productResult.rows[0];

      if (!product) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Producto ${item.producto_id} no encontrado.`
        });
      }

      if (product.disponible === false) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `${product.nombre} no está disponible.`
        });
      }

      if (product.requiere_precio === true) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `${product.nombre} aún no tiene precio configurado.`
        });
      }

      if (!item.talla) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Debes seleccionar opción para ${product.nombre}.`
        });
      }

      const tallaResult = await client.query(
        `
        SELECT *
        FROM producto_tallas
        WHERE producto_id = $1 AND talla = $2
        LIMIT 1
        `,
        [Number(item.producto_id), String(item.talla)]
      );

      const tallaData = tallaResult.rows[0];

      if (!tallaData) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `La opción ${item.talla} no existe para ${product.nombre}.`
        });
      }

      const selectedPrice = effectiveSizePrice(tallaData, product);

      if (selectedPrice <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `${product.nombre} aún no tiene precio configurado.`
        });
      }

      if (Number(tallaData.stock) < Number(item.cantidad)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Stock insuficiente para ${product.nombre}.`
        });
      }
    }

    const estadoPagoFinal =
      estado_pago ||
      (metodo_pago === "tarjeta" ? "pagado" : "pendiente");

    const orderResult = await client.query(
      `
      INSERT INTO pedidos (
        usuario_id,
        nombre_cliente,
        email_cliente,
        telefono_cliente,
        direccion_envio,
        tipo_entrega,
        metodo_pago,
        requiere_factura,
        datos_factura,
        descuento,
        subtotal,
        envio,
        total,
        estado,
        estado_pago,
        mp_preference_id,
        mp_payment_id,
        mp_status,
        zona_envio_id,
        zona_envio,
        datos_envio,
        tiempo_entrega
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, 'pendiente',
        $14, $15, $16, $17, $18, $19, $20, $21
      )
      RETURNING id
      `,
      [
        usuario_id || null,
        customerNameFinal,
        customerEmailFinal,
        customerPhoneFinal,
        isDelivery ? shippingAddressFinal : "Recoger en papelería",
        tipo_entrega,
        metodo_pago,
        requiereFacturaFinal,
        datosFacturaFinal,
        descuentoFinal,
        subtotalFinal,
        shippingCostFinal,
        totalFinal,
        estadoPagoFinal,
        mp_preference_id || "",
        mp_payment_id || "",
        mp_status || "",
        shippingZoneIdFinal,
        shippingZoneNameFinal,
        shippingDataFinal ? JSON.stringify(shippingDataFinal) : null,
        deliveryTimeFinal || String(tiempo_entrega || "")
      ]
    );

    const pedidoId = orderResult.rows[0].id;

    for (const item of productos) {
      const tallaResult = await client.query(
        `
        SELECT *
        FROM producto_tallas
        WHERE producto_id = $1 AND talla = $2
        LIMIT 1
        `,
        [Number(item.producto_id), String(item.talla)]
      );

      const productResult = await client.query(
        `
        SELECT *
        FROM productos
        WHERE id = $1
        LIMIT 1
        `,
        [Number(item.producto_id)]
      );

      const tallaData = tallaResult.rows[0];
      const product = productResult.rows[0];
      const selectedPrice = effectiveSizePrice(tallaData, product);

      await client.query(
        `
        INSERT INTO pedido_productos (
          pedido_id,
          producto_id,
          talla,
          cantidad,
          precio
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          pedidoId,
          Number(item.producto_id),
          String(item.talla),
          Number(item.cantidad),
          selectedPrice
        ]
      );

      await client.query(
        `
        UPDATE producto_tallas
        SET stock = stock - $1
        WHERE producto_id = $2 AND talla = $3
        `,
        [
          Number(item.cantidad),
          Number(item.producto_id),
          String(item.talla)
        ]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Pedido creado correctamente",
      pedidoId
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error en /api/pedidos:", error);
    res.status(500).json({ message: "Error al crear pedido" });
  } finally {
    client.release();
  }
});

/* =========================
   VER PEDIDOS
========================= */

app.get("/api/pedidos", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        p.*,
        COALESCE(
          json_agg(
            json_build_object(
              'producto_id', pp.producto_id,
              'nombre', pr.nombre,
              'categoria', pr.categoria,
              'talla', pp.talla,
              'cantidad', pp.cantidad,
              'precio', pp.precio
            )
            ORDER BY pp.id
          ) FILTER (WHERE pp.id IS NOT NULL),
          '[]'
        ) AS productos
      FROM pedidos p
      LEFT JOIN pedido_productos pp ON pp.pedido_id = p.id
      LEFT JOIN productos pr ON pr.id = pp.producto_id
      GROUP BY p.id
      ORDER BY p.id DESC
      `
    );

    const pedidos = result.rows.map((order) => ({
      id: Number(order.id),
      usuario_id: order.usuario_id,
      nombre_cliente: order.nombre_cliente,
      email_cliente: order.email_cliente,
      telefono_cliente: order.telefono_cliente || "",
      direccion_envio: order.direccion_envio || "",
      tipo_entrega: order.tipo_entrega,
      metodo_pago: order.metodo_pago,
      requiere_factura: order.requiere_factura === true,
      datos_factura: order.datos_factura || null,
      descuento: Number(order.descuento || 0),
      subtotal: Number(order.subtotal || 0),
      envio: Number(order.envio || 0),
      total: Number(order.total || 0),
      estado: order.estado || "pendiente",
      estado_pago: order.estado_pago || "pendiente",
      mp_preference_id: order.mp_preference_id || "",
      mp_payment_id: order.mp_payment_id || "",
      mp_status: order.mp_status || "",
      zona_envio_id: order.zona_envio_id ? Number(order.zona_envio_id) : null,
      zona_envio: order.zona_envio || "",
      datos_envio: order.datos_envio || null,
      tiempo_entrega: order.tiempo_entrega || "",
      creado_en: order.creado_en,
      productos: Array.isArray(order.productos) ? order.productos : []
    }));

    res.json(pedidos);
  } catch (error) {
    console.error("Error en GET /api/pedidos:", error);
    res.status(500).json({ message: "Error al obtener pedidos" });
  }
});

/* =========================
   ACTUALIZAR ESTADO PEDIDO
========================= */

app.patch("/api/pedidos/:id/estado", async (req, res) => {
  try {
    const pedidoId = Number(req.params.id);
    const { estado } = req.body;

    const estadosPermitidos = ["pendiente", "listo", "entregado", "cancelado"];

    if (!pedidoId || !estado || !estadosPermitidos.includes(estado)) {
      return res.status(400).json({
        message: "Estado inválido."
      });
    }

    const result = await pool.query(
      `
      UPDATE pedidos
      SET estado = $1
      WHERE id = $2
      RETURNING id, estado
      `,
      [estado, pedidoId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        message: "Pedido no encontrado."
      });
    }

    res.json({
      message: "Estado actualizado correctamente",
      pedido: result.rows[0]
    });
  } catch (error) {
    console.error("Error en PATCH /api/pedidos/:id/estado:", error);
    res.status(500).json({
      message: "Error al actualizar estado del pedido."
    });
  }
});

/* =========================
   ELIMINAR PEDIDO
========================= */

app.delete("/api/pedidos/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const pedidoId = Number(req.params.id);
    const restaurarStock = req.query.restaurar_stock === "si";

    if (!pedidoId) {
      return res.status(400).json({
        message: "Pedido inválido."
      });
    }

    await client.query("BEGIN");

    const orderResult = await client.query(
      "SELECT id FROM pedidos WHERE id = $1 LIMIT 1",
      [pedidoId]
    );

    if (!orderResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Pedido no encontrado."
      });
    }

    if (restaurarStock) {
      const itemsResult = await client.query(
        `
        SELECT producto_id, talla, cantidad
        FROM pedido_productos
        WHERE pedido_id = $1
        `,
        [pedidoId]
      );

      for (const item of itemsResult.rows) {
        await client.query(
          `
          UPDATE producto_tallas
          SET stock = stock + $1
          WHERE producto_id = $2 AND talla = $3
          `,
          [
            Number(item.cantidad || 0),
            Number(item.producto_id),
            String(item.talla || "")
          ]
        );
      }
    }

    await client.query(
      "DELETE FROM pedidos WHERE id = $1",
      [pedidoId]
    );

    await client.query("COMMIT");

    res.json({
      message: restaurarStock
        ? "Pedido eliminado y stock restaurado correctamente."
        : "Pedido eliminado correctamente."
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error en DELETE /api/pedidos/:id:", error);

    res.status(500).json({
      message: "Error al eliminar pedido."
    });
  } finally {
    client.release();
  }
});


/* =========================
   LISTAS DE ÚTILES
========================= */

function normalizeSchoolList(row) {
  return {
    id: Number(row.id),
    nombre: row.nombre || "",
    descripcion: row.descripcion || "",
    tipo: row.tipo || "Escuela",
    escuela: row.escuela || "",
    nivel: row.nivel || "",
    grado: row.grado || "",
    archivo_url: row.archivo_url || "",
    archivo_tipo: row.archivo_tipo || "",
    archivo_nombre: row.archivo_nombre || "",
    activo: row.activo !== false,
    creado_en: row.creado_en
  };
}

app.get("/api/listas-utiles", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM listas_utiles
      WHERE activo IS NOT FALSE
      ORDER BY
        CASE
          WHEN tipo = 'Papelería' THEN 1
          ELSE 2
        END,
        id DESC
      `
    );

    res.json(result.rows.map(normalizeSchoolList));
  } catch (error) {
    console.error("Error en GET /api/listas-utiles:", error);
    res.status(500).json({ message: "Error al obtener listas de útiles." });
  }
});

app.get("/api/admin/listas-utiles", requireAdminSession, async (req, res) => {
  try {

    const result = await pool.query(
      `
      SELECT *
      FROM listas_utiles
      ORDER BY id DESC
      `
    );

    res.json(result.rows.map(normalizeSchoolList));
  } catch (error) {
    console.error("Error en GET /api/admin/listas-utiles:", error);
    res.status(500).json({ message: "Error al obtener listas de útiles." });
  }
});

app.post("/api/admin/listas-utiles", requireAdminSession, function (req, res) {
  uploadSchoolListPdf.single("archivo")(req, res, async function (error) {
    try {
      if (error) {
        return res.status(400).json({
          message: error.message || "No se pudo procesar el archivo."
        });
      }

      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({
          message: "Faltan las variables de Cloudinary en Render."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "Selecciona un archivo PDF."
        });
      }

      const nombre = String(req.body.nombre || "").trim();
      const descripcion = String(req.body.descripcion || "").trim();
      const tipo = String(req.body.tipo || "Escuela").trim();
      const escuela = String(req.body.escuela || "").trim();
      const nivel = String(req.body.nivel || "").trim();
      const grado = String(req.body.grado || "").trim();

      if (!nombre) {
        return res.status(400).json({
          message: "Escribe el nombre de la lista."
        });
      }

      const result = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "papeleria-sulamita/listas-utiles",
        resource_type: "image"
      });

      const insertResult = await pool.query(
        `
        INSERT INTO listas_utiles (
          nombre,
          descripcion,
          tipo,
          escuela,
          nivel,
          grado,
          archivo_url,
          archivo_tipo,
          archivo_nombre,
          activo
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        RETURNING *
        `,
        [
          nombre,
          descripcion,
          tipo || "Escuela",
          escuela,
          nivel,
          grado,
          result.secure_url,
          req.file.mimetype || "",
          req.file.originalname || ""
        ]
      );

      res.status(201).json({
        message: "Lista subida correctamente.",
        lista: normalizeSchoolList(insertResult.rows[0])
      });
    } catch (uploadError) {
      console.error("Error en POST /api/admin/listas-utiles:", uploadError);

      res.status(500).json({
        message: uploadError.message || "Error al subir la lista."
      });
    }
  });
});

app.delete("/api/admin/listas-utiles/:id", requireAdminSession, async (req, res) => {
  try {

    const listId = Number(req.params.id);

    if (!listId) {
      return res.status(400).json({ message: "Lista inválida." });
    }

    const result = await pool.query(
      "DELETE FROM listas_utiles WHERE id = $1 RETURNING id",
      [listId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Lista no encontrada." });
    }

    res.json({ message: "Lista eliminada correctamente." });
  } catch (error) {
    console.error("Error en DELETE /api/admin/listas-utiles/:id:", error);
    res.status(500).json({ message: "Error al eliminar lista." });
  }
});


/* =========================
   CONTACTO
========================= */

app.post("/api/contacto", async (req, res) => {
  try {
    const { nombre, email, telefono, asunto, mensaje } = req.body;

    if (!nombre || !email || !asunto || !mensaje) {
      return res.status(400).json({ message: "Faltan campos obligatorios." });
    }

    await pool.query(
      `
      INSERT INTO contactos (nombre, email, telefono, asunto, mensaje)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [nombre, email, telefono || "", asunto, mensaje]
    );

    res.status(201).json({ message: "Mensaje enviado correctamente" });
  } catch (error) {
    console.error("Error en /api/contacto:", error);
    res.status(500).json({ message: "Error al enviar mensaje" });
  }
});

/* =========================
   PÁGINAS
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

app.get("/usuarios-admin", (req, res) => {
  res.sendFile(path.join(publicDir, "usuarios-admin.html"));
});

app.get("/listas-admin", (req, res) => {
  res.sendFile(path.join(publicDir, "listas-admin.html"));
});

app.get("/listas-utiles", (req, res) => {
  res.sendFile(path.join(publicDir, "listas-utiles.html"));
});

app.get("/zonas-envio-admin", (req, res) => {
  res.sendFile(path.join(publicDir, "zonas-envio-admin.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.get("/carrito", (req, res) => {
  res.sendFile(path.join(publicDir, "carrito.html"));
});

app.get("/contacto", (req, res) => {
  res.sendFile(path.join(publicDir, "contacto.html"));
});

app.get("/pedidos-admin", (req, res) => {
  res.sendFile(path.join(publicDir, "pedidos-admin.html"));
});

app.get("/pago-exitoso", (req, res) => {
  res.sendFile(path.join(publicDir, "pago-exitoso.html"));
});

app.get("/pago-cancelado", (req, res) => {
  res.sendFile(path.join(publicDir, "pago-cancelado.html"));
});

app.get("/pago-pendiente", (req, res) => {
  res.sendFile(path.join(publicDir, "pago-pendiente.html"));
});

/* =========================
   INICIAR SERVIDOR
========================= */

ensureDatabaseUpdates()
  .then(() => ensureShippingRulesSetup())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar el servidor:", error);
    process.exit(1);
  });