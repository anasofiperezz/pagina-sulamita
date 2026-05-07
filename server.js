const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, "data");

// Tus archivos HTML, CSS, JS e imágenes ahora están en la raíz del proyecto
const publicDir = __dirname;

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

async function readJson(filename) {
  const filePath = path.join(dataDir, filename);
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function writeJson(filename, data) {
  const filePath = path.join(dataDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function nextId(items) {
  if (!items.length) return 1;
  return Math.max(...items.map(item => Number(item.id) || 0)) + 1;
}

/* =========================
   STATUS
========================= */
app.get("/api", (req, res) => {
  res.json({ message: "Papelería Sulamita API working" });
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

    const usuarios = await readJson("usuarios.json");

    const user = usuarios.find(
      (u) => u.email === email && u.password === password && u.rol === role
    );

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

    const usuarios = await readJson("usuarios.json");
    const exists = usuarios.some((u) => u.email === email);

    if (exists) {
      return res.status(400).json({ message: "El correo ya está registrado" });
    }

    const newUser = {
      id: nextId(usuarios),
      nombre,
      email,
      password,
      rol: "cliente"
    };

    usuarios.push(newUser);
    await writeJson("usuarios.json", usuarios);

    res.status(201).json({
      message: "Usuario registrado correctamente",
      userId: newUser.id
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
    let productos = await readJson("productos.json");

    productos = productos.filter((p) => {
      const esGeneral =
        p.aplica_general === true ||
        p.escuela === "General" ||
        p.nivel === "General";

      const coincideEscuela = escuela ? p.escuela === escuela : true;
      const coincideNivel = nivel ? p.nivel === nivel : true;

      return esGeneral || (coincideEscuela && coincideNivel);
    });

    productos = productos.filter((p) => p.disponible !== false);

    res.json(productos);
  } catch (error) {
    console.error("Error en /api/catalogo:", error);
    res.status(500).json({ message: "Error al obtener catálogo" });
  }
});

/* =========================
   ADMIN - VER PRODUCTOS
========================= */
app.get("/api/admin/productos", async (req, res) => {
  try {
    const productos = await readJson("productos.json");
    res.json([...productos].sort((a, b) => b.id - a.id));
  } catch (error) {
    console.error("Error en /api/admin/productos:", error);
    res.status(500).json({ message: "Error al obtener productos" });
  }
});

/* =========================
   ADMIN - AGREGAR PRODUCTO
========================= */
app.post("/api/admin/productos", async (req, res) => {
  try {
    const {
      escuela,
      nivel,
      grado,
      grado_secundaria,
      grado_prepa,
      area_prepa,
      categoria,
      nombre,
      descripcion,
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

    const productos = await readJson("productos.json");

    const newProduct = {
      id: nextId(productos),

      escuela: esGeneral ? "General" : escuela,
      nivel: esGeneral ? "General" : nivel,
      grado: esGeneral ? "General" : (grado || "General"),

      grado_secundaria:
        !esGeneral && nivel === "Secundaria"
          ? String(grado_secundaria || grado || "")
          : "",

      grado_prepa:
        !esGeneral && nivel === "Preparatoria"
          ? String(grado_prepa || grado || "")
          : "",

      area_prepa:
        !esGeneral && nivel === "Preparatoria"
          ? String(area_prepa || "")
          : "",

      categoria,
      nombre,
      descripcion: descripcion || "",
      precio: Number(precio) || 0,
      disponible: disponible !== false,
      requiere_precio: Boolean(requiere_precio),
      aplica_general: esGeneral,

      tallas: Array.isArray(tallas)
        ? tallas.map((t) => ({
            talla: String(t.talla || "Unitalla"),
            stock: Number(t.stock) || 0
          }))
        : []
    };

    productos.push(newProduct);
    await writeJson("productos.json", productos);

    res.status(201).json({
      message: "Producto agregado correctamente",
      productId: newProduct.id
    });
  } catch (error) {
    console.error("Error en POST /api/admin/productos:", error);
    res.status(500).json({ message: "Error al agregar producto" });
  }
});

/* =========================
   ADMIN - ACTUALIZAR PRODUCTO
========================= */
app.put("/api/admin/productos/:id", async (req, res) => {
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
      nombre,
      descripcion,
      precio,
      disponible,
      requiere_precio,
      aplica_general,
      tallas
    } = req.body;

    const productos = await readJson("productos.json");
    const product = productos.find((p) => Number(p.id) === productId);

    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado." });
    }

    if (aplica_general != null) {
      product.aplica_general = Boolean(aplica_general);

      if (product.aplica_general) {
        product.escuela = "General";
        product.nivel = "General";
        product.grado = "General";
        product.grado_secundaria = "";
        product.grado_prepa = "";
        product.area_prepa = "";
      }
    }

    if (!product.aplica_general) {
      if (escuela != null) product.escuela = escuela;
      if (nivel != null) product.nivel = nivel;
      if (grado != null) product.grado = grado || "General";
      if (grado_secundaria != null) product.grado_secundaria = String(grado_secundaria || "");
      if (grado_prepa != null) product.grado_prepa = String(grado_prepa || "");
      if (area_prepa != null) product.area_prepa = String(area_prepa || "");
    }

    if (categoria != null) product.categoria = categoria;
    if (nombre != null) product.nombre = nombre;
    if (descripcion != null) product.descripcion = descripcion;

    if (precio != null) {
      product.precio = Number(precio) || 0;
    }

    if (disponible != null) {
      product.disponible = Boolean(disponible);
    }

    if (requiere_precio != null) {
      product.requiere_precio = Boolean(requiere_precio);
    }

    if (Array.isArray(tallas)) {
      product.tallas = tallas.map((t) => ({
        talla: String(t.talla || "Unitalla"),
        stock: Number(t.stock) || 0
      }));
    }

    await writeJson("productos.json", productos);

    res.json({ message: "Producto actualizado correctamente" });
  } catch (error) {
    console.error("Error en PUT /api/admin/productos/:id:", error);
    res.status(500).json({ message: "Error al actualizar producto" });
  }
});

/* =========================
   ADMIN - ELIMINAR PRODUCTO
========================= */
app.delete("/api/admin/productos/:id", async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const productos = await readJson("productos.json");

    const index = productos.findIndex((p) => Number(p.id) === productId);

    if (index === -1) {
      return res.status(404).json({ message: "Producto no encontrado." });
    }

    productos.splice(index, 1);
    await writeJson("productos.json", productos);

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

    const pedidos = await readJson("pedidos.json");
    const inventario = await readJson("productos.json");

    for (const item of productos) {
      const product = inventario.find((p) => Number(p.id) === Number(item.producto_id));

      if (!product) {
        return res.status(400).json({ message: `Producto ${item.producto_id} no encontrado.` });
      }

      if (product.disponible === false) {
        return res.status(400).json({ message: `${product.nombre} no está disponible.` });
      }

      if (product.requiere_precio === true || Number(product.precio) <= 0) {
        return res.status(400).json({ message: `${product.nombre} aún no tiene precio configurado.` });
      }

      if (!item.talla) {
        return res.status(400).json({ message: `Debes seleccionar talla para ${product.nombre}.` });
      }

      const tallaData = Array.isArray(product.tallas)
        ? product.tallas.find((t) => String(t.talla) === String(item.talla))
        : null;

      if (!tallaData) {
        return res.status(400).json({ message: `La talla ${item.talla} no existe para ${product.nombre}.` });
      }

      if (Number(tallaData.stock) < Number(item.cantidad)) {
        return res.status(400).json({
          message: `Stock insuficiente para ${product.nombre} talla ${item.talla}.`
        });
      }
    }

    for (const item of productos) {
      const product = inventario.find((p) => Number(p.id) === Number(item.producto_id));
      const tallaData = product.tallas.find((t) => String(t.talla) === String(item.talla));
      tallaData.stock = Number(tallaData.stock) - Number(item.cantidad);
    }

    const newOrder = {
      id: nextId(pedidos),
      usuario_id: usuario_id || null,
      nombre_cliente,
      email_cliente,
      telefono_cliente: telefono_cliente || "",
      direccion_envio: direccion_envio || "",
      tipo_entrega,
      metodo_pago,
      subtotal,
      envio,
      total,
      estado: "pendiente",
      creado_en: new Date().toISOString(),
      productos
    };

    pedidos.push(newOrder);

    await writeJson("pedidos.json", pedidos);
    await writeJson("productos.json", inventario);

    res.status(201).json({
      message: "Pedido creado correctamente",
      pedidoId: newOrder.id
    });
  } catch (error) {
    console.error("Error en /api/pedidos:", error);
    res.status(500).json({ message: "Error al crear pedido" });
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

    const contactos = await readJson("contactos.json");

    const newMessage = {
      id: nextId(contactos),
      nombre,
      email,
      telefono: telefono || "",
      asunto,
      mensaje,
      creado_en: new Date().toISOString()
    };

    contactos.push(newMessage);
    await writeJson("contactos.json", contactos);

    res.status(201).json({ message: "Mensaje enviado correctamente" });
  } catch (error) {
    console.error("Error en /api/contacto:", error);
    res.status(500).json({ message: "Error al enviar mensaje" });
  }
});

/* =========================
   VER PEDIDOS
========================= */
app.get("/api/pedidos", async (req, res) => {
  try {
    const pedidos = await readJson("pedidos.json");
    res.json([...pedidos].reverse());
  } catch (error) {
    console.error("Error en GET /api/pedidos:", error);
    res.status(500).json({ message: "Error al obtener pedidos" });
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
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});