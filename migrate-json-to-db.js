const fs = require("fs/promises");
const path = require("path");
const pool = require("./db");

const dataDir = path.join(__dirname, "data");

async function readJson(filename, fallback = []) {
  try {
    const filePath = path.join(dataDir, filename);
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`No se pudo leer ${filename}. Se usará vacío.`);
    return fallback;
  }
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

async function migrateUsuarios(client) {
  const usuarios = await readJson("usuarios.json");

  console.log(`Migrando usuarios: ${usuarios.length}`);

  for (const user of usuarios) {
    await client.query(
      `
      INSERT INTO usuarios (id, nombre, email, password, rol, creado_en)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamp, CURRENT_TIMESTAMP))
      ON CONFLICT (email) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        password = EXCLUDED.password,
        rol = EXCLUDED.rol
      `,
      [
        cleanNumber(user.id),
        cleanText(user.nombre, "Usuario"),
        cleanText(user.email),
        cleanText(user.password),
        cleanText(user.rol, "cliente"),
        user.creado_en || null
      ]
    );
  }

  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('usuarios', 'id'),
      COALESCE((SELECT MAX(id) FROM usuarios), 1),
      true
    )
  `);
}

async function migrateProductos(client) {
  const productos = await readJson("productos.json");

  console.log(`Migrando productos: ${productos.length}`);

  for (const product of productos) {
    const productResult = await client.query(
      `
      INSERT INTO productos (
        id,
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
        creado_en
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14,
        COALESCE($15::timestamp, CURRENT_TIMESTAMP)
      )
      ON CONFLICT (id) DO UPDATE SET
        escuela = EXCLUDED.escuela,
        nivel = EXCLUDED.nivel,
        grado = EXCLUDED.grado,
        grado_secundaria = EXCLUDED.grado_secundaria,
        grado_prepa = EXCLUDED.grado_prepa,
        area_prepa = EXCLUDED.area_prepa,
        categoria = EXCLUDED.categoria,
        nombre = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        precio = EXCLUDED.precio,
        disponible = EXCLUDED.disponible,
        requiere_precio = EXCLUDED.requiere_precio,
        aplica_general = EXCLUDED.aplica_general
      RETURNING id
      `,
      [
        cleanNumber(product.id),
        cleanText(product.escuela, "General"),
        cleanText(product.nivel, "General"),
        cleanText(product.grado, "General"),
        cleanText(product.grado_secundaria),
        cleanText(product.grado_prepa),
        cleanText(product.area_prepa),
        cleanText(product.categoria, "Sin categoría"),
        cleanText(product.nombre, "Producto sin nombre"),
        cleanText(product.descripcion),
        cleanNumber(product.precio),
        product.disponible !== false,
        cleanBoolean(product.requiere_precio, false),
        cleanBoolean(product.aplica_general, false),
        product.creado_en || null
      ]
    );

    const productId = productResult.rows[0].id;

    await client.query(
      "DELETE FROM producto_tallas WHERE producto_id = $1",
      [productId]
    );

    const tallas = Array.isArray(product.tallas) ? product.tallas : [];

    for (const item of tallas) {
      await client.query(
        `
        INSERT INTO producto_tallas (producto_id, talla, stock)
        VALUES ($1, $2, $3)
        `,
        [
          productId,
          cleanText(item.talla, "Unidad"),
          cleanNumber(item.stock)
        ]
      );
    }
  }

  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('productos', 'id'),
      COALESCE((SELECT MAX(id) FROM productos), 1),
      true
    )
  `);
}

async function migratePedidos(client) {
  const pedidos = await readJson("pedidos.json");

  console.log(`Migrando pedidos: ${pedidos.length}`);

  for (const order of pedidos) {
    const orderResult = await client.query(
      `
      INSERT INTO pedidos (
        id,
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
        estado,
        creado_en
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        COALESCE($13::timestamp, CURRENT_TIMESTAMP)
      )
      ON CONFLICT (id) DO UPDATE SET
        usuario_id = EXCLUDED.usuario_id,
        nombre_cliente = EXCLUDED.nombre_cliente,
        email_cliente = EXCLUDED.email_cliente,
        telefono_cliente = EXCLUDED.telefono_cliente,
        direccion_envio = EXCLUDED.direccion_envio,
        tipo_entrega = EXCLUDED.tipo_entrega,
        metodo_pago = EXCLUDED.metodo_pago,
        subtotal = EXCLUDED.subtotal,
        envio = EXCLUDED.envio,
        total = EXCLUDED.total,
        estado = EXCLUDED.estado
      RETURNING id
      `,
      [
        cleanNumber(order.id),
        order.usuario_id ? cleanNumber(order.usuario_id) : null,
        cleanText(order.nombre_cliente, "Cliente"),
        cleanText(order.email_cliente),
        cleanText(order.telefono_cliente),
        cleanText(order.direccion_envio),
        cleanText(order.tipo_entrega, "pickup"),
        cleanText(order.metodo_pago, "contra_entrega"),
        cleanNumber(order.subtotal),
        cleanNumber(order.envio),
        cleanNumber(order.total),
        cleanText(order.estado, "pendiente"),
        order.creado_en || null
      ]
    );

    const pedidoId = orderResult.rows[0].id;

    await client.query(
      "DELETE FROM pedido_productos WHERE pedido_id = $1",
      [pedidoId]
    );

    const productos = Array.isArray(order.productos) ? order.productos : [];

    for (const item of productos) {
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
          cleanNumber(item.producto_id),
          cleanText(item.talla),
          cleanNumber(item.cantidad, 1),
          cleanNumber(item.precio)
        ]
      );
    }
  }

  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('pedidos', 'id'),
      COALESCE((SELECT MAX(id) FROM pedidos), 1),
      true
    )
  `);
}

async function migrateContactos(client) {
  const contactos = await readJson("contactos.json");

  console.log(`Migrando contactos: ${contactos.length}`);

  for (const contacto of contactos) {
    await client.query(
      `
      INSERT INTO contactos (
        id,
        nombre,
        email,
        telefono,
        asunto,
        mensaje,
        creado_en
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        COALESCE($7::timestamp, CURRENT_TIMESTAMP)
      )
      ON CONFLICT (id) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        email = EXCLUDED.email,
        telefono = EXCLUDED.telefono,
        asunto = EXCLUDED.asunto,
        mensaje = EXCLUDED.mensaje
      `,
      [
        cleanNumber(contacto.id),
        cleanText(contacto.nombre, "Sin nombre"),
        cleanText(contacto.email),
        cleanText(contacto.telefono),
        cleanText(contacto.asunto, "Sin asunto"),
        cleanText(contacto.mensaje),
        contacto.creado_en || null
      ]
    );
  }

  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('contactos', 'id'),
      COALESCE((SELECT MAX(id) FROM contactos), 1),
      true
    )
  `);
}

async function migrate() {
  const client = await pool.connect();

  try {
    console.log("Iniciando migración de JSON a PostgreSQL...");

    await client.query("BEGIN");

    await migrateUsuarios(client);
    await migrateProductos(client);
    await migratePedidos(client);
    await migrateContactos(client);

    await client.query("COMMIT");

    console.log("Migración completada correctamente.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error durante la migración:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();