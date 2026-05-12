const API_URL = "";

function isGitHubPages() {
  return window.location.hostname.includes("github.io");
}

function goTo(page) {
  window.location.href = page;
}

function protectPage() {
  const isSessionActive = localStorage.getItem("sessionActive");
  if (!isSessionActive) {
    goTo("login.html");
  }
}

function protectAdminPage() {
  const role = localStorage.getItem("userRole");
  if (role !== "admin") {
    alert("No tienes permisos para entrar a esta página.");
    goTo("index.html");
  }
}

function setupHeader() {
  const role = localStorage.getItem("userRole") || "invitado";
  const email = localStorage.getItem("userEmail") || "sin correo";
  const name = localStorage.getItem("userName") || "";

  const userInfo = document.getElementById("userInfo");
  if (userInfo) {
    userInfo.textContent = name ? `${name} | ${role}` : `${email} | ${role}`;
  }

  const cartBtn = document.getElementById("cartBtn");
  if (cartBtn) {
    cartBtn.addEventListener("click", function () {
      goTo("carrito.html");
    });
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      localStorage.removeItem("sessionActive");
      localStorage.removeItem("userId");
      localStorage.removeItem("userRole");
      localStorage.removeItem("userEmail");
      localStorage.removeItem("userName");
      localStorage.removeItem("cart");
      localStorage.removeItem("lastOrder");
      goTo("login.html");
    });
  }
}

/* =========================
   PRECIOS POR TALLA
========================= */

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function getTallasDisponibles(product) {
  if (!product || !Array.isArray(product.tallas)) return [];
  return product.tallas.filter((t) => Number(t.stock || 0) > 0);
}

function getFirstAvailablePrice(product) {
  if (!product) return 0;

  const tallasDisponibles = getTallasDisponibles(product);
  const optionWithPrice = tallasDisponibles.find((t) => Number(t.precio || 0) > 0);

  if (optionWithPrice) {
    return Number(optionWithPrice.precio || 0);
  }

  return Number(product.precio || 0);
}

function getOptionPrice(product, optionName) {
  if (!product) return 0;

  if (Array.isArray(product.tallas)) {
    const selectedOption = product.tallas.find(
      (t) => String(t.talla) === String(optionName)
    );

    if (selectedOption && Number(selectedOption.precio || 0) > 0) {
      return Number(selectedOption.precio || 0);
    }
  }

  return Number(product.precio || 0);
}

function getProductStatus(product) {
  if (!product || product.disponible === false) {
    return {
      text: "No disponible",
      buttonText: "No disponible",
      disabled: true,
      className: "status-unavailable"
    };
  }

  const firstPrice = getFirstAvailablePrice(product);

  if (product.requiere_precio === true || firstPrice <= 0) {
    return {
      text: "Precio pendiente",
      buttonText: "Precio pendiente",
      disabled: true,
      className: "status-pending"
    };
  }

  return {
    text: formatMoney(firstPrice),
    buttonText: "Agregar al carrito",
    disabled: false,
    className: "status-available"
  };
}

function updateDisplayedPrice(productId) {
  const product = window.currentCatalogProductsMap?.[productId];
  if (!product) return;

  const priceNode = document.getElementById(`price-display-${productId}`);
  const buttonNode = document.getElementById(`add-btn-${productId}`);
  const selectNode = document.getElementById(`size-${productId}`);

  if (!priceNode || !buttonNode || !selectNode) return;

  const selectedSize = selectNode.value;
  const selectedPrice = getOptionPrice(product, selectedSize);

  if (product.requiere_precio === true || selectedPrice <= 0) {
    priceNode.textContent = "Precio pendiente";
    priceNode.className = "product-price status-pending";
    buttonNode.textContent = "Precio pendiente";
    buttonNode.disabled = true;
    return;
  }

  priceNode.textContent = formatMoney(selectedPrice);
  priceNode.className = "product-price status-available";
  buttonNode.textContent = "Agregar al carrito";
  buttonNode.disabled = false;
}

function isUnitallaProduct(product) {
  if (!Array.isArray(product.tallas) || product.tallas.length !== 1) {
    return false;
  }

  const talla = String(product.tallas[0].talla || "").trim().toLowerCase();

  return (
    talla === "unitalla" ||
    talla === "unidad" ||
    talla === "sin talla" ||
    talla === "n/a"
  );
}

