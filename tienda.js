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

  updateCartCount();

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
      updateCartCount();
      goTo("login.html");
    });
  }
}

/* =========================
   PRECIOS Y PRODUCTOS
========================= */

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
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

function getTallaData(product, optionName) {
  if (!product || !Array.isArray(product.tallas)) return null;

  return product.tallas.find(
    (item) => String(item.talla) === String(optionName)
  ) || null;
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
  updateCartCount();
}

function getCartItemCount() {
  const cart = getCart();

  return cart.reduce((total, item) => {
    if (item.type === "paquete") {
      const packageQuantity = Number(item.quantity || 1);
      const packageProductsCount = Array.isArray(item.items)
        ? item.items.reduce((acc, child) => acc + Number(child.quantity || 1), 0)
        : 1;

      return total + packageProductsCount * packageQuantity;
    }

    return total + Number(item.quantity || 0);
  }, 0);
}

function updateCartCount() {
  const count = getCartItemCount();
  const cartElements = document.querySelectorAll('a[href="carrito.html"], #cartBtn');

  cartElements.forEach((element) => {
    element.textContent = count > 0 ? `Carrito (${count})` : "Carrito";
  });
}

function getCartQuantityForProductOption(productId, talla) {
  const cart = getCart();

  return cart.reduce((total, item) => {
    if (item.type === "paquete") {
      const packageQuantity = Number(item.quantity || 1);
      const childTotal = Array.isArray(item.items)
        ? item.items.reduce((acc, child) => {
            const matches =
              Number(child.producto_id) === Number(productId) &&
              String(child.talla) === String(talla);

            return matches ? acc + Number(child.quantity || 1) * packageQuantity : acc;
          }, 0)
        : 0;

      return total + childTotal;
    }

    const matches =
      Number(item.producto_id) === Number(productId) &&
      String(item.talla) === String(talla);

    return matches ? total + Number(item.quantity || 0) : total;
  }, 0);
}

function calculateCartAmounts(deliveryValue = null) {
  const cart = getCart();

  const subtotal = cart.reduce((acc, item) => {
    if (item.type === "paquete") {
      return acc + Number(item.originalTotal || 0) * Number(item.quantity || 1);
    }

    return acc + Number(item.price || 0) * Number(item.quantity || 0);
  }, 0);

  const descuento = cart.reduce((acc, item) => {
    if (item.type === "paquete") {
      return acc + Number(item.discountAmount || 0) * Number(item.quantity || 1);
    }

    return acc;
  }, 0);

  const deliveryMethod =
    deliveryValue ||
    document.getElementById("deliveryMethod")?.value ||
    "pickup";

  const envio = deliveryMethod === "delivery" && cart.length > 0 ? 80 : 0;
  const total = subtotal + envio - descuento;

  return {
    subtotal: roundMoney(subtotal),
    descuento: roundMoney(descuento),
    envio: roundMoney(envio),
    total: roundMoney(total)
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
      updateCartCount();
      renderCart();
    });
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async function () {
      const cart = getCart();

      const paymentMethod = document.getElementById("paymentMethod")?.value || "";
      const deliveryValue = document.getElementById("deliveryMethod")?.value || "";

      const shippingAddressData = getShippingAddressData();
      const shippingAddress = formatShippingAddress(shippingAddressData);

      const requiresInvoice =
        document.getElementById("requiresInvoice")?.value === "si";

      let invoiceData = null;

      if (requiresInvoice) {
        try {
          invoiceData = await getInvoiceDataForOrder(paymentMethod);
        } catch (error) {
          alert(error.message || "Completa los datos de facturación.");
          return;
        }
      }

      if (cart.length === 0) {
        alert("Tu carrito está vacío.");
        return;
      }

      if (deliveryValue === "delivery" && !isValidShippingAddress(shippingAddressData)) {
        alert("Completa calle, número exterior, colonia, código postal, municipio/alcaldía y estado.");
        return;
      }

      if (!paymentMethod) {
        alert("Selecciona un método de pago.");
        return;
      }

      const totals = calculateCartAmounts(deliveryValue);
      const productos = buildOrderProductsFromCart(cart);

      if (!productos.length) {
        alert("No se encontraron productos válidos en el carrito.");
        return;
      }

      const payload = {
        usuario_id: localStorage.getItem("userId") || null,
        nombre_cliente: localStorage.getItem("userName") || "Invitado",
        email_cliente: localStorage.getItem("userEmail") || "",
        telefono_cliente: "",
        direccion_envio:
          deliveryValue === "delivery" ? shippingAddress : "Recoger en papelería",
        tipo_entrega: deliveryValue,
        metodo_pago: paymentMethod,
        requiere_factura: requiresInvoice,
        datos_factura: invoiceData,
        descuento: totals.descuento,
        subtotal: totals.subtotal,
        envio: totals.envio,
        total: totals.total,
        productos
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
          "Pedido guardado como prueba en este navegador. Para guardar pedidos reales necesitas publicarlo en Render."
        );

        localStorage.removeItem("cart");
        updateCartCount();
        goTo("index.html");
        return;
      }

      try {
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = "Confirmando...";

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
        updateCartCount();
        alert("Pedido confirmado correctamente.");
        goTo("index.html");
      } catch (error) {
        console.error("Error al confirmar pedido:", error);
        alert("No se pudo conectar con el servidor.");
      } finally {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = "Confirmar pedido";
      }
    });
  }

  function toggleAddressField() {
    if (!deliveryMethod || !addressGroup) return;

    addressGroup.style.display =
      deliveryMethod.value === "delivery" ? "block" : "none";
  }
}

