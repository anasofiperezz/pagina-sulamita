/* =========================================================
   ZONAS DE ENVÍO · PAPELERÍA SULAMITA

   Este archivo debe cargarse:
   1. Después de tienda.js.
   2. Antes de ejecutar setupCartPage().
========================================================= */

(function () {
  "use strict";

  /*
    Evita instalar dos veces los mismos eventos si el archivo
    se carga accidentalmente más de una vez.
  */
  if (window.__sulamitaShippingModuleLoaded) {
    return;
  }

  window.__sulamitaShippingModuleLoaded = true;

  /* =========================
     CONFIGURACIÓN
  ========================= */

  const SHIPPING_CALCULATION_URL =
    "/api/zonas-envio/calcular";

  const SHIPPING_CALCULATION_DELAY_MS = 450;
  const DELIVERY_TIME_TEXT = "1 a 3 días hábiles";

  const originalSetupCartPage =
    window.setupCartPage;

  const nativeFetch =
    window.fetch.bind(window);

  /* =========================
     ESTADO INTERNO
  ========================= */

  let matchedShippingRule = null;
  let lastShippingResolution = null;

  let calculationRequestId = 0;
  let calculationTimer = null;
  let calculationInProgress = false;

  let fetchInterceptorInstalled = false;
  let shippingCalculatorInitialized = false;
  let checkoutValidationInstalled = false;

  window.currentShippingCost = 0;

  /* =========================
     TOTALES DEL CARRITO
  ========================= */

  window.calculateCartAmounts = function (
    deliveryValue = null
  ) {
    const cart = getCart();

    const subtotal = cart.reduce(
      function (total, item) {
        if (item.type === "paquete") {
          return (
            total +
            Number(item.originalTotal || 0) *
              Number(item.quantity || 1)
          );
        }

        return (
          total +
          Number(item.price || 0) *
            Number(item.quantity || 0)
        );
      },
      0
    );

    const descuento = cart.reduce(
      function (total, item) {
        if (item.type === "paquete") {
          return (
            total +
            Number(item.discountAmount || 0) *
              Number(item.quantity || 1)
          );
        }

        return total;
      },
      0
    );

    const deliveryMethod =
      deliveryValue ||
      document.getElementById("deliveryMethod")?.value ||
      "pickup";

    const shippingCost =
      deliveryMethod === "delivery" &&
      cart.length > 0 &&
      matchedShippingRule
        ? Number(matchedShippingRule.costo || 0)
        : 0;

    const total = Math.max(
      0,
      subtotal + shippingCost - descuento
    );

    return {
      subtotal: roundMoney(subtotal),
      descuento: roundMoney(descuento),
      envio: roundMoney(shippingCost),
      total: roundMoney(total)
    };
  };

  /* =========================
     DATOS DE LA DIRECCIÓN
  ========================= */

  window.getShippingAddressData = function () {
    return {
      regla_envio_id: matchedShippingRule
        ? Number(matchedShippingRule.regla_id)
        : null,

      regla_tipo: matchedShippingRule
        ? String(
            matchedShippingRule.regla_tipo ||
            ""
          )
        : "",

      regla_tipo_etiqueta: matchedShippingRule
        ? String(
            matchedShippingRule.regla_tipo_etiqueta ||
            ""
          )
        : "",

      regla_valor: matchedShippingRule
        ? String(
            matchedShippingRule.regla_valor ||
            ""
          )
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
        getInputValue("shippingFullName"),

      telefono:
        getInputValue("shippingPhone"),

      email:
        getInputValue("shippingEmail")
          .toLowerCase(),

      calle:
        getInputValue("shippingStreet"),

      numero_exterior:
        getInputValue("shippingExtNumber"),

      numero_interior:
        getInputValue("shippingIntNumber"),

      colonia:
        getInputValue("shippingNeighborhood"),

      codigo_postal:
        cleanPostalCode(
          getInputValue("shippingZip")
        ),

      municipio:
        getInputValue("shippingCity"),

      estado:
        getInputValue("shippingState"),

      pais:
        getInputValue("shippingCountry") ||
        "México",

      horario_recepcion:
        getInputValue("shippingReceiveTime"),

      referencias:
        getInputValue("shippingReferences"),

      tiempo_estimado:
        DELIVERY_TIME_TEXT
    };
  };

  window.isValidShippingAddress = function (
    address
  ) {
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
      isReceiveTimeValid(
        address.horario_recepcion
      )
    );
  };

  window.formatShippingAddress = function (
    address
  ) {
    if (!address) return "";

    const interiorText =
      address.numero_interior
        ? ` Int. ${address.numero_interior}`
        : "";

    const lines = [
      `Nombre: ${address.nombre_completo}`,
      `Contacto: ${address.telefono}`,
      `Correo: ${address.email}`,
      `${address.calle} ${address.numero_exterior}${interiorText}`,
      `Col. ${address.colonia}`,
      `C. P. ${address.codigo_postal}`,
      `${address.municipio}, ${address.estado}, ${address.pais}`,
      `${address.zona} · Envío ${formatMoney(address.costo_envio)}`,
      `Tarifa final determinada por colonia: ${address.regla_valor}`,
      `Horario para recibir: ${formatTimeForDisplay(address.horario_recepcion)}`,
      `Tiempo estimado de entrega: ${DELIVERY_TIME_TEXT}`
    ];

    if (address.referencias) {
      lines.push(
        `Referencias: ${address.referencias}`
      );
    }

    return lines.join("\n");
  };

  /* =========================
     INICIALIZAR CARRITO
  ========================= */

  window.setupCartPage = function () {
    installFetchInterceptor();

    if (
      typeof originalSetupCartPage ===
      "function"
    ) {
      originalSetupCartPage();
    }

    setupShippingRuleCalculator();
    addCheckoutValidationCapture();
  };

  function setupShippingRuleCalculator() {
    if (shippingCalculatorInitialized) {
      return;
    }

    shippingCalculatorInitialized = true;

    const deliveryMethod =
      document.getElementById("deliveryMethod");

    const zipInput =
      document.getElementById("shippingZip");

    fillStoredCustomerData();

    if (zipInput) {
      zipInput.addEventListener(
        "input",
        function () {
          zipInput.value = cleanPostalCode(
            zipInput.value
          );
        }
      );
    }

    [
      "shippingZip",
      "shippingNeighborhood",
      "shippingCity",
      "shippingState",
      "shippingCountry"
    ].forEach(function (id) {
      const input =
        document.getElementById(id);

      if (!input) return;

      input.addEventListener(
        "input",
        scheduleShippingCalculation
      );

      input.addEventListener(
        "change",
        scheduleShippingCalculation
      );

      input.addEventListener(
        "blur",
        scheduleShippingCalculation
      );
    });

    if (deliveryMethod) {
      deliveryMethod.addEventListener(
        "change",
        function () {
          clearTimeout(calculationTimer);

          if (
            deliveryMethod.value ===
            "delivery"
          ) {
            scheduleShippingCalculation();
          } else {
            clearMatchedRule();
            updateShippingStatus();
          }

          updateCartTotals();
        }
      );
    }

    updateShippingStatus();

    if (
      deliveryMethod?.value === "delivery"
    ) {
      scheduleShippingCalculation();
    }
  }

  function fillStoredCustomerData() {
    const fullName =
      document.getElementById(
        "shippingFullName"
      );

    const email =
      document.getElementById(
        "shippingEmail"
      );

    const country =
      document.getElementById(
        "shippingCountry"
      );

    if (fullName && !fullName.value) {
      fullName.value =
        localStorage.getItem("userName") ||
        "";
    }

    if (email && !email.value) {
      email.value =
        localStorage.getItem("userEmail") ||
        "";
    }

    if (country && !country.value) {
      country.value = "México";
    }
  }

  /* =========================
     CALCULAR ZONA
  ========================= */

  function scheduleShippingCalculation() {
    clearTimeout(calculationTimer);
    clearMatchedRule();

    const deliveryMethod =
      document.getElementById(
        "deliveryMethod"
      )?.value;

    if (deliveryMethod !== "delivery") {
      updateShippingStatus();
      updateCartTotals();
      return;
    }

    const address =
      getMatchableAddressData();

    if (!hasEnoughDataToSearch(address)) {
      updateShippingStatus();
      updateCartTotals();
      return;
    }

    calculationInProgress = true;
    updateShippingStatus("loading");
    updateCartTotals();

    calculationTimer = setTimeout(
      calculateShippingRule,
      SHIPPING_CALCULATION_DELAY_MS
    );
  }

  async function calculateShippingRule() {
    const requestId =
      ++calculationRequestId;

    const address =
      getMatchableAddressData();

    if (!hasEnoughDataToSearch(address)) {
      calculationInProgress = false;
      clearMatchedRule(false);
      updateShippingStatus();
      updateCartTotals();
      return;
    }

    try {
      const response = await nativeFetch(
        SHIPPING_CALCULATION_URL,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify(address)
        }
      );

      const data =
        await readJsonSafely(response);

      if (
        requestId !== calculationRequestId
      ) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          data.message ||
          "No fue posible calcular el costo de envío."
        );
      }

      lastShippingResolution = data;

      matchedShippingRule =
        data.encontrada
          ? data
          : null;

      window.currentShippingCost =
        matchedShippingRule
          ? Number(
              matchedShippingRule.costo ||
              0
            )
          : 0;

      calculationInProgress = false;

      updateShippingStatus(
        matchedShippingRule
          ? "success"
          : data.ambigua
            ? "ambiguous"
            : "not-found"
      );

      updateCartTotals();
    } catch (error) {
      if (
        requestId !== calculationRequestId
      ) {
        return;
      }

      console.error(
        "Error calculando el envío:",
        error
      );

      matchedShippingRule = null;
      lastShippingResolution = null;
      window.currentShippingCost = 0;
      calculationInProgress = false;

      updateShippingStatus(
        "error",
        error.message
      );

      updateCartTotals();
    }
  }

  function getMatchableAddressData() {
    return {
      codigo_postal: cleanPostalCode(
        getInputValue("shippingZip")
      ),

      colonia:
        getInputValue(
          "shippingNeighborhood"
        ),

      municipio:
        getInputValue("shippingCity"),

      estado:
        getInputValue("shippingState"),

      pais:
        getInputValue("shippingCountry") ||
        "México"
    };
  }

  function hasEnoughDataToSearch(
    address
  ) {
    return Boolean(
      /^\d{5}$/.test(
        address.codigo_postal
      ) &&
      address.municipio.length >= 2 &&
      address.colonia.length >= 2
    );
  }

  function clearMatchedRule(
    cancelRequest = true
  ) {
    if (cancelRequest) {
      calculationRequestId += 1;
    }

    matchedShippingRule = null;
    lastShippingResolution = null;
    window.currentShippingCost = 0;
    calculationInProgress = false;
  }

  /* =========================
     MENSAJE DE COBERTURA
  ========================= */

  function updateShippingStatus(
    state = "idle",
    detail = ""
  ) {
    const status =
      document.getElementById(
        "shippingCoverageStatus"
      );

    const deliveryMethod =
      document.getElementById(
        "deliveryMethod"
      )?.value;

    if (!status) return;

    if (
      deliveryMethod !== "delivery"
    ) {
      status.className =
        "shipping-zone-status";

      status.textContent =
        "Selecciona Envío a domicilio para calcular el costo por zona.";

      return;
    }

    if (
      state === "loading" ||
      calculationInProgress
    ) {
      status.className =
        "shipping-zone-status is-loading";

      status.textContent =
        "Calculando el costo de envío...";

      return;
    }

    if (
      state === "success" &&
      matchedShippingRule
    ) {
      renderSuccessfulShippingStatus(
        status
      );

      return;
    }

    if (state === "ambiguous") {
      status.className =
        "shipping-zone-status is-error";

      status.textContent =
        lastShippingResolution?.message ||
        "Los datos coinciden con varias zonas. Revisa la alcaldía o municipio.";

      return;
    }

    if (state === "not-found") {
      status.className =
        "shipping-zone-status is-error";

      status.textContent =
        lastShippingResolution?.message ||
        "No hay una tarifa configurada para esta dirección. Contacta a la papelería para confirmar el envío.";

      return;
    }

    if (state === "error") {
      status.className =
        "shipping-zone-status is-error";

      status.textContent =
        detail ||
        "No fue posible calcular el costo de envío.";

      return;
    }

    status.className =
      "shipping-zone-status";

    status.textContent =
      "Escribe el código postal, la alcaldía o municipio y la colonia. La colonia confirmará la zona final.";
  }

  function renderSuccessfulShippingStatus(
    status
  ) {
    const matches = Array.isArray(
      matchedShippingRule.coincidencias
    )
      ? matchedShippingRule.coincidencias
      : [];

    const matchText = matches.length
      ? matches
          .map(function (match) {
            return (
              `${escapeText(match.tipo_etiqueta)}: ` +
              `<strong>${escapeText(match.valor)}</strong>`
            );
          })
          .join(" + ")
      : (
        `${escapeText(
          matchedShippingRule.regla_tipo_etiqueta
        )}: ` +
        `<strong>${escapeText(
          matchedShippingRule.regla_valor
        )}</strong>`
      );

    status.className =
      "shipping-zone-status is-success";

    status.innerHTML = `
      <strong>${escapeText(
        matchedShippingRule.zona
      )}</strong>
      · Costo:
      <strong>${formatMoney(
        matchedShippingRule.costo
      )}</strong>
      <br>
      Coincidencias: ${matchText}
      <br>
      <strong>
        La colonia confirmó la zona final.
      </strong>
      <br>
      Entrega estimada de ${DELIVERY_TIME_TEXT},
      con recepción a partir de las 3:00 p. m.
    `;
  }

  /* =========================
     VALIDAR ANTES DE COMPRAR
  ========================= */

  function addCheckoutValidationCapture() {
    if (checkoutValidationInstalled) {
      return;
    }

    const checkoutButton =
      document.getElementById(
        "checkoutBtn"
      );

    if (!checkoutButton) return;

    checkoutValidationInstalled = true;

    checkoutButton.addEventListener(
      "click",
      function (event) {
        const deliveryMethod =
          document.getElementById(
            "deliveryMethod"
          )?.value ||
          "pickup";

        if (
          deliveryMethod !== "delivery"
        ) {
          return;
        }

        const address =
          window.getShippingAddressData();

        const errorMessage =
          getShippingValidationError(
            address
          );

        if (!errorMessage) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        alert(errorMessage);
      },
      true
    );
  }

  function getShippingValidationError(
    address
  ) {
    if (!address.nombre_completo) {
      return "Escribe el nombre completo de quien recibirá el pedido.";
    }

    if (!address.telefono) {
      return "Escribe un número de contacto.";
    }

    if (!isValidEmail(address.email)) {
      return "Escribe un correo electrónico válido.";
    }

    if (
      !/^\d{5}$/.test(
        address.codigo_postal
      )
    ) {
      return "Escribe un código postal de cinco dígitos.";
    }

    if (!address.colonia) {
      return "Escribe la colonia.";
    }

    if (!address.municipio) {
      return "Escribe la alcaldía o municipio.";
    }

    if (!address.estado) {
      return "Escribe el estado o entidad federativa.";
    }

    if (!address.pais) {
      return "Escribe el país.";
    }

    if (calculationInProgress) {
      return "Espera un momento mientras se calcula el costo de envío.";
    }

    if (!address.regla_envio_id) {
      return (
        lastShippingResolution?.message ||
        "No se encontró una tarifa para esta dirección. Contacta a la papelería."
      );
    }

    if (!address.calle) {
      return "Escribe la calle de la dirección de entrega.";
    }

    if (!address.numero_exterior) {
      return "Escribe el número exterior.";
    }

    if (!address.horario_recepcion) {
      return "Selecciona la hora en la que puedes recibir el pedido.";
    }

    if (
      !isReceiveTimeValid(
        address.horario_recepcion
      )
    ) {
      return "La hora de recepción debe ser a partir de las 3:00 p. m.";
    }

    return "";
  }

  /* =========================
     COMPLETAR EL PEDIDO
  ========================= */

  function installFetchInterceptor() {
    if (fetchInterceptorInstalled) {
      return;
    }

    fetchInterceptorInstalled = true;

    window.fetch = async function (
      input,
      init = {}
    ) {
      const url =
        typeof input === "string"
          ? input
          : input?.url ||
            "";

      const method = String(
        init.method ||
        "GET"
      ).toUpperCase();

      if (
        method === "POST" &&
        typeof init.body === "string"
      ) {
        if (
          url.includes("/api/pedidos")
        ) {
          init = {
            ...init,
            body: enhanceOrderBody(
              init.body,
              false
            ),
            credentials:
              init.credentials ||
              "include"
          };
        }

        if (
          url.includes(
            "/api/mercadopago/crear-preferencia"
          )
        ) {
          init = {
            ...init,
            body: enhanceOrderBody(
              init.body,
              true
            ),
            credentials:
              init.credentials ||
              "include"
          };
        }
      }

      return nativeFetch(input, init);
    };
  }

  function enhanceOrderBody(
    rawBody,
    isMercadoPago
  ) {
    try {
      const parsed =
        JSON.parse(rawBody);

      const order = isMercadoPago
        ? parsed.pedido
        : parsed;

      if (
        !order ||
        order.tipo_entrega !==
          "delivery"
      ) {
        return rawBody;
      }

      const address =
        window.getShippingAddressData();

      const totals =
        window.calculateCartAmounts(
          "delivery"
        );

      const enhancedOrder = {
        ...order,

        nombre_cliente:
          address.nombre_completo,

        email_cliente:
          address.email,

        telefono_cliente:
          address.telefono,

        direccion_envio:
          window.formatShippingAddress(
            address
          ),

        regla_envio_id:
          address.regla_envio_id,

        zona_envio_id:
          address.zona_id,

        zona_envio:
          address.zona,

        datos_envio:
          address,

        tiempo_entrega:
          DELIVERY_TIME_TEXT,

        envio:
          totals.envio,

        total:
          totals.total
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
      console.error(
        "No fue posible completar la información de envío:",
        error
      );

      return rawBody;
    }
  }

  /* =========================
     UTILIDADES
  ========================= */

  function getInputValue(id) {
    return (
      document.getElementById(id)
        ?.value
        ?.trim() ||
      ""
    );
  }

  function cleanPostalCode(value) {
    return String(value || "")
      .replace(/\D/g, "")
      .slice(0, 5);
  }

  function isReceiveTimeValid(value) {
    const match = String(value || "")
      .match(/^(\d{2}):(\d{2})$/);

    if (!match) return false;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return false;
    }

    return hour >= 15;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(
        String(value || "").trim()
      );
  }

  function formatTimeForDisplay(value) {
    const match = String(value || "")
      .match(/^(\d{2}):(\d{2})$/);

    if (!match) {
      return value || "";
    }

    const hour = Number(match[1]);
    const minute = match[2];
    const suffix =
      hour >= 12
        ? "p. m."
        : "a. m.";

    const displayHour =
      hour % 12 ||
      12;

    return (
      `${displayHour}:${minute} ` +
      suffix
    );
  }

  function escapeText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function readJsonSafely(
    response
  ) {
    const contentType =
      response.headers.get(
        "content-type"
      ) ||
      "";

    if (
      !contentType.includes(
        "application/json"
      )
    ) {
      return {};
    }

    return response.json();
  }
})();
