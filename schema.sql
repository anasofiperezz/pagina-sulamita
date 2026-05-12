CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'cliente',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  escuela TEXT NOT NULL DEFAULT 'General',
  nivel TEXT NOT NULL DEFAULT 'General',
  grado TEXT DEFAULT 'General',
  grado_secundaria TEXT DEFAULT '',
  grado_prepa TEXT DEFAULT '',
  area_prepa TEXT DEFAULT '',
  categoria TEXT NOT NULL,
  genero_uniforme TEXT DEFAULT '',
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  precio NUMERIC(10, 2) DEFAULT 0,
  disponible BOOLEAN DEFAULT TRUE,
  requiere_precio BOOLEAN DEFAULT FALSE,
  aplica_general BOOLEAN DEFAULT FALSE,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS producto_tallas (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  talla TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  precio NUMERIC(10, 2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER,
  nombre_cliente TEXT NOT NULL,
  email_cliente TEXT NOT NULL,
  telefono_cliente TEXT DEFAULT '',
  direccion_envio TEXT DEFAULT '',
  tipo_entrega TEXT NOT NULL,
  metodo_pago TEXT NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  envio NUMERIC(10, 2) NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  estado TEXT DEFAULT 'pendiente',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedido_productos (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL,
  talla TEXT DEFAULT '',
  cantidad INTEGER NOT NULL,
  precio NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS contactos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT DEFAULT '',
  asunto TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);