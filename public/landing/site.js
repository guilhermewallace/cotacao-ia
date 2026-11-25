(() => {
  "use strict";

  const E = window.CotacaoEngine;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TOUCH = window.matchMedia("(hover: none)").matches;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const dec = (value, max = 2) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: max }).format(value);
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  const svg = (path, size = 12, width = 2.4) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const ICON = {
    check: svg('<path d="M3.5 8.5l3 3 6-7"/>'),
    x: svg('<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>'),
    q: svg('<path d="M5.7 6.1a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.2 1-1.2 1.8"/><path d="M8 12.7v.1"/>'),
    neq: svg('<path d="M3.5 6h9M3.5 10h9M10.6 3.2L5.4 12.8"/>', 12, 2),
  };

  // Navegação: linha de separação só depois de rolar.
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (!E) {
    for (const id of ["rows", "result", "rev"]) {
      const target = document.getElementById(id);
      if (target) target.innerHTML = '<p class="read-note" style="padding:1rem">A demonstração interativa não pôde ser carregada.</p>';
    }
    return;
  }

  // ── Apoio comum ────────────────────────────────────────────────────────
  const unitShort = (unit) => (unit ? unit.toLowerCase() : "");

  /** Atributo em forma curta, para etiquetas: "3 polos", "curva C", "32 A". */
  function compact(attribute) {
    const value = attribute.value;
    switch (attribute.key) {
      case "polos":
        return `${value} ${value === "1" ? "polo" : "polos"}`;
      case "fases":
        return `${value} ${value === "1" ? "fase" : "fases"}`;
      case "condutores":
        return `${value} condutores`;
      case "curva":
        return `curva ${value}`;
      case "material":
        return value.length <= 4 ? value.toUpperCase() : value;
      default:
        return value;
    }
  }

  function readOne(text) {
    const clean = text.trim();
    if (!clean) return null;
    return E.readText(clean)[0] || E.readRow(clean, null, null);
  }

  function evaluate(item, flag = null) {
    const match = E.match(item);
    const status = match.outcome === "SUGGESTED" ? "ok" : match.outcome === "AMBIGUOUS" ? "warn" : "none";
    return { item, match, best: match.candidates[0] || null, status, flag };
  }

  const lineTotal = (item, candidate) => (item.quantity != null && candidate && candidate.price != null ? item.quantity * candidate.price : null);

  /** Divergências críticas de um candidato descartado: "corrente: pedido 32 A, produto 40 A". */
  function mismatchText(candidate) {
    return candidate.incompatibilities
      .filter((entry) => entry.verdict === "MISMATCH")
      .map((entry) => `${entry.label.toLowerCase()}: pedido ${entry.requested}, produto ${entry.product ?? "não informado"}`)
      .join("; ");
  }

  $("#n-products").textContent = E.info.products;
  $("#n-attrs").textContent = E.info.attributes;
  $("#n-critical").textContent = E.info.criticalAttributes;

  // "Como funciona": o mesmo item, do começo ao fim, calculado pelo motor.
  (() => {
    const journey = evaluate(readOne("12 disj tripolar 32a curva c"));
    const { item, best } = journey;
    if (!best || journey.status !== "ok") return;
    const attributes = E.describe(item.attributes).map(compact);
    $("#trace-read").textContent = [`${dec(item.quantity, 3)} ${unitShort(best.unit)}`, "disjuntor", ...attributes].join(" · ");
    $("#trace-match").textContent = `${best.sku} · aderência ${Math.round(best.score * 100)}%`;
    $("#trace-total").textContent = `${dec(item.quantity, 3)} × ${brl.format(best.price)} = ${brl.format(lineTotal(item, best))}`;
  })();

  // ── Hero: da lista à cotação ───────────────────────────────────────────
  (() => {
    const stage = $("#stage");
    const rows = $("#rows");
    const src = $("#src");
    const beam = $("#beam");
    const leader = $("#leader");
    const tabs = $$(".tab", stage);
    const SOURCE = { foto: "foto de caderno", chat: "mensagem de WhatsApp", pdf: "PDF anexado ao e-mail" };

    const views = {};
    for (const panel of $$(".src-view", stage)) {
      views[panel.dataset.view] = $$(".src-line", panel).map((el) => {
        const text = el.dataset.text;
        const item = el.dataset.qty ? E.readRow(text, Number(el.dataset.qty), el.dataset.unit) : readOne(text);
        return { el, ...evaluate(item, el.dataset.flag || null) };
      });
    }

    let current = "foto";
    let timers = [];
    let playing = false;
    let cycle = !reduced; // percorre as três origens uma vez, até a pessoa interagir
    const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
    const stop = () => {
      timers.forEach(window.clearTimeout);
      timers = [];
      playing = false;
    };

    function rowHtml(entry, index) {
      const { item, best, status, match, flag } = entry;
      const chips = E.describe(item.attributes)
        .slice(0, 4)
        .map((attribute) => `<span class="chip">${esc(compact(attribute))}</span>`)
        .join("");
      const flagChip = flag === "ilegivel" ? '<span class="chip warn">corrente ilegível</span>' : "";
      const unit = unitShort(item.unit || (status === "ok" && best ? best.unit : ""));
      const quantity = item.quantity != null ? `<b class="qty">${dec(item.quantity, 3)} <i>${esc(unit)}</i></b>` : '<b class="qty"><i>sem quantidade</i></b>';
      const total = lineTotal(item, best);
      let product;
      let side;
      if (status === "ok") {
        product = `<span class="prod-name">${esc(best.description)}</span><span class="prod-sku">${esc(best.sku)}</span>`;
        side = `<span class="pill ok">${ICON.check}Sugestão forte</span><span class="row-price">${total != null ? brl.format(total) : "sem preço"}</span>`;
      } else if (status === "warn") {
        product = `<span class="prod-name muted">${plural(match.candidates.length, "produto compatível", "produtos compatíveis")}: quem escolhe é o revisor</span>`;
        side = `<span class="pill warn">${ICON.q}Para conferir</span><span class="row-price none">a definir</span>`;
      } else {
        product = '<span class="prod-name muted">Nenhum produto compatível no catálogo</span>';
        side = `<span class="pill none">${ICON.x}Não encontrado</span><span class="row-price none">sem preço</span>`;
      }
      return `<li class="row" data-i="${index}" tabindex="0"><span class="row-n">${String(index + 1).padStart(2, "0")}</span><div class="row-main"><div class="row-req">${quantity}${chips}${flagChip}</div><div class="row-prod">${product}</div></div><div class="row-side">${side}</div></li>`;
    }

    function footer(count) {
      const shown = views[current].slice(0, count);
      const strong = shown.filter((entry) => entry.status === "ok");
      const doubt = shown.filter((entry) => entry.status === "warn").length;
      const none = shown.filter((entry) => entry.status === "none").length;
      const parts = [plural(strong.length, "sugestão forte", "sugestões fortes")];
      if (doubt) parts.push(`${doubt} para conferir`);
      if (none) parts.push(plural(none, "não encontrado", "não encontrados"));
      $("#out-sum").textContent = parts.join(" · ");
      $("#out-total").textContent = brl.format(strong.reduce((sum, entry) => sum + (lineTotal(entry.item, entry.best) || 0), 0));
    }

    function clearLink() {
      $$(".src-line.is-lit", stage).forEach((el) => el.classList.remove("is-lit"));
      $$(".row.is-active", rows).forEach((el) => el.classList.remove("is-active"));
      leader.innerHTML = "";
    }

    /** Liga a linha do documento ao item lido: marca-texto na origem e um traço até a linha da cotação. */
    function link(index, animate) {
      clearLink();
      const entry = views[current][index];
      const row = rows.children[index];
      if (!entry || !row) return;
      entry.el.classList.add("is-lit");
      row.classList.add("is-active");
      if (window.getComputedStyle(leader).display === "none") return;
      const host = leader.getBoundingClientRect();
      const from = entry.el.getBoundingClientRect();
      const to = row.getBoundingClientRect();
      const edge = src.getBoundingClientRect().right;
      const x1 = Math.min(from.right + 8, edge - 10) - host.left;
      const y1 = from.top + from.height / 2 - host.top;
      const x2 = to.left - host.left - 1;
      const y2 = to.top + to.height / 2 - host.top;
      const bend = Math.max(28, (x2 - x1) * 0.55);
      const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + bend).toFixed(1)} ${y1.toFixed(1)} ${(x2 - bend).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      leader.innerHTML = `<path d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${animate ? 1 : 0}"/><rect x="${(x1 - 3).toFixed(1)}" y="${(y1 - 3).toFixed(1)}" width="6" height="6" rx="1"/><rect x="${(x2 - 3).toFixed(1)}" y="${(y2 - 3).toFixed(1)}" width="6" height="6" rx="1"/>`;
      if (animate) {
        const path = leader.firstElementChild;
        path.style.transition = "stroke-dashoffset .32s ease-out";
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => (path.style.strokeDashoffset = "0")));
      }
    }

    function moveBeam(index) {
      const entry = views[current][index];
      const box = src.getBoundingClientRect();
      const line = entry.el.getBoundingClientRect();
      beam.style.setProperty("--y", `${(line.top + line.height / 2 - box.top).toFixed(1)}px`);
    }

    function show(view, animate) {
      stop();
      current = view;
      tabs.forEach((tab) => {
        const selected = tab.dataset.tab === view;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      $$(".src-view", stage).forEach((panel) => (panel.hidden = panel.dataset.view !== view));
      $("#out-source").textContent = SOURCE[view];
      const entries = views[view];
      rows.innerHTML = entries.map(rowHtml).join("");
      clearLink();
      beam.classList.remove("is-on");

      if (!animate) {
        footer(entries.length);
        link(0, false);
        return;
      }

      playing = true;
      [...rows.children].forEach((row) => row.classList.add("is-pending"));
      footer(0);
      beam.style.transition = "none";
      beam.style.setProperty("--y", "0px");
      void beam.offsetWidth;
      beam.style.transition = "";
      beam.classList.add("is-on");
      const pace = 640;
      entries.forEach((_, index) => {
        later(() => {
          moveBeam(index);
          const row = rows.children[index];
          row.classList.remove("is-pending");
          row.classList.add("is-in");
          link(index, true);
          footer(index + 1);
        }, 420 + index * pace);
      });
      later(() => {
        beam.classList.remove("is-on");
        playing = false;
        link(0, false);
        if (cycle) {
          const next = { foto: "chat", chat: "pdf", pdf: null }[view];
          if (next) later(() => show(next, true), 3400);
          else cycle = false;
        }
      }, 420 + entries.length * pace + 900);
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        cycle = false;
        show(tab.dataset.tab, !reduced);
      });
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      });
    });
    $("#replay").addEventListener("click", () => {
      cycle = false;
      show(current, !reduced);
    });

    const hover = (event) => {
      const row = event.target.closest(".row");
      if (!row || playing) return;
      cycle = false;
      stop();
      link(Number(row.dataset.i), false);
    };
    rows.addEventListener("pointerover", hover);
    rows.addEventListener("focusin", hover);
    const rest = () => !playing && link(0, false);
    rows.addEventListener("pointerleave", rest);
    rows.addEventListener("focusout", rest);
    window.addEventListener("resize", rest);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rest);

    show("foto", false);
    if (!reduced && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          later(() => show("foto", true), 900);
        },
        { threshold: 0.3 },
      );
      observer.observe(stage);
    }
  })();

  // ── Bancada: um item, do jeito que o cliente escreve ───────────────────
  (() => {
    const form = $("#bench-form");
    const input = $("#bench-input");
    const result = $("#result");
    const tries = $$(".try");

    function reasonItem(text) {
      const kind = /^(Incompatível|Atenção)/.test(text) ? "x" : /^(Diferença|Não informado|Unidade diferente|Tipo de produto)/.test(text) ? "q" : "";
      return `<li class="${kind}">${kind === "x" ? ICON.x : kind === "q" ? ICON.q : ICON.check}<span>${esc(text)}</span></li>`;
    }

    function render(text) {
      const item = readOne(text);
      tries.forEach((button) => button.setAttribute("aria-pressed", String(button.textContent.trim() === text.trim())));
      if (!item) {
        result.innerHTML = '<div class="res-block"><span class="label">O que o sistema leu</span><p class="read-note">Digite um item, como "12 disj tripolar 32a curva c".</p></div>';
        return;
      }
      const { match, best, status } = evaluate(item);
      const attributes = E.describe(item.attributes);

      if (status === "none" && match.rejected.length === 0 && attributes.length === 0) {
        result.innerHTML = `<div class="res-block"><div class="res-top"><span class="label">O que o sistema leu</span><span class="pill none">${ICON.x}Não encontrado</span></div><p class="read-note">Não achei nada parecido com “${esc(text.trim())}” no catálogo de demonstração. No produto, o item iria para o revisor como não encontrado — nada é inventado para preencher a lacuna.</p></div>`;
        return;
      }

      const unit = unitShort(item.unit || (best ? best.unit : ""));
      const quantity = item.quantity != null ? `<span class="read-qty">${dec(item.quantity, 3)}<small>${esc(unit)}</small></span>` : '<span class="read-qty is-null">quantidade não informada</span>';
      const chips = attributes.length
        ? attributes.map((attribute) => `<span class="chip${attribute.critical ? "" : " soft"}"><b>${esc(attribute.label)}</b>${esc(attribute.value)}</span>`).join("")
        : '<span class="chip soft">nenhum atributo técnico no texto</span>';
      let html = `<div class="res-block"><div class="res-top"><span class="label">O que o sistema leu</span></div><div class="read-line">${quantity}<span class="read-norm">${esc(item.normalizedDescription)}</span></div><div class="read-chips">${chips}</div></div>`;

      if (status === "ok") {
        const total = lineTotal(item, best);
        const price = best.price != null ? `${brl.format(best.price)}<small>por ${esc(unitShort(best.unit))}${total != null ? ` · total ${brl.format(total)}` : ""}</small>` : "sem preço<small>preenchido pelo vendedor</small>";
        html += `<div class="res-block"><div class="res-top"><span class="label">Produto sugerido</span><span class="pill ok">${ICON.check}Sugestão forte</span></div><div class="cand"><div><p class="cand-name">${esc(best.description)}</p><p class="cand-meta">${esc(best.sku)} · ${esc(best.manufacturer || "")} · ${esc(best.manufacturerCode)}</p></div><p class="cand-price">${price}</p></div><div class="meter">aderência<i style="--v:${Math.round(best.score * 100)}%"></i><b>${Math.round(best.score * 100)}%</b></div><ul class="why">${best.reasons.map(reasonItem).join("")}</ul></div>`;
      } else if (status === "warn") {
        const list = match.candidates
          .slice(0, 4)
          .map((candidate) => `<div class="alt"><span>${esc(candidate.description)}</span><span class="mono">${esc(candidate.sku)}</span><span class="mono">${Math.round(candidate.score * 100)}%${candidate.price != null ? ` · ${brl.format(candidate.price)}` : ""}</span></div>`)
          .join("");
        html += `<div class="res-block"><div class="res-top"><span class="label">Produtos compatíveis</span><span class="pill warn">${ICON.q}Para conferir</span></div><p class="read-note">Mais de um produto atende ao que foi escrito. O sistema não escolhe por conta própria: a decisão fica com o revisor.</p><div class="alts">${list}</div></div>`;
      } else {
        html += `<div class="res-block"><div class="res-top"><span class="label">Resultado</span><span class="pill none">${ICON.x}Não encontrado</span></div><p class="read-note">Nenhum produto do catálogo de demonstração atende a esse pedido. No produto, o item vai para o revisor como não encontrado, sem troca por um parecido.</p></div>`;
      }

      if (match.rejected.length > 0) {
        const rejected = match.rejected
          .map((candidate) => `<li class="x">${ICON.x}<span><b>${esc(candidate.description)}</b> — ${esc(mismatchText(candidate))}</span></li>`)
          .join("");
        html += `<div class="res-block res-rej"><div class="res-top"><span class="label">Parecidos no texto, descartados na técnica</span></div><ul class="why">${rejected}</ul></div>`;
      }
      result.innerHTML = html;
    }

    let debounce = 0;
    input.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => render(input.value), 140);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      window.clearTimeout(debounce);
      render(input.value);
    });
    tries.forEach((button) =>
      button.addEventListener("click", () => {
        input.value = button.textContent.trim();
        render(input.value);
      }),
    );
    render(input.value);
  })();

  // ── Trilho: 32 A não é 40 A ────────────────────────────────────────────
  (() => {
    const dial = $("#dial");
    const trilho = $("#trilho");
    const CURRENTS = [16, 25, 32, 40, 63];
    const ANGLES = [-64, -32, 0, 32, 64];
    const SKUS = ["DJ-1P-016-B", "DJ-1P-016-C", "DJ-2P-032-C", "DJ-3P-025-C", "DJ-3P-032-C", "DJ-3P-040-C", "DJ-3P-063-C"];
    const POLE_WORD = { 1: "monopolar", 2: "bipolar", 3: "tripolar" };
    /** O valor do produto que diverge do pedido, em forma curta: "40 A", "2P", "B". */
    const differs = (entry) => (entry.key === "polos" ? `${entry.product}P` : entry.product ?? "?");

    dial.insertAdjacentHTML(
      "beforeend",
      CURRENTS.map((value, index) => {
        const angle = (ANGLES[index] * Math.PI) / 180;
        return `<input type="radio" name="corrente" id="corrente-${value}" value="${value}"${value === 32 ? " checked" : ""}><label for="corrente-${value}" style="--x:${(Math.sin(angle) * 72).toFixed(1)};--y:${(-Math.cos(angle) * 72).toFixed(1)}">${value}<span class="sr"> ampères</span></label>`;
      }).join(""),
    );

    const breakers = SKUS.map((sku) => {
      const product = E.product(sku);
      const get = (key) => product.attributes.find((attribute) => attribute.key === key)?.value ?? "";
      const poles = Number(get("polos"));
      const rate = `${get("curva")}${get("corrente_a").replace(/\s?A$/, "")}`;
      const el = document.createElement("div");
      el.className = "brk";
      el.style.setProperty("--p", String(poles));
      const screws = "<i></i>".repeat(poles);
      el.innerHTML = `<div class="brk-body" role="img" aria-label="${esc(product.description)}"><span class="brk-screws t">${screws}</span><span class="brk-win"><span class="brk-lever"></span></span><span class="brk-plate"><b>${esc(rate)}</b><small>${poles}P</small></span><span class="brk-screws b">${screws}</span></div><div class="brk-tag"></div>`;
      trilho.append(el);
      return { sku, product, el, tag: $(".brk-tag", el) };
    });

    const checked = (name) => $(`input[name="${name}"]:checked`).value;

    function render(smooth) {
      const current = Number(checked("corrente"));
      const poles = Number(checked("polos"));
      const curve = checked("curva");
      $(".dial-face", dial).style.setProperty("--a", `${ANGLES[CURRENTS.indexOf(current)]}deg`);
      $("#pedido-text").innerHTML = `Lido como <q>disjuntor ${POLE_WORD[poles]} ${current} A curva ${curve}</q>`;

      const item = E.readRow(`disjuntor ${poles}p ${current}a curva ${curve.toLowerCase()}`, null, null);
      let fit = 0;
      let closest = 0;
      for (const breaker of breakers) {
        const scored = E.scoreAgainst(item, breaker.sku);
        const mismatches = scored.incompatibilities.filter((entry) => entry.verdict === "MISMATCH");
        const ok = mismatches.length === 0;
        const similar = Math.round(scored.signals.lexical * 100);
        breaker.el.classList.toggle("is-ok", ok);
        breaker.el.classList.toggle("is-off", !ok);
        if (ok) {
          fit += 1;
          breaker.tag.innerHTML = `<span class="sr">Serve. Semelhança do texto: ${similar}%.</span><div class="brk-tag-v" aria-hidden="true"><b>${ICON.check}</b><span>serve</span><i>${similar}%</i></div>`;
        } else {
          closest = Math.max(closest, similar);
          breaker.tag.innerHTML = `<span class="sr">Descartado: ${mismatches.map((entry) => `${esc(entry.label.toLowerCase())} ${esc(entry.product)}`).join(", ")}. Semelhança do texto: ${similar}%.</span><div class="brk-tag-v" aria-hidden="true"><b>${ICON.neq}</b>${mismatches.map((entry) => `<span>${esc(differs(entry))}</span>`).join("")}<i>${similar}%</i></div>`;
        }
      }
      $("#veredito").innerHTML = fit
        ? `<b>${fit === 1 ? "Só 1 dos 7 serve." : `${fit} dos 7 servem.`}</b> Os outros chegam a ${closest}% de semelhança no texto e, mesmo assim, ficam fora da sugestão — cada um com o seu motivo.`
        : `<b>Nenhum destes 7 serve.</b> O mais parecido chega a ${closest}% de semelhança no texto. No produto, o item segue para o revisor como “não encontrado”, sem troca por um parecido.`;
      reveal(smooth);
    }

    const scroller = trilho.parentElement;
    function reveal(smooth) {
      const clipped = scroller.scrollWidth > scroller.clientWidth + 1;
      scroller.classList.toggle("is-clipped", clipped);
      if (clipped) scroller.tabIndex = 0;
      else scroller.removeAttribute("tabindex");
      const hit = $(".brk.is-ok", trilho);
      if (!hit || !clipped) return;
      const box = scroller.getBoundingClientRect();
      const target = hit.getBoundingClientRect();
      const delta = target.left + target.width / 2 - (box.left + box.width / 2);
      scroller.scrollBy({ left: delta, behavior: smooth && !reduced ? "smooth" : "auto" });
    }

    $("#bancada").addEventListener("change", () => render(true));
    window.addEventListener("resize", () => reveal(false), { passive: true });

    // Girar o seletor com o ponteiro: o ângulo escolhe a posição mais próxima.
    const face = $(".dial-face", dial);
    let dragging = false;
    const pick = (event) => {
      const box = face.getBoundingClientRect();
      const angle = (Math.atan2(event.clientX - (box.left + box.width / 2), -(event.clientY - (box.top + box.height / 2))) * 180) / Math.PI;
      let nearest = 0;
      ANGLES.forEach((value, index) => {
        if (Math.abs(value - angle) < Math.abs(ANGLES[nearest] - angle)) nearest = index;
      });
      const radio = $(`#corrente-${CURRENTS[nearest]}`);
      if (!radio.checked) {
        radio.checked = true;
        render(true);
      }
    };
    face.addEventListener("pointerdown", (event) => {
      dragging = true;
      face.setPointerCapture(event.pointerId);
      face.style.cursor = "grabbing";
    });
    face.addEventListener("pointermove", (event) => dragging && pick(event));
    const release = () => {
      dragging = false;
      face.style.cursor = "";
    };
    face.addEventListener("pointerup", release);
    face.addEventListener("pointercancel", release);

    render();
  })();

  // ── Revisão por teclado e cotação ──────────────────────────────────────
  (() => {
    const rev = $("#rev");
    const REQUEST = ["12 disjuntor tripolar 32A curva C (ref ZTK-M3C32)", "6 contator 18A bobina 220V", "150m cabo PP 3x2,5", "30 lâmpada led 9w", "2 válvula solenoide 1/2 24Vcc"];
    const base = REQUEST.map((text) => ({ text, ...evaluate(readOne(text)) }));
    let items;
    let active;
    let view;

    function reset() {
      items = base.map((entry) => ({ ...entry, state: "pending", chosen: null }));
      active = 0;
      view = "review";
    }

    const pending = () => items.filter((entry) => entry.state === "pending").length;
    const whyShort = (candidate) => candidate.reasons.filter((reason) => !/^Descrição:/.test(reason)).slice(0, 2).join(" ");

    function itemHtml(entry, index) {
      const { item, match, state, chosen, status } = entry;
      const isActive = index === active && state === "pending";
      const number = `<span class="it-n">${String(index + 1).padStart(2, "0")}</span>`;
      let sub;
      let side;
      if (state === "accepted") {
        const total = lineTotal(item, chosen);
        sub = esc(chosen.description);
        side = `<span class="pill ok">${ICON.check}Aceito</span> <span class="opt-price">${total != null ? brl.format(total) : "sem preço"}</span>`;
      } else if (state === "notfound") {
        sub = "Fora da cotação. O cliente é avisado de que o item não foi encontrado.";
        side = `<span class="pill none">${ICON.x}Não encontrado</span>`;
      } else if (status === "ok") {
        sub = esc(match.candidates[0].description);
        side = `<span class="pill ok">${ICON.check}Sugestão forte</span>`;
      } else if (status === "warn") {
        sub = `${plural(match.candidates.length, "produto compatível", "produtos compatíveis")}: escolha um`;
        side = `<span class="pill warn">${ICON.q}Para conferir</span>`;
      } else {
        sub = "Nenhum produto compatível no catálogo";
        side = `<span class="pill none">${ICON.x}Sem correspondência</span>`;
      }
      const head = `<button class="it-top" type="button" data-act="focus" data-i="${index}" aria-expanded="${isActive}">${number}<span class="it-req">${esc(entry.text)}<span class="it-sub">${sub}</span></span><span>${side}</span></button>`;

      let body = "";
      if (isActive) {
        const options = match.candidates
          .slice(0, 3)
          .map((candidate, option) => {
            const total = lineTotal(item, candidate);
            return `<div class="opt"><span class="opt-name">${esc(candidate.description)}<span class="opt-why">${esc(whyShort(candidate))}</span></span><span class="opt-price">${total != null ? brl.format(total) : candidate.price != null ? brl.format(candidate.price) : "sem preço"}</span><button class="btn btn-sm ${option === 0 ? "btn-primary" : "btn-ghost"}" type="button" data-act="accept" data-i="${index}" data-o="${option}">${option === 0 ? "Aceitar <kbd>A</kbd>" : "Escolher"}</button></div>`;
          })
          .join("");
        const closest = match.candidates.length === 0 && match.rejected[0] ? `<p class="read-note">O mais próximo foi descartado: ${esc(match.rejected[0].description)} (${esc(mismatchText(match.rejected[0]))}).</p>` : "";
        const none = match.candidates.length === 0 && !match.rejected[0] ? '<p class="read-note">Nada parecido no catálogo. O sistema não sugere um substituto por conta própria.</p>' : "";
        body = `<div class="it-body">${options}${closest}${none}<div class="it-actions"><button class="btn btn-sm btn-ghost" type="button" data-act="notfound" data-i="${index}">Não encontrado <kbd>N</kbd></button></div></div>`;
      } else if (state !== "pending") {
        body = `<div class="it-body" style="padding-top:0;padding-bottom:.55rem"><button class="it-undo" type="button" data-act="undo" data-i="${index}">desfazer</button></div>`;
      }
      return `<li class="it${isActive ? " is-active" : ""}${state !== "pending" ? " is-done" : ""}">${head}${body}</li>`;
    }

    function quoteHtml() {
      const accepted = items.filter((entry) => entry.state === "accepted");
      const missing = items.filter((entry) => entry.state === "notfound");
      const total = accepted.reduce((sum, entry) => sum + (lineTotal(entry.item, entry.chosen) || 0), 0);
      const today = new Date();
      const until = new Date(today.getTime() + 7 * 864e5);
      const date = (value) => value.toLocaleDateString("pt-BR");
      const lines = accepted
        .map((entry, index) => {
          const { item, chosen } = entry;
          const lineValue = lineTotal(item, chosen);
          return `<tr role="row"><td role="cell">${index + 1}</td><td role="cell">${esc(chosen.description)}<small>${esc(chosen.sku)} · pedido: ${esc(entry.text)}</small></td><td role="cell" class="r">${item.quantity != null ? dec(item.quantity, 3) : "—"} ${esc(unitShort(chosen.unit))}</td><td role="cell" class="r">${chosen.price != null ? brl.format(chosen.price) : "—"}</td><td role="cell" class="r">${lineValue != null ? brl.format(lineValue) : "—"}</td></tr>`;
        })
        .join("");
      const body = accepted.length ? lines : '<tr role="row"><td role="cell" colspan="5">Nenhum item aceito. Volte à revisão para escolher os produtos.</td></tr>';
      const note = missing.length ? `${plural(missing.length, "item não encontrado ficou", "itens não encontrados ficaram")} de fora: ${missing.map((entry) => `“${esc(entry.text)}”`).join(", ")}.` : "Todos os itens da solicitação entraram na cotação.";
      return `<div class="quote"><div class="quote-paper"><div class="quote-top"><p class="quote-co">Elétrica Central<small>EMPRESA FICTÍCIA · DEMONSTRAÇÃO</small></p><p class="quote-no">COT-${today.getFullYear()}-00042<small>emitida em ${date(today)} · válida até ${date(until)}</small></p></div><div class="quote-scroll"><table role="table" aria-label="Itens da cotação"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">#</th><th role="columnheader" scope="col">Produto</th><th role="columnheader" scope="col" class="r">Qtd.</th><th role="columnheader" scope="col" class="r">Unitário</th><th role="columnheader" scope="col" class="r">Total</th></tr></thead><tbody role="rowgroup">${body}</tbody></table></div><p class="quote-note">${note} Preços do catálogo de demonstração; no produto, o vendedor ainda pode ajustar quantidades, descontos e validade.</p><div class="quote-sum"><span class="quote-stamp" aria-hidden="true">Revisada</span><p class="quote-total"><span>Total</span><b>${brl.format(total)}</b></p></div></div><div class="quote-bar"><span class="formats"><span class="label">Exporta em</span><span class="chip">PDF</span><span class="chip">Excel</span><span class="chip">CSV</span></span><span><button class="btn btn-sm btn-ghost" type="button" data-act="back">Voltar à revisão</button> <button class="btn btn-sm btn-ghost" type="button" data-act="reset">Recomeçar</button></span></div></div>`;
    }

    function render(keepFocus) {
      const done = items.length - pending();
      const head = `<header class="rev-head"><div><p class="label">Solicitação recebida por WhatsApp</p><p class="rev-title">Preço para hoje · Marina, Construtora Horizonte Azul (fictícia)</p></div><div class="rev-prog"><span>${done} de ${items.length} revisados</span><span class="bar"><i style="--v:${(done / items.length) * 100}%"></i></span></div></header>`;
      if (view === "quote") {
        rev.innerHTML = head + quoteHtml();
      } else {
        const strong = items.some((entry) => entry.state === "pending" && entry.status === "ok");
        const hint = pending() ? (TOUCH ? "Toque num item para revisar." : "Clique num item ou use o teclado.") : "Tudo revisado. Agora é só gerar.";
        rev.innerHTML = `${head}<ol class="rev-list">${items.map(itemHtml).join("")}</ol><footer class="rev-foot"><span class="hint">${hint}</span><button class="btn btn-sm btn-ghost" type="button" data-act="bulk"${strong ? "" : " disabled"}>Aceitar sugestões fortes</button><button class="btn btn-sm btn-primary" type="button" data-act="make"${pending() ? " disabled" : ""}>Gerar cotação</button></footer>`;
      }
      if (keepFocus) rev.focus({ preventScroll: true });
    }

    function advance() {
      const order = [...items.keys()].slice(active + 1).concat([...items.keys()].slice(0, active + 1));
      const next = order.find((index) => items[index].state === "pending");
      if (next !== undefined) active = next;
    }

    function act(action, index, option = 0) {
      const entry = index !== undefined ? items[index] : null;
      if (action === "focus") active = index;
      if (action === "accept" && entry && entry.state === "pending" && entry.match.candidates[option]) {
        entry.state = "accepted";
        entry.chosen = entry.match.candidates[option];
        active = index;
        advance();
      }
      if (action === "notfound" && entry && entry.state === "pending") {
        entry.state = "notfound";
        active = index;
        advance();
      }
      if (action === "undo" && entry) {
        entry.state = "pending";
        entry.chosen = null;
        active = index;
      }
      if (action === "bulk") {
        for (const item of items) {
          if (item.state === "pending" && item.status === "ok") {
            item.state = "accepted";
            item.chosen = item.match.candidates[0];
          }
        }
        active = -1;
        advance();
      }
      if (action === "make" && pending() === 0) view = "quote";
      if (action === "back") view = "review";
      if (action === "reset") reset();
      render(true);
    }

    rev.addEventListener("click", (event) => {
      const target = event.target.closest("[data-act]");
      if (!target || target.disabled) return;
      act(target.dataset.act, target.dataset.i !== undefined ? Number(target.dataset.i) : undefined, Number(target.dataset.o || 0));
    });
    rev.addEventListener("keydown", (event) => {
      if (view !== "review" || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!["j", "k", "a", "n"].includes(key)) return;
      event.preventDefault();
      if (key === "j") active = Math.min(items.length - 1, active + 1);
      if (key === "k") active = Math.max(0, active - 1);
      if (key === "j" || key === "k") return render(true);
      act(key === "a" ? "accept" : "notfound", active);
    });

    reset();
    render(false);
  })();

  // ── Calculadora de tempo ───────────────────────────────────────────────
  (() => {
    const fields = { cot: $("#k-cot"), itens: $("#k-itens"), hoje: $("#k-hoje"), rev: $("#k-rev") };
    const hours = (value) => `${dec(value, value < 10 ? 1 : 0)} h`;

    function update() {
      const value = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, Number(input.value)]));
      for (const input of Object.values(fields)) {
        input.style.setProperty("--f", `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
      }
      $("#o-cot").textContent = value.cot;
      $("#o-itens").textContent = value.itens;
      $("#o-hoje").textContent = `${value.hoje} s`;
      $("#o-rev").textContent = `${value.rev} s`;
      const monthly = (seconds) => (value.cot * value.itens * seconds * 22) / 3600;
      const today = monthly(value.hoje);
      const review = monthly(value.rev);
      const top = Math.max(today, review, 0.001);
      const set = (id, amount) => {
        const el = $(id);
        el.textContent = hours(amount);
        el.style.setProperty("--w", `${(amount / top) * 100}%`);
      };
      set("#t-hoje", today);
      set("#t-rev", review);
      $("#t-dif").textContent = dec(Math.max(0, today - review), 0);
    }
    Object.values(fields).forEach((input) => input.addEventListener("input", update));
    update();
  })();
})();
