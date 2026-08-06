-- =========================================================
-- BASE DE DATOS · PAPELERÍA SULAMITA
-- PostgreSQL
--
-- Este archivo puede ejecutarse más de una vez.
-- Crea las tablas, columnas e índices necesarios sin borrar datos.
-- =========================================================

BEGIN;

-- =========================================================
-- USUARIOS Y SESIONES
-- =========================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'cliente',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email
  ON usuarios (LOWER(email));

CREATE TABLE IF NOT EXISTS sesiones_usuario (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL
    REFERENCES usuarios(id)
    ON DELETE CASCADE,
  expira_en TIMESTAMP NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_id
  ON sesiones_usuario (usuario_id);

CREATE INDEX IF NOT EXISTS idx_sesiones_expira_en
  ON sesiones_usuario (expira_en);

-- =========================================================
-- PRODUCTOS E INVENTARIO
-- =========================================================

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  escuela TEXT NOT NULL DEFAULT 'General',
  nivel TEXT NOT NULL DEFAULT 'General',
  grado TEXT NOT NULL DEFAULT 'General',
  grado_secundaria TEXT NOT NULL DEFAULT '',
  grado_prepa TEXT NOT NULL DEFAULT '',
  area_prepa TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL,
  genero_uniforme TEXT NOT NULL DEFAULT '',
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  imagen_url TEXT NOT NULL DEFAULT '',
  imagenes_url JSONB NOT NULL DEFAULT '[]'::jsonb,
  precio NUMERIC(10, 2) NOT NULL DEFAULT 0,
  disponible BOOLEAN NOT NULL DEFAULT TRUE,
  requiere_precio BOOLEAN NOT NULL DEFAULT FALSE,
  aplica_general BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS grado_secundaria TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS grado_prepa TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS area_prepa TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS genero_uniforme TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imagen_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imagenes_url JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requiere_precio BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS aplica_general BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_productos_catalogo
  ON productos (escuela, nivel, categoria);

CREATE INDEX IF NOT EXISTS idx_productos_disponible
  ON productos (disponible);

CREATE TABLE IF NOT EXISTS producto_tallas (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL
    REFERENCES productos(id)
    ON DELETE CASCADE,
  talla TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  precio NUMERIC(10, 2) NOT NULL DEFAULT 0
);

ALTER TABLE producto_tallas
  ADD COLUMN IF NOT EXISTS precio NUMERIC(10, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_producto_tallas_producto
  ON producto_tallas (producto_id);

-- =========================================================
-- ZONAS Y REGLAS DE ENVÍO
-- =========================================================

CREATE TABLE IF NOT EXISTS zonas_envio (
  id SERIAL PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  costo NUMERIC(10, 2) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO zonas_envio (
  numero,
  nombre,
  costo,
  activo
)
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

CREATE TABLE IF NOT EXISTS cobertura_envio (
  id SERIAL PRIMARY KEY,
  zona_id INTEGER NOT NULL
    REFERENCES zonas_envio(id)
    ON DELETE CASCADE,
  colonia TEXT NOT NULL,
  codigo_postal TEXT NOT NULL,
  municipio TEXT NOT NULL,
  estado TEXT NOT NULL,
  pais TEXT NOT NULL DEFAULT 'México',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE cobertura_envio
  ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'México';

UPDATE cobertura_envio
SET pais = 'México'
WHERE pais IS NULL OR TRIM(pais) = '';

ALTER TABLE cobertura_envio
  ALTER COLUMN pais SET NOT NULL;

ALTER TABLE cobertura_envio
  DROP CONSTRAINT IF EXISTS cobertura_envio_codigo_postal_colonia_municipio_estado_key;

CREATE INDEX IF NOT EXISTS idx_cobertura_envio_cp
  ON cobertura_envio (codigo_postal);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cobertura_envio_ubicacion_completa
  ON cobertura_envio (
    codigo_postal,
    colonia,
    municipio,
    estado,
    pais
  );

CREATE TABLE IF NOT EXISTS reglas_envio (
  id SERIAL PRIMARY KEY,
  zona_id INTEGER NOT NULL
    REFERENCES zonas_envio(id)
    ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (
    tipo IN (
      'codigo_postal',
      'colonia',
      'municipio',
      'estado',
      'pais'
    )
  ),
  valor TEXT NOT NULL,
  valor_normalizado TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE reglas_envio
  DROP CONSTRAINT IF EXISTS reglas_envio_tipo_valor_normalizado_key;

DROP INDEX IF EXISTS reglas_envio_tipo_valor_normalizado_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_envio_zona_tipo_valor
  ON reglas_envio (
    zona_id,
    tipo,
    valor_normalizado
  );

DELETE FROM reglas_envio anterior
USING reglas_envio reciente
WHERE
  anterior.tipo = 'colonia'
  AND reciente.tipo = 'colonia'
  AND anterior.valor_normalizado = reciente.valor_normalizado
  AND anterior.id < reciente.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_envio_colonia_unica
  ON reglas_envio (valor_normalizado)
  WHERE tipo = 'colonia';

CREATE INDEX IF NOT EXISTS idx_reglas_envio_busqueda
  ON reglas_envio (
    tipo,
    valor_normalizado
  )
  WHERE activo IS NOT FALSE;

-- =========================================================
-- PEDIDOS
-- =========================================================

CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER
    REFERENCES usuarios(id)
    ON DELETE SET NULL,
  nombre_cliente TEXT NOT NULL,
  email_cliente TEXT NOT NULL,
  telefono_cliente TEXT NOT NULL DEFAULT '',
  direccion_envio TEXT NOT NULL DEFAULT '',
  tipo_entrega TEXT NOT NULL,
  metodo_pago TEXT NOT NULL,
  requiere_factura BOOLEAN NOT NULL DEFAULT FALSE,
  datos_factura JSONB,
  descuento NUMERIC(10, 2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(10, 2) NOT NULL,
  envio NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total NUMERIC(10, 2) NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  estado_pago TEXT NOT NULL DEFAULT 'pendiente',
  mp_preference_id TEXT NOT NULL DEFAULT '',
  mp_payment_id TEXT NOT NULL DEFAULT '',
  mp_status TEXT NOT NULL DEFAULT '',
  zona_envio_id INTEGER
    REFERENCES zonas_envio(id)
    ON DELETE SET NULL,
  zona_envio TEXT NOT NULL DEFAULT '',
  datos_envio JSONB,
  tiempo_entrega TEXT NOT NULL DEFAULT '',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS telefono_cliente TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS direccion_envio TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requiere_factura BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS datos_factura JSONB,
  ADD COLUMN IF NOT EXISTS descuento NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS mp_preference_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mp_payment_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mp_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS zona_envio_id INTEGER
    REFERENCES zonas_envio(id)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zona_envio TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS datos_envio JSONB,
  ADD COLUMN IF NOT EXISTS tiempo_entrega TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pedidos_usuario
  ON pedidos (usuario_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_estado
  ON pedidos (estado);

CREATE INDEX IF NOT EXISTS idx_pedidos_creado_en
  ON pedidos (creado_en DESC);

CREATE TABLE IF NOT EXISTS pedido_productos (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL
    REFERENCES pedidos(id)
    ON DELETE CASCADE,
  producto_id INTEGER NOT NULL
    REFERENCES productos(id),
  talla TEXT NOT NULL DEFAULT '',
  cantidad INTEGER NOT NULL,
  precio NUMERIC(10, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedido_productos_pedido
  ON pedido_productos (pedido_id);

CREATE INDEX IF NOT EXISTS idx_pedido_productos_producto
  ON pedido_productos (producto_id);

-- =========================================================
-- PAQUETES
-- =========================================================

CREATE TABLE IF NOT EXISTS paquetes (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  descuento NUMERIC(5, 2) NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paquete_productos (
  id SERIAL PRIMARY KEY,
  paquete_id INTEGER NOT NULL
    REFERENCES paquetes(id)
    ON DELETE CASCADE,
  producto_id INTEGER NOT NULL
    REFERENCES productos(id)
    ON DELETE CASCADE,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_paquete_productos_paquete
  ON paquete_productos (paquete_id);

-- =========================================================
-- LISTAS DE ÚTILES
-- =========================================================

CREATE TABLE IF NOT EXISTS listas_utiles (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'Escuela',
  escuela TEXT NOT NULL DEFAULT '',
  nivel TEXT NOT NULL DEFAULT '',
  grado TEXT NOT NULL DEFAULT '',
  archivo_url TEXT NOT NULL,
  archivo_tipo TEXT NOT NULL DEFAULT '',
  archivo_nombre TEXT NOT NULL DEFAULT '',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listas_utiles_activo
  ON listas_utiles (activo);

-- =========================================================
-- CONTACTO
-- =========================================================

CREATE TABLE IF NOT EXISTS contactos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT NOT NULL DEFAULT '',
  asunto TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contactos_creado_en
  ON contactos (creado_en DESC);

COMMIT;