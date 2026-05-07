const API_URL = "";

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

function getProductStatus(product) {
  if (!product || product.disponible === false) {
    return {
      text: "No disponible",
      buttonText: "No disponible",
      disabled: true,
      className: "status-unavailable"
    };
  }

  if (product.requiere_precio === true || Number(product.precio || 0) <= 0) {
    return {
      text: "Precio pendiente",
      buttonText: "Precio pendiente",
      disabled: true,
      className: "status-pending"
    };
  }

  return {
    text: `$${Number(product.precio).toFixed(2)}`,
    buttonText: "Agregar al carrito",
    disabled: false,
    className: "status-available"
  };
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

    itemElement.innerHTML = `
      <div class="cart-item-info">
        <h4>${escapeHtml(item.name)}</h4>
        <p>Escuela/Nivel: ${escapeHtml(item.grade)}</p>
        <p>Opción: <strong>${escapeHtml(item.talla)}</strong></p>
        <p>Precio unitario: $${Number(item.price).toFixed(2)}</p>
      </div>

      <div class="cart-item-actions">
        <div class="quantity-box">
          <button class="qty-btn" type="button" onclick="changeQuantity(${index}, -1)">-</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" type="button" onclick="changeQuantity(${index}, 1)">+</button>
        </div>

        <div class="cart-item-total">
          $${(Number(item.price) * Number(item.quantity)).toFixed(2)}
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

  if (subtotalElement) subtotalElement.textContent = `$${subtotal.toFixed(2)}`;
  if (shippingElement) shippingElement.textContent = `$${shipping.toFixed(2)}`;
  if (totalElement) totalElement.textContent = `$${total.toFixed(2)}`;
}

function addProductToCart(product) {
  const select = document.getElementById(`size-${product.id}`);
  const talla = select ? select.value : "";

  if (!talla) {
    alert("Selecciona una opción.");
    return;
  }

  const tallaData = Array.isArray(product.tallas)
    ? product.tallas.find((t) => String(t.talla) === String(talla))
    : null;

  if (!tallaData || Number(tallaData.stock) <= 0) {
    alert("Esa opción no está disponible.");
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
      alert("No hay suficiente stock para esa opción.");
      return;
    }
    existingProduct.quantity += 1;
  } else {
    cart.push({
      producto_id: Number(product.id),
      name: product.nombre,
      price: Number(product.precio),
      grade: buildGradeLabel(product),
      talla: String(talla),
      quantity: 1
    });
  }

  saveCart(cart);
  alert(`${product.nombre} agregado al carrito`);
}

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
    const params = new URLSearchParams();
    if (escuela) params.append("escuela", escuela);
    if (nivel) params.append("nivel", nivel);

    const response = await fetch(`${API_URL}/api/catalogo?${params.toString()}`);
    const products = await response.json();

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

    if (!products.length) {
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
          <p>No se pudo conectar con el servidor.</p>
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

  grid.innerHTML = entries
    .map(([groupKey, categoryProducts]) => {
      const label = buildGroupLabel(groupKey);

      const categoryCards = categoryProducts
        .map((product) => {
          const status = getProductStatus(product);

          const tallasDisponibles = Array.isArray(product.tallas)
            ? product.tallas.filter((t) => Number(t.stock) > 0)
            : [];

          const optionsHtml = tallasDisponibles.length
            ? tallasDisponibles
                .map(
                  (t) =>
                    `<option value="${escapeHtmlAttr(t.talla)}">${escapeHtml(t.talla)} (${Number(t.stock)})</option>`
                )
                .join("")
            : `<option value="">Sin disponibles</option>`;

          return `
            <article class="product-card">
              <div class="product-image">${escapeHtml(product.categoria || "Producto")}</div>
              <div class="product-content">
                <h3>${escapeHtml(product.nombre)}</h3>
                <p>${escapeHtml(product.descripcion || "Sin descripción")}</p>

                <div class="product-price ${status.className}">
                  ${status.text}
                </div>

                <div class="product-sizes-info">
                  <strong>Opciones disponibles:</strong>
                  ${
                    tallasDisponibles.length
                      ? tallasDisponibles
                          .map(
                            (t) =>
                              `<span class="customer-size-badge">${escapeHtml(t.talla)}</span>`
                          )
                          .join("")
                      : `<span class="customer-size-badge empty">Sin disponibles</span>`
                  }
                </div>

                <div class="form-group">
                  <label for="size-${product.id}">Selecciona opción</label>
                  <select id="size-${product.id}" ${
                    status.disabled || !tallasDisponibles.length ? "disabled" : ""
                  }>
                    ${optionsHtml}
                  </select>
                </div>

                <button
                  class="btn-primary"
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

    const category = product.categoria || "Sin categoría";
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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}