function buildOrderProductsFromCart(cart) {
  const map = new Map();

  function addItem(productoId, talla, cantidad, precio) {
    const key = `${productoId}|||${talla}`;

    if (map.has(key)) {
      const current = map.get(key);
      current.cantidad += Number(cantidad || 0);
      return;
    }

    map.set(key, {
      producto_id: Number(productoId),
      talla: String(talla || ""),
      cantidad: Number(cantidad || 0),
      precio: Number(precio || 0)
    });
  }

  cart.forEach((item) => {
    if (item.type === "paquete") {
      const packageQuantity = Number(item.quantity || 1);

      if (Array.isArray(item.items)) {
        item.items.forEach((child) => {
          addItem(
            child.producto_id,
            child.talla,
            Number(child.quantity || 1) * packageQuantity,
            child.price
          );
        });
      }

      return;
    }

    addItem(
      item.producto_id,
      item.talla,
      item.quantity,
      item.price
    );
  });

  return Array.from(map.values()).filter((item) => item.cantidad > 0);
}

function renderCart() {
  const cartItemsContainer = document.getElementById("cartItems");
  const emptyCartMessage = document.getElementById("emptyCartMessage");

  if (!cartItemsContainer) return;

  const cart = getCart();
  cartItemsContainer.innerHTML = "";
  updateCartCount();

  if (!cart.length) {
    if (emptyCartMessage) emptyCartMessage.style.display = "block";
    updateCartTotals();
    return;
  }

  if (emptyCartMessage) emptyCartMessage.style.display = "none";

  cart.forEach((item, index) => {
    const itemElement = document.createElement("div");
    itemElement.className = item.type === "paquete" ? "cart-item package-cart-item" : "cart-item";

    if (item.type === "paquete") {
      const packageItemsHtml = Array.isArray(item.items)
        ? item.items.map((child) => `
            <li>
              <strong>${escapeHtml(child.name || "Producto")}</strong>
              <br>
              Opción: ${escapeHtml(child.talla || "Sin opción")} ·
              ${formatMoney(child.price || 0)}
            </li>
          `).join("")
        : "";

      itemElement.innerHTML = `
        <div class="cart-item-info">
          <span class="page-badge">Paquete</span>
          <h4>${escapeHtml(item.package_name || item.name || "Paquete")}</h4>

          <p>
            Descuento aplicado:
            <strong>${Number(item.discountPercent || 0)}%</strong>
          </p>

          <ul class="package-cart-products">
            ${packageItemsHtml}
          </ul>

          <p>Subtotal paquete: ${formatMoney(item.originalTotal || 0)}</p>
          <p>Descuento: -${formatMoney(item.discountAmount || 0)}</p>
        </div>

        <div class="cart-item-actions">
          <div class="cart-item-total">
            ${formatMoney(Number(item.price || 0) * Number(item.quantity || 1))}
          </div>

          <button class="remove-btn" type="button" onclick="removeFromCart(${index})">
            Eliminar
          </button>
        </div>
      `;
    } else {
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
    }

    cartItemsContainer.appendChild(itemElement);
  });

  updateCartTotals();
}

