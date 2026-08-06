/* =========================================================
   ZONAS DE ENVÍO - PAPELERÍA SULAMITA
   Este archivo se carga después de tienda.js y antes de
   ejecutar setupCartPage().
========================================================= */

(function () {
  "use strict";

  const originalSetupCartPage = window.setupCartPage;
  const nativeFetch = window.fetch.bind(window);

  let selectedCoverage = null;
  let coverageRequestId = 0;
  let fetchInterceptorInstalled = false;

  window.currentShippingCost = 0;

  window.calculateCartAmounts = function (deliveryValue = null) {
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

    const envio =
      deliveryMethod === "delivery" && cart.length > 0 && selectedCoverage
        ? Number(selectedCoverage.costo || 0)
        : 0;

    const total = subtotal + envio - descuento;

    return {
      subtotal: roundMoney(subtotal),
      descuento: roundMoney(descuento),
      envio: roundMoney(envio),
      total: roundMoney(total)
    };
  };

  window.getShippingAddressData = function () {
    return {
      cobertura_envio_id: selectedCoverage ? Number(selectedCoverage.id) : null,
      zona_id: selectedCoverage ? Number(selectedCoverage.zona_id) : null,
      zona: selectedCoverage ? String(selectedCoverage.zona || "") : "",
      costo_envio: selectedCoverage ? Number(selectedCoverage.costo || 0) : 0,
      nombre_completo:
        document.getElementById("shippingFullName")?.value.trim() || "",
      telefono:
        document.getElementById("shippingPhone")?.value.trim() || "",
      email:
        document.getElementById("shippingEmail")?.value.trim() || "",
      calle:
        document.getElementById("shippingStreet")?.value.trim() || "",
      numero_exterior:
        document.getElementById("shippingExtNumber")?.value.trim() || "",
      numero_interior:
        document.getElementById("shippingIntNumber")?.value.trim() || "",
      colonia:
        document.getElementById("shippingNeighborhood")?.value.trim() || "",
      codigo_postal:
        document.getElementById("shippingZip")?.value.trim() || "",
      municipio:
        document.getElementById("shippingCity")?.value.trim() || "",
      estado:
        document.getElementById("shippingState")?.value.trim() || "",
      pais:
        document.getElementById("shippingCountry")?.value.trim() || "",
      horario_recepcion:
        document.getElementById("shippingReceiveTime")?.value.trim() || "",
      referencias:
        document.getElementById("shippingReferences")?.value.trim() || "",
      tiempo_estimado: "1 a 3 días hábiles"
    };
  };

  window.isValidShippingAddress = function (address) {
    return Boolean(
      address &&
      address.cobertura_envio_id &&
      address.nombre_completo &&
      address.telefono &&
      isValidEmail(address.email) &&
      address.calle &&
      address.numero_exterior &&
      address.colonia &&
      /^\d{5}$/.test(address.codigo_postal) &&
      address.municipio &&
      address.estado &&
      address.pais &&
      isReceiveTimeValid(address.horario_recepcion)
    );
  };

  window.formatShippingAddress = function (address) {
    if (!address) return "";

    const lines = [
      `Nombre: ${address.nombre_completo}`,
      `Contacto: ${address.telefono}`,
      `Correo: ${address.email}`,
      `${address.calle} ${address.numero_exterior}${
        address.numero_interior ? " Int. " + address.numero_interior : ""
      }`,
      `Col. ${address.colonia}`,
      `C.P. ${address.codigo_postal}`,
      `${address.municipio}, ${address.estado}, ${address.pais}`,
      `${address.zona} · Envío ${formatMoney(address.costo_envio)}`,
      `Horario para recibir: ${formatTimeForDisplay(address.horario_recepcion)}`,
      "Tiempo estimado de entrega: 1 a 3 días hábiles"
    ];

    if (address.referencias) {
      lines.push(`Referencias: ${address.referencias}`);
    }

    return lines.join("\n");
  };

  window.setupCartPage = function () {
    installFetchInterceptor();

    if (typeof originalSetupCartPage === "function") {
      originalSetupCartPage();
    }

    setupShippingZoneForm();
    addCheckoutValidationCapture();
  };

  function setupShippingZoneForm() {
    const zipInput = document.getElementById("shippingZip");
    const neighborhoodSelect = document.getElementById("shippingNeighborhood");
    const deliveryMethod = document.getElementById("deliveryMethod");
    const fullName = document.getElementById("shippingFullName");
    const email = document.getElementById("shippingEmail");

    if (!zipInput || !neighborhoodSelect) return;

    if (fullName && !fullName.value) {
      fullName.value = localStorage.getItem("userName") || "";
    }

    if (email && !email.value) {
      email.value = localStorage.getItem("userEmail") || "";
    }

    zipInput.addEventListener("input", function () {
      zipInput.value = zipInput.value.replace(/\D/g, "").slice(0, 5);
      resetCoverageSelection();

      if (zipInput.value.length === 5) {
        searchCoverageByZip(zipInput.value);
      }
    });

    neighborhoodSelect.addEventListener("change", function () {
      const option = neighborhoodSelect.selectedOptions[0];

      if (!option || !option.dataset.coverage) {
        resetCoverageSelection(false);
        return;
      }

      try {
        selectedCoverage = JSON.parse(option.dataset.coverage);
      } catch (error) {
        console.error("No se pudo leer la cobertura:", error);
        resetCoverageSelection(false);
        return;
      }

      applySelectedCoverage();
    });

    if (deliveryMethod) {
      deliveryMethod.addEventListener("change", function () {
        if (deliveryMethod.value !== "delivery") {
          window.currentShippingCost = 0;
        } else if (selectedCoverage) {
          window.currentShippingCost = Number(selectedCoverage.costo || 0);
        }

        updateShippingZoneMessage();
        updateCartTotals();
      });
    }

    updateShippingZoneMessage();
  }

  async function searchCoverageByZip(zipCode) {
    const requestId = ++coverageRequestId;
    const neighborhoodSelect = document.getElementById("shippingNeighborhood");
    const status = document.getElementById("shippingCoverageStatus");

    if (!neighborhoodSelect) return;

    neighborhoodSelect.disabled = true;
    neighborhoodSelect.innerHTML = `<option value="">Buscando colonias...</option>`;

    if (status) {
      status.className = "shipping-zone-status is-loading";
      status.textContent = "Buscando cobertura para este código postal...";
    }

    try {
      const response = await nativeFetch(
        `/api/zonas-envio/cobertura?codigo_postal=${encodeURIComponent(zipCode)}`,
        {
          credentials: "include"
        }
      );

      const data = await readJsonSafely(response);

      if (requestId !== coverageRequestId) return;

      if (!response.ok) {
        throw new Error(data.message || "No se pudo consultar la cobertura.");
      }

      const coverages = Array.isArray(data) ? data : [];

      if (!coverages.length) {
        neighborhoodSelect.innerHTML = `
          <option value="">Sin colonias disponibles para este C.P.</option>
        `;
        neighborhoodSelect.disabled = true;

        if (status) {
          status.className = "shipping-zone-status is-error";
          status.textContent =
            "Este código postal todavía no está registrado en una zona de entrega. Contacta a la papelería para confirmarlo.";
        }

        return;
      }

      neighborhoodSelect.innerHTML = [
        `<option value="">Selecciona tu colonia</option>`,
        ...coverages.map((coverage) => {
          const serialized = escapeHtmlAttr(JSON.stringify(coverage));

          return `
            <option
              value="${escapeHtmlAttr(coverage.colonia)}"
              data-coverage="${serialized}"
            >
              ${escapeHtml(coverage.colonia)} — ${escapeHtml(coverage.municipio)}, ${escapeHtml(coverage.estado)} — ${escapeHtml(coverage.zona)} (${formatMoney(coverage.costo)})
            </option>
          `;
        })
      ].join("");

      neighborhoodSelect.disabled = false;

      if (status) {
        status.className = "shipping-zone-status is-ready";
        status.textContent =
          "Selecciona tu colonia para calcular automáticamente el costo de envío.";
      }
    } catch (error) {
      console.error("Error consultando cobertura:", error);

      neighborhoodSelect.innerHTML = `
        <option value="">No se pudo cargar la cobertura</option>
      `;
      neighborhoodSelect.disabled = true;

      if (status) {
        status.className = "shipping-zone-status is-error";
        status.textContent =
          error.message || "No se pudo consultar la cobertura de envío.";
      }
    }
  }

  function applySelectedCoverage() {
    if (!selectedCoverage) return;

    const city = document.getElementById("shippingCity");
    const state = document.getElementById("shippingState");
    const country = document.getElementById("shippingCountry");

    if (city) city.value = selectedCoverage.municipio || "";
    if (state) state.value = selectedCoverage.estado || "";
    if (country) country.value = selectedCoverage.pais || "";

    window.currentShippingCost = Number(selectedCoverage.costo || 0);
    updateShippingZoneMessage();
    updateCartTotals();
  }

  function resetCoverageSelection(clearNeighborhood = true) {
    selectedCoverage = null;
    window.currentShippingCost = 0;

    const neighborhoodSelect = document.getElementById("shippingNeighborhood");
    const city = document.getElementById("shippingCity");
    const state = document.getElementById("shippingState");
    const country = document.getElementById("shippingCountry");

    if (clearNeighborhood && neighborhoodSelect) {
      neighborhoodSelect.innerHTML = `
        <option value="">Primero escribe el código postal</option>
      `;
      neighborhoodSelect.disabled = true;
    }

    if (city) city.value = "";
    if (state) state.value = "";
    if (country) country.value = "";

    updateShippingZoneMessage();
    updateCartTotals();
  }

  function updateShippingZoneMessage() {
    const status = document.getElementById("shippingCoverageStatus");
    const deliveryMethod = document.getElementById("deliveryMethod");

    if (!status) return;

    if (deliveryMethod && deliveryMethod.value !== "delivery") {
      status.className = "shipping-zone-status";
      status.textContent =
        "Selecciona Envío a domicilio para calcular el costo por zona.";
      return;
    }

    if (!selectedCoverage) {
      status.className = "shipping-zone-status";
      status.textContent =
        "Escribe tu código postal y selecciona la ubicación registrada.";
      return;
    }

    status.className = "shipping-zone-status is-success";
    status.innerHTML = `
      <strong>${escapeHtml(selectedCoverage.zona)}</strong>
      · Costo de envío: <strong>${formatMoney(selectedCoverage.costo)}</strong>
      <br>
      Entrega estimada de 1 a 3 días hábiles, después de las 3:00 p. m.
    `;
  }

  function addCheckoutValidationCapture() {
    const checkoutBtn = document.getElementById("checkoutBtn");

    if (!checkoutBtn) return;

    checkoutBtn.addEventListener(
      "click",
      function (event) {
        const deliveryMethod =
          document.getElementById("deliveryMethod")?.value || "pickup";

        if (deliveryMethod !== "delivery") return;

        const address = window.getShippingAddressData();
        const error = getShippingValidationError(address);

        if (!error) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        alert(error);
      },
      true
    );
  }

  function getShippingValidationError(address) {
    if (!address.nombre_completo) return "Escribe el nombre completo de quien recibirá el pedido.";
    if (!address.telefono) return "Escribe un número de contacto.";
    if (!isValidEmail(address.email)) return "Escribe un correo electrónico válido.";
    if (!/^\d{5}$/.test(address.codigo_postal)) return "Escribe un código postal de 5 dígitos.";
    if (!address.cobertura_envio_id) {
      return "Selecciona una ubicación registrada para calcular la zona y el costo de envío.";
    }
    if (!address.calle) return "Escribe la calle de la dirección de entrega.";
    if (!address.numero_exterior) return "Escribe el número exterior.";
    if (!address.pais) return "Selecciona el país.";
    if (!address.horario_recepcion) return "Selecciona la hora en la que puedes recibir la mercancía.";
    if (!isReceiveTimeValid(address.horario_recepcion)) return "La hora de recepción debe ser a partir de las 3:00 p. m.";

    return "";
  }

  function installFetchInterceptor() {
    if (fetchInterceptorInstalled) return;

    fetchInterceptorInstalled = true;

    window.fetch = async function (input, init = {}) {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init.method || "GET").toUpperCase();

      if (method === "POST" && init.body && typeof init.body === "string") {
        if (url.includes("/api/pedidos")) {
          init = {
            ...init,
            body: enhanceOrderBody(init.body, false),
            credentials: init.credentials || "include"
          };
        }

        if (url.includes("/api/mercadopago/crear-preferencia")) {
          init = {
            ...init,
            body: enhanceOrderBody(init.body, true),
            credentials: init.credentials || "include"
          };
        }
      }

      return nativeFetch(input, init);
    };
  }

  function enhanceOrderBody(rawBody, isMercadoPago) {
    try {
      const parsed = JSON.parse(rawBody);
      const order = isMercadoPago ? parsed.pedido : parsed;

      if (!order || order.tipo_entrega !== "delivery") {
        return rawBody;
      }

      const address = window.getShippingAddressData();
      const totals = window.calculateCartAmounts("delivery");

      const enhancedOrder = {
        ...order,
        nombre_cliente: address.nombre_completo,
        email_cliente: address.email,
        telefono_cliente: address.telefono,
        direccion_envio: window.formatShippingAddress(address),
        cobertura_envio_id: address.cobertura_envio_id,
        zona_envio_id: address.zona_id,
        zona_envio: address.zona,
        datos_envio: address,
        tiempo_entrega: "1 a 3 días hábiles",
        envio: totals.envio,
        total: totals.total
      };

      return JSON.stringify(
        isMercadoPago
          ? {
              ...parsed,
              pedido: enhancedOrder
            }
          : enhancedOrder
      );
    } catch (error) {
      console.error("No se pudo completar la información de envío:", error);
      return rawBody;
    }
  }

  function isReceiveTimeValid(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return false;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;

    return hour > 15 || (hour === 15 && minute >= 0);
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function formatTimeForDisplay(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return value || "";

    const hour = Number(match[1]);
    const minute = match[2];
    const suffix = hour >= 12 ? "p. m." : "a. m.";
    const displayHour = hour % 12 || 12;

    return `${displayHour}:${minute} ${suffix}`;
  }

  async function readJsonSafely(response) {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return {};
    }

    return response.json();
  }
})();
