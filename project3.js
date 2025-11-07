import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

/* ==========================
   Helpers & text snippets
   ========================== */

const BUDGET_BANDS = [25, 40, 60, 80, 120, 200, 0]; // 0 = "∞"
function bandFor(price){
  const p = +price || 0;
  for (const t of BUDGET_BANDS) if (t && p <= t) return t;
  return 0;
}
const money = v => `$${(+v).toFixed(0)}`;

const SKIN_TIPS = {
  Dry: "Look for hyaluronic acid or glycerin — they pull water into the skin. Ceramides help seal moisture so skin doesn’t feel tight.",
  Oily: "Salicylic acid can clear pores and reduce shine. Niacinamide helps with oil balance; lighter gel textures avoid heaviness.",
  Combination: "Aim for light hydration (hyaluronic acid) without heavy creams. If T-zone is shiny, a touch of salicylic acid helps.",
  Sensitive: "Keep it simple and fragrance-free. Centella, aloe, or oat can feel calming; avoid strong exfoliants unless you already tolerate them.",
  Normal: "Pick by goal: brightening (vitamin C), smoothing (gentle acids), or hydration (HA/glycerin). Gentle formulas keep the barrier happy."
};

function budgetNote(band){
  if (band === 0) return "Higher prices often bundle multiple actives or luxe textures. Results can be similar — check rating, not just price.";
  if (band <= 40) return "You can get gentle, well-rated options without going luxury in this price range.";
  if (band <= 80) return "Mid-range often adds brighteners or pore helpers without luxury pricing.";
  return "This tier usually adds more actives/polish. Consider whether ratings justify the spend.";
}

/* ===== Annotation panel ===== */
function ensurePanel(){
  const panel = d3.select("#annotations");
  if (!panel.empty()) return panel;
  throw new Error("Missing <aside id='annotations'> in HTML.");
}
function comparisonLine(filtered){
  if (!filtered || filtered.length < 2) return "";
  const sorted = [...filtered].sort((a,b) => d3.descending(a.rank,b.rank) || d3.ascending(a.price,b.price));
  const a = sorted[0];
  const b = sorted.find(x => x !== a && Math.abs((x.rank||0)-(a.rank||0)) <= 0.1) || sorted[1];
  if (!a || !b) return "";
  const left  = a.price <= b.price ? a : b;
  const right = a.price <= b.price ? b : a;
  return `Both **${a.brand}** and **${b.brand}** are highly rated (≈ ${a.rank.toFixed(2)}), but ${left.brand} is the more budget-friendly pick (${money(left.price)} vs ${money(right.price)}).`;
}