/* =========================
   CARRITO
========================= */

function getCart() {
  try {
    return JSON.parse(localStorage.getItem("cart")) || [];
  } catch (error) {
    console.error("Error leyendo carrito:", error);
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function setupCartPage() {
  renderCart();

  const deliveryMethod = document.getElementById("deliveryMethod");
  const addressGroup = document.getElementById("addressGroup");
  const clearCartBtn = document.getElementById("clearCartBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");

  if (deliveryMethod) {
    toggleAddressField();
    deliveryMethod.addEventListener("change", function () {
      toggleAddressField();
      updateCartTotals();
    });
  }

  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", function () {
      localStorage.removeItem("cart");
      renderCart();
    });
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async function () {
      const cart = getCart();
      const paymentMethod = document.getElementById("paymentMethod")?.value;
      const deliveryValue = document.getElementById("deliveryMethod")?.value;
      const shippingAddress =
        document.getElementById("shippingAddress")?.value.trim() || "";

      if (cart.length === 0) {
        alert("Tu carrito está vacío.");
        return;
      }

      if (deliveryValue === "delivery" && !shippingAddress) {
        alert("Debes escribir una dirección para el envío a domicilio.");
        return;
      }

      const subtotal = cart.reduce(
        (acc, item) => acc + Number(item.price) * Number(item.quantity),
        0
      );
      const envio = deliveryValue === "delivery" ? 80 : 0;
      const total = subtotal + envio;

      const payload = {
        usuario_id: localStorage.getItem("userId") || null,
        nombre_cliente: localStorage.getItem("userName") || "Invitado",
        email_cliente: localStorage.getItem("userEmail") || "",
        telefono_cliente: "",
        direccion_envio:
          deliveryValue === "delivery" ? shippingAddress : "Recoger en papelería",
        tipo_entrega: deliveryValue,
        metodo_pago: paymentMethod,
        subtotal,
        envio,
        total,
        productos: cart.map((item) => ({
          producto_id: Number(item.producto_id),
          talla: item.talla,
          cantidad: Number(item.quantity),
          precio: Number(item.price)
        }))
      };

      if (isGitHubPages()) {
        localStorage.setItem(
          "lastOrder",
          JSON.stringify({
            ...payload,
            pedidoId: Date.now()
          })
        );

        alert(
          "Pedido guardado como prueba en este navegador. Para guardar pedidos reales necesitas publicar el servidor en Render."
        );

        localStorage.removeItem("cart");
        goTo("index.html");
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/pedidos`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
          alert(data.message || "No se pudo guardar el pedido.");
          return;
        }

        localStorage.setItem(
          "lastOrder",
          JSON.stringify({
            ...payload,
            pedidoId: data.pedidoId
          })
        );

        localStorage.removeItem("cart");
        alert("Pedido confirmado correctamente.");
        goTo("index.html");
      } catch (error) {
        console.error("Error al confirmar pedido:", error);
        alert("No se pudo conectar con el servidor.");
      }
    });
  }

  function toggleAddressField() {
    if (!deliveryMethod || !addressGroup) return;
    addressGroup.style.display =
      deliveryMethod.value === "delivery" ? "block" : "none";
  }
}

function renderCart() {
  const cartItemsContainer = document.getElementById("cartItems");
  const emptyCartMessage = document.getElementById("emptyCartMessage");

  if (!cartItemsContainer) return;

  const cart = getCart();
  cartItemsContainer.innerHTML = "";

  if (!cart.length) {
    if (emptyCartMessage) emptyCartMessage.style.display = "block";
    updateCartTotals();
    return;
  }

  if (emptyCartMessage) emptyCartMessage.style.display = "none";

  cart.forEach((item, index) => {
    const itemElement = document.createElement("div");
    itemElement.className = "cart-item";

    const optionHtml =
      item.talla && item.talla !== "Unidad"
        ? `<p>Opción: <strong>${escapeHtml(item.talla)}</strong></p>`
        : "";

    itemElement.innerHTML = `
      <div class="cart-item-info">
        <h4>${escapeHtml(item.name)}</h4>
        <p>Escuela/Nivel: ${escapeHtml(item.grade)}</p>
        ${optionHtml}
        <p>Precio unitario: ${formatMoney(item.price)}</p>
      </div>

      <div class="cart-item-actions">
        <div class="quantity-box">
          <button class="qty-btn" type="button" onclick="changeQuantity(${index}, -1)">-</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" type="button" onclick="changeQuantity(${index}, 1)">+</button>
        </div>

        <div class="cart-item-total">
          ${formatMoney(Number(item.price) * Number(item.quantity))}
        </div>

        <button class="remove-btn" type="button" onclick="removeFromCart(${index})">Eliminar</button>
      </div>
    `;

    cartItemsContainer.appendChild(itemElement);
  });

  updateCartTotals();
}

function changeQuantity(index, change) {
  const cart = getCart();

  if (!cart[index]) return;

  cart[index].quantity = Number(cart[index].quantity) + Number(change);

  if (cart[index].quantity <= 0) {
    cart.splice(index, 1);
  }

  saveCart(cart);
  renderCart();
}

function removeFromCart(index) {
  const cart = getCart();

  if (!cart[index]) return;

  cart.splice(index, 1);
  saveCart(cart);
  renderCart();
}

function updateCartTotals() {
  const cart = getCart();
  const deliveryMethod = document.getElementById("deliveryMethod");

  const subtotal = cart.reduce(
    (acc, item) => acc + Number(item.price) * Number(item.quantity),
    0
  );

  let shipping = 0;
  if (deliveryMethod && deliveryMethod.value === "delivery" && cart.length > 0) {
    shipping = 80;
  }

  const total = subtotal + shipping;

  const subtotalElement = document.getElementById("subtotal");
  const shippingElement = document.getElementById("shippingCost");
  const totalElement = document.getElementById("total");

  if (subtotalElement) subtotalElement.textContent = formatMoney(subtotal);
  if (shippingElement) shippingElement.textContent = formatMoney(shipping);
  if (totalElement) totalElement.textContent = formatMoney(total);
}

function addProductToCart(product) {
  const isUnitalla = isUnitallaProduct(product);

  let talla = "Unidad";
  let tallaData = null;

  if (isUnitalla) {
    tallaData = product.tallas[0];
    talla = String(tallaData.talla || "Unidad");
  } else {
    const select = document.getElementById(`size-${product.id}`);
    talla = select ? select.value : "";

    if (!talla) {
      alert("Selecciona una opción.");
      return;
    }

    tallaData = Array.isArray(product.tallas)
      ? product.tallas.find((t) => String(t.talla) === String(talla))
      : null;
  }

  if (!tallaData || Number(tallaData.stock) <= 0) {
    alert("Ese producto no está disponible.");
    return;
  }

  const selectedPrice = getOptionPrice(product, talla);

  if (product.requiere_precio === true || selectedPrice <= 0) {
    alert("Este producto todavía no tiene precio configurado.");
    return;
  }

  const cart = getCart();

  const existingProduct = cart.find(
    (item) =>
      Number(item.producto_id) === Number(product.id) &&
      String(item.talla) === String(talla)
  );

  if (existingProduct) {
    if (existingProduct.quantity + 1 > Number(tallaData.stock)) {
      alert("No hay suficiente stock para ese producto.");
      return;
    }

    existingProduct.quantity += 1;
    existingProduct.price = selectedPrice;
  } else {
    cart.push({
      producto_id: Number(product.id),
      name: product.nombre,
      price: selectedPrice,
      grade: buildGradeLabel(product),
      talla: String(talla),
      quantity: 1
    });
  }

  saveCart(cart);
  alert(`${product.nombre} agregado al carrito`);
}

/* =========================
   CATÁLOGO CLIENTE
========================= */

async function loadProductsPage(config) {
  const { escuela, nivel, title = "", subtitle = "" } = config;

  const titleNode = document.getElementById("productsTitle");
  const subtitleNode = document.getElementById("productsSubtitle");
  const grid = document.getElementById("productGrid");
  const filtersSelect = document.getElementById("categoryFilters");

  if (!grid) return;

  if (titleNode && title) titleNode.textContent = title;
  if (subtitleNode && subtitle) subtitleNode.textContent = subtitle;

  grid.innerHTML = `
    <article class="product-card">
      <div class="product-content">
        <h3>Cargando productos...</h3>
      </div>
    </article>
  `;

  if (filtersSelect) {
    filtersSelect.innerHTML = "";
  }

  try {
    let products = [];

    if (isGitHubPages()) {
      const response = await fetch("data/productos.json?v=4");

      if (!response.ok) {
        grid.innerHTML = `
          <article class="product-card">
            <div class="product-content">
              <h3>Error al cargar productos</h3>
              <p>No se encontró el archivo data/productos.json.</p>
            </div>
          </article>
        `;
        return;
      }

      products = await response.json();

      products = products.filter((product) => {
        const esGeneral =
          product.aplica_general === true ||
          product.escuela === "General" ||
          product.nivel === "General";

        const coincideEscuela = escuela ? product.escuela === escuela : true;
        const coincideNivel = nivel ? product.nivel === nivel : true;

        return (esGeneral || (coincideEscuela && coincideNivel)) && product.disponible !== false;
      });
    } else {
      const params = new URLSearchParams();
      if (escuela) params.append("escuela", escuela);
      if (nivel) params.append("nivel", nivel);

      const response = await fetch(`${API_URL}/api/catalogo?${params.toString()}`);
      products = await response.json();

      if (!response.ok) {
        grid.innerHTML = `
          <article class="product-card">
            <div class="product-content">
              <h3>Error al cargar productos</h3>
              <p>${escapeHtml(products.message || "No se pudo cargar el catálogo.")}</p>
            </div>
          </article>
        `;
        return;
      }
    }

    if (!Array.isArray(products) || !products.length) {
      grid.innerHTML = `
        <article class="product-card">
          <div class="product-content">
            <h3>No hay productos disponibles</h3>
            <p>Cuando el administrador cargue el catálogo, aparecerá aquí.</p>
          </div>
        </article>
      `;
      return;
    }

    window.currentCatalogProducts = products;
    window.currentCatalogProductsMap = {};

    products.forEach((product) => {
      window.currentCatalogProductsMap[product.id] = product;
    });

    const grouped = groupProductsByCategory(products);
    const categories = Object.keys(grouped);

    if (filtersSelect) {
      filtersSelect.innerHTML = [
        `<option value="todos">Todos</option>`,
        ...categories.map((groupKey) => {
          const label = buildGroupLabel(groupKey);
          return `<option value="${escapeHtmlAttr(groupKey)}">${escapeHtml(label)}</option>`;
        })
      ].join("");

      filtersSelect.addEventListener("change", function () {
        renderCustomerCatalog(grouped, this.value);
      });
    }

    renderCustomerCatalog(grouped, "todos");
  } catch (error) {
    console.error("Error cargando productos:", error);
    grid.innerHTML = `
      <article class="product-card">
        <div class="product-content">
          <h3>Error al cargar productos</h3>
          <p>No se pudo conectar con el servidor o cargar data/productos.json.</p>
        </div>
      </article>
    `;
  }
}

function renderCustomerCatalog(grouped, selectedCategory = "todos") {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  const entries =
    selectedCategory === "todos"
      ? Object.entries(grouped)
      : Object.entries(grouped).filter(([groupKey]) => groupKey === selectedCategory);

  if (!entries.length) {
    grid.innerHTML = `
      <article class="product-card">
        <div class="product-content">
          <h3>No hay productos en esta sección</h3>
          <p>Selecciona otra sección del catálogo.</p>
        </div>
      </article>
    `;
    return;
  }

  grid.innerHTML = entries
    .map(([groupKey, categoryProducts]) => {
      const label = buildGroupLabel(groupKey);

      const categoryCards = categoryProducts
        .map((product) => {
          const status = getProductStatus(product);
          const isUnitalla = isUnitallaProduct(product);

          const tallasDisponibles = getTallasDisponibles(product);

          const stockUnitalla =
            isUnitalla && product.tallas[0]
              ? Number(product.tallas[0].stock || 0)
              : 0;

          const optionsHtml = tallasDisponibles.length
            ? tallasDisponibles
                .map((t) => {
                  const optionPrice = Number(t.precio || product.precio || 0);
                  return `
                    <option
                      value="${escapeHtmlAttr(t.talla)}"
                      data-price="${optionPrice}"
                    >
                      ${escapeHtml(t.talla)} - ${formatMoney(optionPrice)} (${Number(t.stock)})
                    </option>
                  `;
                })
                .join("")
            : `<option value="">Sin disponibles</option>`;

          const productOptionsHtml = isUnitalla
            ? `
              <div class="product-sizes-info">
                <strong>Disponibles:</strong>
                <span class="customer-size-badge">${stockUnitalla} piezas</span>
              </div>
            `
            : `
              <div class="product-sizes-info">
                <strong>Opciones disponibles:</strong>
                ${
                  tallasDisponibles.length
                    ? tallasDisponibles
                        .map((t) => {
                          const optionPrice = Number(t.precio || product.precio || 0);
                          return `
                            <span class="customer-size-badge">
                              ${escapeHtml(t.talla)} · ${formatMoney(optionPrice)}
                            </span>
                          `;
                        })
                        .join("")
                    : `<span class="customer-size-badge empty">Sin disponibles</span>`
                }
              </div>

              <div class="form-group">
                <label for="size-${product.id}">Selecciona opción</label>
                <select
                  id="size-${product.id}"
                  ${status.disabled || !tallasDisponibles.length ? "disabled" : ""}
                  onchange="updateDisplayedPrice(${product.id})"
                >
                  ${optionsHtml}
                </select>
              </div>
            `;

          return `
            <article class="product-card">
              <div class="product-image">${escapeHtml(product.categoria || "Producto")}</div>
              <div class="product-content">
                <h3>${escapeHtml(product.nombre || "Producto sin nombre")}</h3>
                <p>${escapeHtml(product.descripcion || "Sin descripción")}</p>

                <div
                  class="product-price ${status.className}"
                  id="price-display-${product.id}"
                >
                  ${status.text}
                </div>

                ${productOptionsHtml}

                <button
                  class="btn-primary"
                  id="add-btn-${product.id}"
                  type="button"
                  ${status.disabled || !tallasDisponibles.length ? "disabled" : ""}
                  onclick="addProductToCart(window.currentCatalogProductsMap[${product.id}])"
                >
                  ${status.buttonText}
                </button>
              </div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="customer-category-section">
          <div class="customer-category-header">
            <h3>${escapeHtml(label)}</h3>
          </div>
          <div class="product-grid category-grid">
            ${categoryCards}
          </div>
        </section>
      `;
    })
    .join("");

  Object.values(window.currentCatalogProductsMap || {}).forEach((product) => {
    const selectNode = document.getElementById(`size-${product.id}`);
    if (selectNode) {
      updateDisplayedPrice(product.id);
    }
  });
}

function groupProductsByCategory(products) {
  return products.reduce((acc, product) => {
    let section = "General";

    const esGeneral =
      product.aplica_general === true ||
      product.escuela === "General" ||
      product.nivel === "General";

    const grado =
      product.grado ||
      product.grado_secundaria ||
      product.grado_prepa ||
      "";

    if (esGeneral) {
      section = "General";
    } else if (product.nivel === "Secundaria") {
      if (grado && grado !== "General") {
        section = `${grado}° Secundaria`;
      } else {
        section = "General Secundaria";
      }
    } else if (product.nivel === "Preparatoria") {
      const parts = [];

      if (grado && grado !== "General") {
        parts.push(`${grado}° Preparatoria`);
      }

      if (product.area_prepa) {
        parts.push(product.area_prepa);
      }

      section = parts.length ? parts.join(" · ") : "General Preparatoria";
    } else if (product.nivel === "Primaria") {
      if (grado && grado !== "General") {
        section = `${grado}° Primaria`;
      } else {
        section = "General Primaria";
      }
    } else if (product.nivel === "Jardín de niños") {
      section = "Jardín de niños";
    }

    let category = product.categoria || "Sin categoría";

    if (category === "Uniformes" && product.genero_uniforme) {
      category = `${category} · ${product.genero_uniforme}`;
    }

    const key = `${section}|||${category}`;

    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push(product);
    return acc;
  }, {});
}

function buildGroupLabel(groupKey) {
  const [section, category] = String(groupKey).split("|||");

  if (!category) return section || "Sin categoría";

  if (section === "General") {
    return `General · ${category}`;
  }

  return `${section} · ${category}`;
}

function buildGradeLabel(product) {
  if (product.nivel === "Secundaria" && product.grado_secundaria) {
    return `${product.escuela} - ${product.nivel} - ${product.grado_secundaria}° Secundaria`;
  }

  if (product.nivel === "Preparatoria") {
    const parts = [`${product.escuela} - ${product.nivel}`];

    if (product.grado_prepa) {
      parts.push(`${product.grado_prepa}°`);
    }

    if (product.area_prepa) {
      parts.push(product.area_prepa);
    }

    return parts.join(" - ");
  }

  return `${product.escuela} - ${product.nivel}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}