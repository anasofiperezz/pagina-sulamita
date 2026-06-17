const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const { Readable } = require("stream");
const { v2: cloudinary } = require("cloudinary");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const publicDir = __dirname;

app.use(cors());
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
      "application/pdf"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Solo se permiten archivos JPG, PNG, WEBP o PDF."));
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
    imagen_url: row.imagen_url || "",
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
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS imagen_url TEXT DEFAULT '';
    `);

    await pool.query(`
      ALTER TABLE pedidos
      ADD COLUMN IF NOT EXISTS requiere_factura BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS datos_factura JSONB,
      ADD COLUMN IF NOT EXISTS descuento NUMERIC(10, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'pendiente',
      ADD COLUMN IF NOT EXISTS mp_preference_id TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS mp_payment_id TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS mp_status TEXT DEFAULT '';
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

    console.log("Base de datos actualizada correctamente.");
  } catch (error) {
    console.error("Error actualizando base de datos:", error);
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
        precio,
        disponible,
        requiere_precio,
        aplica_general
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13, $14, $15
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
        imagen_url || "",
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
        precio = $12,
        disponible = $13,
        requiere_precio = $14,
        aplica_general = $15
      WHERE id = $16
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
        imagen_url != null ? imagen_url : current.imagen_url || "",
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
      mp_status
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
    const descuentoFinal = Number(descuento || 0);

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
        mp_status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, 'pendiente',
        $14, $15, $16, $17
      )
      RETURNING id
      `,
      [
        usuario_id || null,
        nombre_cliente,
        email_cliente,
        telefono_cliente || "",
        direccion_envio || "",
        tipo_entrega,
        metodo_pago,
        requiereFacturaFinal,
        datosFacturaFinal,
        descuentoFinal,
        Number(subtotal),
        Number(envio),
        Number(total),
        estadoPagoFinal,
        mp_preference_id || "",
        mp_payment_id || "",
        mp_status || ""
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

aapp.get("/usuarios-admin", (req, res) => {
  res.sendFile(path.join(publicDir, "usuarios-admin.html"));
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

ensureDatabaseUpdates().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
});