/* ===== Data loading: CSV + JSON ===== */
Promise.all([
  d3.csv("data/cosmetic_p.csv"),
  d3.json("data/best_brand_for_skin_types.json"),
  d3.json("data/best_products_for_brand.json")
]).then(([raw, bestBrandBySkinJSON, bestProductsByBrandJSON]) => {

  const data = raw.map(d => ({
    ...d,
    price: +d.price || 0,
    rank: +d.rank || 0,
    Combination: +d.Combination || 0,
    Dry: +d.Dry || 0,
    Normal: +d.Normal || 0,
    Oily: +d.Oily || 0,
    Sensitive: +d.Sensitive || 0
  }));

  // JSON helpers (array- or object-shaped)
  function findBestBrandForSkin({skin, category}) {
    const j = bestBrandBySkinJSON;
    if (Array.isArray(j)) {
      const row = j.find(r =>
        (r.skin === skin || r.skin_type === skin) &&
        (r.category === category || r.Label === category)
      );
      return row ? (row.brand || row.Brand) : null;
    }
    if (j && typeof j === "object") {
      const skinNode = j[skin] || j[skin?.toLowerCase()] || j[skin?.toUpperCase()];
      if (skinNode && typeof skinNode === "object") {
        return skinNode[category] || skinNode[category?.toLowerCase()] || skinNode[category?.toUpperCase()] || null;
      }
    }
    return null;
  }
  function findBestProductForBrand(brand) {
    const j = bestProductsByBrandJSON;
    if (Array.isArray(j)) {
      const rows = j.filter(r => (r.brand || r.Brand) === brand);
      const top = rows.sort((a,b) => (+b.rank || +b.rating || 0) - (+a.rank || +a.rating || 0))[0];
      if (!top) return null;
      return {
        name: top.name || top.product || "",
        rating: +top.rank || +top.rating || null,
        category: top.Label || top.category || null,
        price: +top.price || null
      };
    }
    if (j && typeof j === "object") {
      const node = j[brand];
      if (!node) return null;
      if (Array.isArray(node)) {
        const top = node.sort((a,b) => (+b.rank || +b.rating || 0) - (+a.rank || +a.rating || 0))[0];
        if (!top) return null;
        return {
          name: top.name || top.product || "",
          rating: +top.rank || +top.rating || null,
          category: top.Label || top.category || null,
          price: +top.price || null
        };
      }
      return {
        name: node.name || node.product || "",
        rating: +node.rank || +node.rating || null,
        category: node.Label || node.category || null,
        price: +node.price || null
      };
    }
    return null;
  }

  /* ==========================
     Bubble chart (PIC-2 styling)
     ========================== */
  const width = 1100, height = 750;
  const svg = d3.select("#brand-bubble-chart")
    .attr("width", width)
    .attr("height", height);

  const bubbleLayer = svg.append("g").attr("class","bubble-layer");
  const labelLayer  = svg.append("g").attr("class","label-layer");
  const axisG       = svg.append("g").attr("class","x-axis");

  // axis label + arrow marker
  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id","arrow")
    .attr("viewBox","0 0 10 10")
    .attr("refX", 8).attr("refY",5)
    .attr("markerWidth",6).attr("markerHeight",6)
    .attr("orient","auto-start-reverse")
    .append("path").attr("d","M 0 0 L 10 5 L 0 10 z").attr("fill","#333");

  if (d3.select("#tooltip").empty()) d3.select("body").append("div").attr("id","tooltip");

  const categories = Array.from(new Set(data.map(d => d.Label))).sort();
  const skinTypes  = ["Combination","Dry","Normal","Oily","Sensitive"];
  const maxPGlobal = d3.max(data, d => d.price);

  d3.select("#controls").html(`
    <label>Category:</label>
    <select id="categorySelect">
      <option value="All">All</option>
      ${categories.map(c => `<option value="${c}">${c}</option>`).join("")}
    </select>
    <label>Skin Type:</label>
    <select id="skinSelect">
      <option value="All">All</option>
      ${skinTypes.map(s => `<option value="${s}">${s}</option>`).join("")}
    </select>
    <label>Max Price:</label>
    <input id="priceSlider" type="range" min="0" max="${maxPGlobal}" step="1" value="${maxPGlobal}">
    <span id="priceLabel">${money(maxPGlobal)}</span>
    <button id="resetBtn">Reset Filters</button>
  `);

  const size = d3.scaleSqrt()
    .domain(d3.extent(data, d => d.price))
    .range([10, 60]);

  // Legend (unchanged)
  const legendWidth = 200, legendHeight = 10;
  const legendGradient = defs.append("linearGradient").attr("id","legend-gradient").attr("x1","0%").attr("x2","100%");
  const legendGroup = svg.append("g").attr("class","legend-group")
    .attr("transform", `translate(${(width - legendWidth)/2}, ${height - 20})`);
  legendGroup.append("rect").attr("width",legendWidth).attr("height",legendHeight).style("fill","url(#legend-gradient)");
  legendGroup.append("text").attr("x",legendWidth/2).attr("y",-10).attr("font-size","12px").attr("text-anchor","middle").text("Rating (relative)");

  const axisY = height - 80;

  /* ===== Annotations (unchanged) ===== */
  function updateAnnotations({category, skin, maxPrice, filtered}){
    const panel = ensurePanel();
    const head = d3.select("#anno-head");
    const tip  = d3.select("#anno-tip");
    const budg = d3.select("#anno-budget");
    const comp = d3.select("#anno-compare");

    if (skin === "All" || category === "All" || !filtered || filtered.length === 0) {
      panel.attr("hidden", true);
      head.text(""); tip.text(""); budg.text(""); comp.html("");
      return;
    }

    const band = bandFor(maxPrice);
    head.text(`Tips for ${skin} skin — ${category}s under ${band ? money(band) : "no price limit"}`);
    tip.text(SKIN_TIPS[skin] || "");
    budg.text(budgetNote(band));

    const line = comparisonLine(filtered);

    const bestBrand = findBestBrandForSkin({skin, category});
    let jsonLine = "";
    if (bestBrand) {
      const bestProd = findBestProductForBrand(bestBrand);
      if (bestProd) {
        const pricePart  = Number.isFinite(bestProd.price)  ? ` for about ${money(bestProd.price)}` : "";
        const ratingPart = Number.isFinite(bestProd.rating) ? ` (⭐ ${bestProd.rating.toFixed(2)})` : "";
        jsonLine = `For ${skin.toLowerCase()} skin in ${category.toLowerCase()}, <strong>${bestBrand}</strong>’s top pick is <strong>${bestProd.name}</strong>${pricePart}${ratingPart}.`;
      } else {
        jsonLine = `For ${skin.toLowerCase()} skin in ${category.toLowerCase()}, <strong>${bestBrand}</strong> is a frequent top brand in our summary.`;
      }
    }

    comp.html([line, jsonLine].filter(Boolean).join("<br>"));
    panel.attr("hidden", null);
  }

  function updateChart(){
    const category = d3.select("#categorySelect").property("value");
    const skin = d3.select("#skinSelect").property("value");
    const maxPrice = +d3.select("#priceSlider").property("value");
    d3.select("#priceLabel").text(money(maxPrice));

    let filtered = data.filter(d =>
      (category === "All" || d.Label === category) &&
      (skin === "All" || d[skin] === 1) &&
      d.price <= maxPrice
    );

    filtered = filtered.sort((a,b)=>d3.descending(a.rank,b.rank)).slice(0,20);

    // color scale
    let rMin = d3.min(filtered, d => d.rank);
    let rMax = d3.max(filtered, d => d.rank);
    if (!(rMin >= 0) || !(rMax >= 0)) { rMin = 3.0; rMax = 5.0; }
    else if (rMin === rMax) { rMin = Math.max(0, rMin-0.2); rMax = Math.min(5, rMax+0.2); }
    const color = d3.scaleSequential(d3.interpolateRdYlGn).domain([rMin, rMax]);

    // legend gradient stops
    const stops = legendGradient.selectAll("stop").data(d3.ticks(0,1,10));
    stops.enter().append("stop").merge(stops)
      .attr("offset", d => `${d*100}%`).attr("stop-color", d => d3.interpolateRdYlGn(d));
    stops.exit().remove();
    legendGroup.selectAll(".legend-min,.legend-max").remove();
    legendGroup.append("text").attr("class","legend-min").attr("x",0).attr("y",-2).attr("font-size","10px").text(rMin.toFixed(1));
    legendGroup.append("text").attr("class","legend-max").attr("x",legendWidth).attr("y",-2).attr("font-size","10px").attr("text-anchor","end").text(rMax.toFixed(1));

    // x scale / axis (PIC-2: normal baseline, no gridlines)
    const maxR = d3.max(filtered, d => size(d.price)) || 60;
    const [minP,maxP] = d3.extent(filtered, d => d.price);
    const pad = (maxP - minP) * 0.1 || 10;
    const xScale = d3.scaleLinear().domain([minP - pad, maxP + pad]).range([maxR + 20, width - maxR - 40]);

    const axis = d3.axisBottom(xScale).ticks(6).tickFormat(d3.format("$~s"));
    axisG.attr("transform", `translate(0,${axisY})`).call(axis);

    // axis label with arrow at the end (like pic-2)
    axisG.selectAll(".price-label").remove();
    axisG.append("text")
      .attr("class","price-label")
      .attr("x", (width - maxR - 40))
      .attr("y", 35)
      .attr("text-anchor","end")
      .attr("fill","#333")
      .text("Price")
      .attr("marker-end","url(#arrow)");

    // simulation
    filtered.forEach(d => { d.fx = xScale(d.price); if (!isFinite(d.y)) d.y = height/2; });
    const simulation = d3.forceSimulation(filtered)
      .alphaDecay(0.05)
      .force("collision", d3.forceCollide().radius(d => size(d.price) + 3))
      .force("x", d3.forceX(d => xScale(d.price)).strength(0.4))
      .force("y", d3.forceY(height/2).strength(0.12))
      .on("tick", ticked);

    function ticked(){
      const [x0,x1] = xScale.range();
      const clampX = x => Math.max(x0, Math.min(x1, x));
      svg.selectAll("circle").attr("cx", d => clampX(d.fx)).attr("cy", d => d.y);
      svg.selectAll("g.brand-label").attr("transform", d => `translate(${clampX(d.fx)},${d.y})`);
    }

    // bubbles (PIC-2 hover = BLUE FILL)
    const node = bubbleLayer.selectAll("circle").data(filtered, d => d.name);
    node.enter().append("circle")
      .attr("r", d => size(d.price))
      .attr("fill", d => color(d.rank))
      .attr("stroke", "#333").attr("stroke-width", 1).attr("opacity", .95).attr("cursor","pointer")
      .on("mouseover", function (event, d) {
        d3.select(this)
          .raise()
          .transition().duration(150)
          .attr("r", size(d.price)*1.15)
          .attr("fill","#3B82F6"); // blue fill like pic-2
        d3.select("#tooltip").style("opacity",1)
          .html(`<strong>${d.name}</strong><br/>Brand: ${d.brand}<br/>Category: ${d.Label}<br/>${money(d.price)}<br/>⭐ ${d.rank.toFixed(2)}<br/>Skin Types: ${["Combination","Dry","Normal","Oily","Sensitive"].filter(s => d[s]===1).join(", ")}`)
          .style("left", (event.pageX+10)+"px").style("top", (event.pageY-28)+"px");
      })
      .on("mouseout", function (event, d) {
        d3.select(this)
          .transition().duration(180)
          .attr("r", size(d.price))
          .attr("fill", d => color(d.rank));
        d3.select("#tooltip").style("opacity",0);
      })
      .merge(node)
      .transition().duration(500)
      .attr("r", d => size(d.price))
      .attr("fill", d => color(d.rank));
    node.exit().remove();

    // labels on top
    const labelG = labelLayer.selectAll("g.brand-label").data(filtered, d => d.name);
    labelG.exit().remove();
    const enterG = labelG.enter().append("g").attr("class","brand-label").attr("pointer-events","none");
    enterG.append("text").attr("class","label-halo").attr("text-anchor","middle").attr("dominant-baseline","middle");
    enterG.append("text").attr("class","label-text").attr("text-anchor","middle").attr("dominant-baseline","middle");
    const merged = enterG.merge(labelG);
    merged.each(function(d){
      const g = d3.select(this);
      const halo = g.select(".label-halo").text(d.brand);
      const fill = g.select(".label-text").text(d.brand);
      const diameter = 2 * size(d.price);
      const fs = Math.min(10 + 0.04 * diameter, 16);
      halo.attr("font-size", fs).attr("stroke","#fff").attr("stroke-width",3).attr("paint-order","stroke");
      fill.attr("font-size", fs).attr("fill","#111");
    });

    // annotations stay
    updateAnnotations({category, skin, maxPrice, filtered});
  }

  d3.select("#resetBtn").on("click", () => {
    d3.select("#categorySelect").property("value","All");
    d3.select("#skinSelect").property("value","All");
    d3.select("#priceSlider").property("value", maxPGlobal);
    d3.select("#priceLabel").text(money(maxPGlobal));
    updateChart();
  });
  d3.selectAll("#categorySelect,#skinSelect,#priceSlider").on("change input", updateChart);

  updateChart();
}).catch(err => {
  console.error("Data load error:", err);
});

