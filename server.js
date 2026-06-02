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
   CLOUDINARY / SUBIDA IMÁGENES
========================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
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

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "papeleria-sulamita/productos",
        resource_type: "image"
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
   HELPERS
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

/* =========================
   ACTUALIZACIONES DE BASE DE DATOS
========================= */

async function ensureDatabaseUpdates() {
  try {
    await pool.query(`
      ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS imagen_url TEXT DEFAULT '';
    `);

    console.log("Base de datos actualizada: columna imagen_url lista.");
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

    const result = await pool.query(
      `
      SELECT id, nombre, email, rol
      FROM usuarios
      WHERE email = $1 AND password = $2 AND rol = $3
      LIMIT 1
      `,
      [email, password, role]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
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

    if (!nombre || !email || !password) {
      return res.status(400).json({ message: "Faltan datos obligatorios." });
    }

    const exists = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1 LIMIT 1",
      [email]
    );

    if (exists.rows.length) {
      return res.status(400).json({ message: "El correo ya está registrado" });
    }

    const result = await pool.query(
      `
      INSERT INTO usuarios (nombre, email, password, rol)
      VALUES ($1, $2, $3, 'cliente')
      RETURNING id
      `,
      [nombre, email, password]
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
   ADMIN - SUBIR IMAGEN
========================= */

app.post("/api/admin/subir-imagen", function (req, res) {
  upload.single("imagen")(req, res, async function (error) {
    try {
      if (error) {
        return res.status(400).json({
          message: error.message || "No se pudo procesar la imagen."
        });
      }

      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({
          message: "Faltan las variables de Cloudinary en Render."
        });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No se recibió ninguna imagen." });
      }

      const result = await uploadBufferToCloudinary(req.file.buffer);

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

      if (grado_secundaria != null) {
        newGradoSecundaria = String(grado_secundaria || "");
      }

      if (grado_prepa != null) {
        newGradoPrepa = String(grado_prepa || "");
      }

      if (area_prepa != null) {
        newAreaPrepa = String(area_prepa || "");
      }
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
   PEDIDOS
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
      subtotal,
      envio,
      total,
      productos
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
        subtotal,
        envio,
        total,
        estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendiente')
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
        Number(subtotal),
        Number(envio),
        Number(total)
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
      subtotal: Number(order.subtotal || 0),
      envio: Number(order.envio || 0),
      total: Number(order.total || 0),
      estado: order.estado || "pendiente",
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

/* =========================
   INICIAR SERVIDOR
========================= */

ensureDatabaseUpdates().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
});