function changeQuantity(index, change) {
  const cart = getCart();

  if (!cart[index]) return;

  if (cart[index].type === "paquete") {
    alert("Para modificar un paquete, elimínalo y vuelve a agregarlo con las opciones correctas.");
    return;
  }

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
  const totals = calculateCartAmounts();

  const subtotalElement = document.getElementById("subtotal");
  const shippingElement = document.getElementById("shippingCost");
  const discountElement = document.getElementById("discountAmount");
  const totalElement = document.getElementById("total");

  if (subtotalElement) subtotalElement.textContent = formatMoney(totals.subtotal);
  if (shippingElement) shippingElement.textContent = formatMoney(totals.envio);
  if (discountElement) discountElement.textContent = `-${formatMoney(totals.descuento)}`;
  if (totalElement) totalElement.textContent = formatMoney(totals.total);
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

    tallaData = getTallaData(product, talla);
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

  const currentQuantityInCart = getCartQuantityForProductOption(product.id, talla);

  if (currentQuantityInCart + 1 > Number(tallaData.stock)) {
    alert("No hay suficiente stock para ese producto.");
    return;
  }

  const cart = getCart();

  const existingProduct = cart.find(
    (item) =>
      item.type !== "paquete" &&
      Number(item.producto_id) === Number(product.id) &&
      String(item.talla) === String(talla)
  );

  if (existingProduct) {
    existingProduct.quantity += 1;
    existingProduct.price = selectedPrice;
  } else {
    cart.push({
      type: "producto",
      producto_id: Number(product.id),
      name: product.nombre,
      price: roundMoney(selectedPrice),
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
        return productMatchesCatalogContext(product, escuela, nivel);
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

    if (!Array.isArray(products)) {
      products = [];
    }

    const packages = await loadPackagesForCatalog(escuela, nivel);

    if (!products.length && !packages.length) {
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
    window.currentCatalogPackages = packages;
    window.currentCatalogPackagesMap = {};

    products.forEach((product) => {
      window.currentCatalogProductsMap[product.id] = product;
    });

    packages.forEach((pkg) => {
      window.currentCatalogPackagesMap[pkg.id] = pkg;
    });

    const grouped = groupProductsByCategory(products);
    const categories = Object.keys(grouped);

    if (filtersSelect) {
      const packageOption = packages.length
        ? [`<option value="__paquetes__">Paquetes con descuento</option>`]
        : [];

      filtersSelect.innerHTML = [
        `<option value="todos">Todos</option>`,
        ...packageOption,
        ...categories.map((groupKey) => {
          const label = buildGroupLabel(groupKey);
          return `<option value="${escapeHtmlAttr(groupKey)}">${escapeHtml(label)}</option>`;
        })
      ].join("");

      filtersSelect.addEventListener("change", function () {
        renderCustomerCatalog(grouped, this.value, packages);
      });
    }

    renderCustomerCatalog(grouped, "todos", packages);
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

function productMatchesCatalogContext(product, escuela, nivel) {
  if (!product || product.disponible === false) return false;

  const esGeneral =
    product.aplica_general === true ||
    product.escuela === "General" ||
    product.nivel === "General";

  const coincideEscuela = escuela ? product.escuela === escuela : true;
  const coincideNivel = nivel ? product.nivel === nivel : true;

  return esGeneral || (coincideEscuela && coincideNivel);
}

async function loadPackagesForCatalog(escuela, nivel) {
  if (isGitHubPages()) return [];

  try {
    const response = await fetch(`${API_URL}/api/paquetes`);
    const data = await response.json();

    if (!response.ok || !Array.isArray(data)) {
      return [];
    }

    return data.filter((pkg) => {
      const packageProducts = Array.isArray(pkg.productos)
        ? pkg.productos.map((item) => item.producto).filter(Boolean)
        : [];

      if (!packageProducts.length) return false;

      return packageProducts.every((product) => {
        return (
          productMatchesCatalogContext(product, escuela, nivel) &&
          product.requiere_precio !== true &&
          getTallasDisponibles(product).length > 0 &&
          getFirstAvailablePrice(product) > 0
        );
      });
    });
  } catch (error) {
    console.error("Error cargando paquetes:", error);
    return [];
  }
}

function renderProductImage(product) {
  const imageUrl = String(
    product.imagen_url ||
    product.imagen ||
    product.image_url ||
    ""
  ).trim();

  if (!imageUrl) {
    return `
      <div class="product-image product-image-placeholder">
        ${escapeHtml(product.categoria || "Producto")}
      </div>
    `;
  }

  return `
    <div class="product-image product-photo">
      <img
        src="${escapeHtmlAttr(imageUrl)}"
        alt="${escapeHtmlAttr(product.nombre || "Producto")}"
        loading="lazy"
      />
    </div>
  `;
}

function renderCustomerCatalog(grouped, selectedCategory = "todos", packages = []) {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  const showPackages =
    selectedCategory === "todos" ||
    selectedCategory === "__paquetes__";

  const productEntries =
    selectedCategory === "todos"
      ? Object.entries(grouped)
      : Object.entries(grouped).filter(([groupKey]) => groupKey === selectedCategory);

  const htmlParts = [];

  if (showPackages && packages.length) {
    htmlParts.push(renderPackagesSection(packages));
  }

  if (selectedCategory !== "__paquetes__") {
    if (productEntries.length) {
      htmlParts.push(
        productEntries
          .map(([groupKey, categoryProducts]) => {
            const label = buildGroupLabel(groupKey);

            const categoryCards = categoryProducts
              .map(renderCustomerProductCard)
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
          .join("")
      );
    }
  }

  if (!htmlParts.length) {
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

  grid.innerHTML = htmlParts.join("");

  Object.values(window.currentCatalogProductsMap || {}).forEach((product) => {
    const selectNode = document.getElementById(`size-${product.id}`);
    if (selectNode) {
      updateDisplayedPrice(product.id);
    }
  });

  packages.forEach((pkg) => {
    updatePackageDisplayedPrice(pkg.id);
  });
}

function renderCustomerProductCard(product) {
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
      ${renderProductImage(product)}

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
}

/* =========================
   PAQUETES CLIENTE
========================= */

function renderPackagesSection(packages) {
  const cardsHtml = packages.map(renderPackageCard).join("");

  return `
    <section class="customer-category-section packages-section">
      <div class="customer-category-header">
        <h3>Paquetes con descuento</h3>
      </div>

      <div class="product-grid category-grid">
        ${cardsHtml}
      </div>
    </section>
  `;
}

function renderPackageCard(pkg) {
  const packageProducts = Array.isArray(pkg.productos)
    ? pkg.productos.filter((item) => item.producto)
    : [];

  const productsHtml = packageProducts
    .map((item, index) => {
      const product = item.producto;
      const tallasDisponibles = getTallasDisponibles(product);
      const selectId = getPackageSelectId(pkg.id, product.id, index);

      const optionsHtml = tallasDisponibles
        .map((t) => {
          const optionPrice = Number(t.precio || product.precio || 0);

          return `
            <option value="${escapeHtmlAttr(t.talla)}">
              ${escapeHtml(t.talla)} - ${formatMoney(optionPrice)} (${Number(t.stock)})
            </option>
          `;
        })
        .join("");

      return `
        <div class="package-product-picker">
          <label for="${selectId}">
            ${escapeHtml(product.nombre || "Producto")}
          </label>

          <select
            id="${selectId}"
            onchange="updatePackageDisplayedPrice(${Number(pkg.id)})"
          >
            ${optionsHtml}
          </select>
        </div>
      `;
    })
    .join("");

  return `
    <article class="product-card package-card">
      <div class="product-image product-image-placeholder package-image">
        Paquete
      </div>

      <div class="product-content">
        <span class="page-badge">Paquete</span>
        <h3>${escapeHtml(pkg.nombre || "Paquete")}</h3>
        <p>${escapeHtml(pkg.descripcion || "Sin descripción")}</p>

        <div class="package-discount-badge">
          ${Number(pkg.descuento || 0)}% de descuento
        </div>

        <div class="package-products-picker">
          ${productsHtml}
        </div>

        <div class="package-price-box">
          <p>
            Subtotal:
            <strong id="package-original-${Number(pkg.id)}">$0.00</strong>
          </p>
          <p>
            Descuento:
            <strong id="package-discount-${Number(pkg.id)}">-$0.00</strong>
          </p>
          <p class="package-total-line">
            Total paquete:
            <strong id="package-total-${Number(pkg.id)}">$0.00</strong>
          </p>
        </div>

        <button
          class="btn-primary"
          id="package-add-btn-${Number(pkg.id)}"
          type="button"
          onclick="addPackageToCart(${Number(pkg.id)})"
        >
          Agregar paquete al carrito
        </button>
      </div>
    </article>
  `;
}

function getPackageSelectId(packageId, productId, index) {
  return `package-option-${Number(packageId)}-${Number(productId)}-${Number(index)}`;
}

function getPackageSelections(packageId) {
  const pkg = window.currentCatalogPackagesMap?.[packageId];

  if (!pkg || !Array.isArray(pkg.productos)) {
    return {
      valid: false,
      selections: [],
      subtotal: 0,
      discount: 0,
      total: 0
    };
  }

  const selections = [];
  let subtotal = 0;
  let valid = true;

  pkg.productos.forEach((item, index) => {
    const product = item.producto;
    if (!product) {
      valid = false;
      return;
    }

    const select = document.getElementById(getPackageSelectId(pkg.id, product.id, index));
    const selectedTalla = select ? select.value : "";
    const tallaData = getTallaData(product, selectedTalla);
    const selectedPrice = getOptionPrice(product, selectedTalla);

    if (!selectedTalla || !tallaData || Number(tallaData.stock || 0) <= 0 || selectedPrice <= 0) {
      valid = false;
      return;
    }

    subtotal += selectedPrice;

    selections.push({
      product,
      talla: selectedTalla,
      tallaData,
      price: roundMoney(selectedPrice)
    });
  });

  const discountPercent = Number(pkg.descuento || 0);
  const discount = roundMoney(subtotal * (discountPercent / 100));
  const total = roundMoney(subtotal - discount);

  return {
    valid,
    selections,
    subtotal: roundMoney(subtotal),
    discount,
    total
  };
}

function updatePackageDisplayedPrice(packageId) {
  const data = getPackageSelections(packageId);

  const originalNode = document.getElementById(`package-original-${Number(packageId)}`);
  const discountNode = document.getElementById(`package-discount-${Number(packageId)}`);
  const totalNode = document.getElementById(`package-total-${Number(packageId)}`);
  const buttonNode = document.getElementById(`package-add-btn-${Number(packageId)}`);

  if (originalNode) originalNode.textContent = formatMoney(data.subtotal);
  if (discountNode) discountNode.textContent = `-${formatMoney(data.discount)}`;
  if (totalNode) totalNode.textContent = formatMoney(data.total);

  if (buttonNode) {
    buttonNode.disabled = !data.valid || data.total <= 0;
  }
}

function addPackageToCart(packageId) {
  const pkg = window.currentCatalogPackagesMap?.[packageId];

  if (!pkg) {
    alert("No se encontró el paquete.");
    return;
  }

  const data = getPackageSelections(packageId);

  if (!data.valid || !data.selections.length) {
    alert("Selecciona una opción disponible para cada producto del paquete.");
    return;
  }

  const requestedMap = new Map();

  data.selections.forEach((selection) => {
    const key = `${selection.product.id}|||${selection.talla}`;

    if (!requestedMap.has(key)) {
      requestedMap.set(key, {
        product: selection.product,
        talla: selection.talla,
        tallaData: selection.tallaData,
        quantity: 0
      });
    }

    requestedMap.get(key).quantity += 1;
  });

  for (const request of requestedMap.values()) {
    const currentQuantity = getCartQuantityForProductOption(
      request.product.id,
      request.talla
    );

    if (currentQuantity + request.quantity > Number(request.tallaData.stock || 0)) {
      alert(`No hay suficiente stock para ${request.product.nombre}.`);
      return;
    }
  }

  const cart = getCart();

  const packageItem = {
    type: "paquete",
    package_id: Number(pkg.id),
    package_name: pkg.nombre || "Paquete",
    name: `Paquete: ${pkg.nombre || "Paquete"}`,
    discountPercent: Number(pkg.descuento || 0),
    originalTotal: data.subtotal,
    discountAmount: data.discount,
    price: data.total,
    quantity: 1,
    items: data.selections.map((selection) => ({
      producto_id: Number(selection.product.id),
      name: selection.product.nombre || "Producto",
      grade: buildGradeLabel(selection.product),
      talla: String(selection.talla),
      price: roundMoney(selection.price),
      quantity: 1
    }))
  };

  cart.push(packageItem);
  saveCart(cart);

  alert(`${pkg.nombre} agregado al carrito.`);
}

/* =========================
   AGRUPACIÓN CATÁLOGO
========================= */

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

  const grade =
    product.grado ||
    product.grado_secundaria ||
    product.grado_prepa ||
    "";

  if (grade && grade !== "General") {
    return `${product.escuela} - ${product.nivel} - ${grade}°`;
  }

  return `${product.escuela} - ${product.nivel}`;
}

/* =========================
   FACTURACIÓN
========================= */

async function uploadInvoiceFile(inputId, label, required = true) {
  const input = document.getElementById(inputId);
  const file = input?.files && input.files[0];

  if (!file) {
    if (required) {
      throw new Error(`Falta subir: ${label}.`);
    }

    return "";
  }

  const formData = new FormData();
  formData.append("archivo", file);

  const response = await fetch("/api/subir-archivo", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `No se pudo subir: ${label}.`);
  }

  return data.url || "";
}

async function getInvoiceDataForOrder(paymentMethod) {
  const usoCfdi = document.getElementById("invoiceCfdi")?.value.trim() || "";
  const modoPago = document.getElementById("invoicePaymentMode")?.value.trim() || "";
  const correoFactura = document.getElementById("invoiceEmail")?.value.trim() || "";

  if (!usoCfdi) {
    throw new Error("Escribe el uso de CFDI.");
  }

  if (!modoPago) {
    throw new Error("Selecciona el modo de pago para factura.");
  }

  if (!correoFactura) {
    throw new Error("Escribe el correo donde se enviará la factura.");
  }

  const constanciaFiscalUrl = await uploadInvoiceFile(
    "invoiceFiscalFile",
    "Constancia fiscal actualizada",
    true
  );

  const notaCompraUrl = await uploadInvoiceFile(
    "invoiceReceiptFile",
    "Foto de nota de compra",
    true
  );

  const voucherUrl = await uploadInvoiceFile(
    "invoiceVoucherFile",
    "Foto de voucher de pago con tarjeta",
    paymentMethod === "tarjeta"
  );

  return {
    constancia_fiscal_url: constanciaFiscalUrl,
    uso_cfdi: usoCfdi,
    modo_pago_factura: modoPago,
    nota_compra_url: notaCompraUrl,
    voucher_url: voucherUrl,
    correo_factura: correoFactura
  };
}

/* =========================
   DIRECCIÓN DE ENVÍO
========================= */

function getShippingAddressData() {
  return {
    calle: document.getElementById("shippingStreet")?.value.trim() || "",
    numero_exterior: document.getElementById("shippingExtNumber")?.value.trim() || "",
    numero_interior: document.getElementById("shippingIntNumber")?.value.trim() || "",
    colonia: document.getElementById("shippingNeighborhood")?.value.trim() || "",
    codigo_postal: document.getElementById("shippingZip")?.value.trim() || "",
    municipio: document.getElementById("shippingCity")?.value.trim() || "",
    estado: document.getElementById("shippingState")?.value.trim() || "",
    referencias: document.getElementById("shippingReferences")?.value.trim() || ""
  };
}

function isValidShippingAddress(address) {
  return Boolean(
    address.calle &&
    address.numero_exterior &&
    address.colonia &&
    address.codigo_postal &&
    address.municipio &&
    address.estado
  );
}

function formatShippingAddress(address) {
  if (!address) return "";

  const lines = [
    `${address.calle} ${address.numero_exterior}${address.numero_interior ? " Int. " + address.numero_interior : ""}`,
    `Col. ${address.colonia}`,
    `C.P. ${address.codigo_postal}`,
    `${address.municipio}, ${address.estado}`
  ];

  if (address.referencias) {
    lines.push(`Referencias: ${address.referencias}`);
  }

  return lines.join("\n");
}

/* =========================
   ESCAPE
========================= */

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