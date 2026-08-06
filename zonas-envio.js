/* =========================================================
   REGLAS DE ENVÍO - PAPELERÍA SULAMITA
   Se carga después de tienda.js y antes de setupCartPage().
========================================================= */

(function () {
  "use strict";

  const originalSetupCartPage = window.setupCartPage;
  const nativeFetch = window.fetch.bind(window);

  let matchedShippingRule = null;
  let calculationRequestId = 0;
  let calculationTimer = null;
  let calculationInProgress = false;
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
      deliveryMethod === "delivery" && getCart().length > 0 && matchedShippingRule
        ? Number(matchedShippingRule.costo || 0)
        : 0;

    return {
      subtotal: roundMoney(subtotal),
      descuento: roundMoney(descuento),
      envio: roundMoney(envio),
      total: roundMoney(subtotal + envio - descuento)
    };
  };

  window.getShippingAddressData = function () {
    return {
      regla_envio_id: matchedShippingRule
        ? Number(matchedShippingRule.regla_id)
        : null,
      regla_tipo: matchedShippingRule
        ? String(matchedShippingRule.regla_tipo || "")
        : "",
      regla_tipo_etiqueta: matchedShippingRule
        ? String(matchedShippingRule.regla_tipo_etiqueta || "")
        : "",
      regla_valor: matchedShippingRule
        ? String(matchedShippingRule.regla_valor || "")
        : "",
      zona_id: matchedShippingRule
        ? Number(matchedShippingRule.zona_id)
        : null,
      zona: matchedShippingRule
        ? String(matchedShippingRule.zona || "")
        : "",
      costo_envio: matchedShippingRule
        ? Number(matchedShippingRule.costo || 0)
        : 0,
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
      address.regla_envio_id &&
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
      `Tarifa determinada por ${address.regla_tipo_etiqueta}: ${address.regla_valor}`,
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

    setupShippingRuleCalculator();
    addCheckoutValidationCapture();
  };

  function setupShippingRuleCalculator() {
    const deliveryMethod = document.getElementById("deliveryMethod");
    const fullName = document.getElementById("shippingFullName");
    const email = document.getElementById("shippingEmail");
    const zip = document.getElementById("shippingZip");

    if (fullName && !fullName.value) {
      fullName.value = localStorage.getItem("userName") || "";
    }

    if (email && !email.value) {
      email.value = localStorage.getItem("userEmail") || "";
    }

    if (zip) {
      zip.addEventListener("input", function () {
        zip.value = zip.value.replace(/\D/g, "").slice(0, 5);
      });
    }

    [
      "shippingZip",
      "shippingNeighborhood",
      "shippingCity",
      "shippingState",
      "shippingCountry"
    ].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;

      input.addEventListener("input", scheduleShippingCalculation);
      input.addEventListener("change", scheduleShippingCalculation);
      input.addEventListener("blur", scheduleShippingCalculation);
    });

    if (deliveryMethod) {
      deliveryMethod.addEventListener("change", function () {
        if (deliveryMethod.value === "delivery") {
          scheduleShippingCalculation();
        } else {
          clearMatchedRule();
          updateShippingStatus();
        }

        updateCartTotals();
      });
    }

    updateShippingStatus();
  }

  function scheduleShippingCalculation() {
    clearTimeout(calculationTimer);
    clearMatchedRule();

    const deliveryMethod = document.getElementById("deliveryMethod")?.value;
    if (deliveryMethod !== "delivery") {
      updateShippingStatus();
      return;
    }

    calculationInProgress = true;
    updateShippingStatus("loading");
    updateCartTotals();

    calculationTimer = setTimeout(calculateShippingRule, 450);
  }

  async function calculateShippingRule() {
    const requestId = ++calculationRequestId;
    const address = getMatchableAddressData();

    if (!hasEnoughDataToSearch(address)) {
      calculationInProgress = false;
      clearMatchedRule(false);
      updateShippingStatus();
      updateCartTotals();
      return;
    }

    try {
      const response = await nativeFetch("/api/zonas-envio/calcular", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(address)
      });
      const data = await readJsonSafely(response);

      if (requestId !== calculationRequestId) return;

      if (!response.ok) {
        throw new Error(data.message || "No se pudo calcular el envío.");
      }

      matchedShippingRule = data.encontrada ? data : null;
      window.currentShippingCost = matchedShippingRule
        ? Number(matchedShippingRule.costo || 0)
        : 0;
      calculationInProgress = false;
      updateShippingStatus(matchedShippingRule ? "success" : "not-found");
      updateCartTotals();
    } catch (error) {
      if (requestId !== calculationRequestId) return;

      console.error("Error calculando el envío:", error);
      matchedShippingRule = null;
      window.currentShippingCost = 0;
      calculationInProgress = false;
      updateShippingStatus("error", error.message);
      updateCartTotals();
    }
  }

  function getMatchableAddressData() {
    return {
      codigo_postal:
        document.getElementById("shippingZip")?.value.trim() || "",
      colonia:
        document.getElementById("shippingNeighborhood")?.value.trim() || "",
      municipio:
        document.getElementById("shippingCity")?.value.trim() || "",
      estado:
        document.getElementById("shippingState")?.value.trim() || "",
      pais:
        document.getElementById("shippingCountry")?.value.trim() || ""
    };
  }

  function hasEnoughDataToSearch(address) {
    return Boolean(
      /^\d{5}$/.test(address.codigo_postal) ||
      address.colonia.length >= 2 ||
      address.municipio.length >= 2 ||
      address.estado.length >= 2 ||
      address.pais.length >= 2
    );
  }

  function clearMatchedRule(cancelRequest = true) {
    if (cancelRequest) {
      calculationRequestId += 1;
    }

    matchedShippingRule = null;
    window.currentShippingCost = 0;
  }

  function updateShippingStatus(state = "idle", detail = "") {
    const status = document.getElementById("shippingCoverageStatus");
    const deliveryMethod = document.getElementById("deliveryMethod")?.value;

    if (!status) return;

    if (deliveryMethod !== "delivery") {
      status.className = "shipping-zone-status";
      status.textContent =
        "Selecciona Envío a domicilio para calcular el costo por zona.";
      return;
    }

    if (state === "loading" || calculationInProgress) {
      status.className = "shipping-zone-status is-loading";
      status.textContent = "Calculando el costo de envío...";
      return;
    }

    if (state === "success" && matchedShippingRule) {
      status.className = "shipping-zone-status is-success";
      status.innerHTML = `
        <strong>${escapeHtml(matchedShippingRule.zona)}</strong>
        · Costo: <strong>${formatMoney(matchedShippingRule.costo)}</strong>
        <br>
        Coincidencia por ${escapeHtml(matchedShippingRule.regla_tipo_etiqueta)}:
        <strong>${escapeHtml(matchedShippingRule.regla_valor)}</strong>
        <br>
        Entrega estimada de 1 a 3 días hábiles, después de las 3:00 p. m.
      `;
      return;
    }

    if (state === "not-found") {
      status.className = "shipping-zone-status is-error";
      status.textContent =
        "No hay una tarifa configurada para estos datos. Contacta a la papelería para confirmar el envío.";
      return;
    }

    if (state === "error") {
      status.className = "shipping-zone-status is-error";
      status.textContent = detail || "No se pudo calcular el costo de envío.";
      return;
    }

    status.className = "shipping-zone-status";
    status.textContent =
      "Escribe código postal, colonia, alcaldía o municipio, estado y país para calcular el costo.";
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
    if (!address.nombre_completo) {
      return "Escribe el nombre completo de quien recibirá el pedido.";
    }
    if (!address.telefono) return "Escribe un número de contacto.";
    if (!isValidEmail(address.email)) return "Escribe un correo electrónico válido.";
    if (!/^\d{5}$/.test(address.codigo_postal)) {
      return "Escribe un código postal de 5 dígitos.";
    }
    if (!address.colonia) return "Escribe la colonia.";
    if (!address.municipio) return "Escribe la alcaldía o municipio.";
    if (!address.estado) return "Escribe el estado o entidad federativa.";
    if (!address.pais) return "Escribe el país.";
    if (calculationInProgress) return "Espera un momento mientras se calcula el costo de envío.";
    if (!address.regla_envio_id) {
      return "No se encontró una tarifa para esta dirección. Contacta a la papelería.";
    }
    if (!address.calle) return "Escribe la calle de la dirección de entrega.";
    if (!address.numero_exterior) return "Escribe el número exterior.";
    if (!address.horario_recepcion) {
      return "Selecciona la hora en la que puedes recibir la mercancía.";
    }
    if (!isReceiveTimeValid(address.horario_recepcion)) {
      return "La hora de recepción debe ser a partir de las 3:00 p. m.";
    }

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
        regla_envio_id: address.regla_envio_id,
        zona_envio_id: address.zona_id,
        zona_envio: address.zona,
        datos_envio: address,
        tiempo_entrega: "1 a 3 días hábiles",
        envio: totals.envio,
        total: totals.total
      };

      return JSON.stringify(
        isMercadoPago
          ? { ...parsed, pedido: enhancedOrder }
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
    if (!contentType.includes("application/json")) return {};
    return response.json();
  }
})();
