import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

// ------------------------------------------------------------
// INTERACTIVE SKINCARE BUBBLE CHART
// (MULTI SKIN TYPE FILTER + RELATIVE COLORS + PRICE CLUSTERING)
// ------------------------------------------------------------
d3.csv("data/cosmetic_p.csv").then(data => {
  // ------------------------------------------------------------
  // DATA PREPARATION
  // ------------------------------------------------------------
  data.forEach(d => {
    d.price = +d.price || 0;
    d.rank = +d.rank || 0;
    d.Combination = +d.Combination || 0;
    d.Dry = +d.Dry || 0;
    d.Normal = +d.Normal || 0;
    d.Oily = +d.Oily || 0;
    d.Sensitive = +d.Sensitive || 0;
  });

  const width = 1500, height = 730;

  const svg = d3.select("#brand-bubble-chart")
    .attr("width", width)
    .attr("height", height);

    let brushRange = null;                         // null = no brush
    const axisG  = svg.append("g").attr("class", "x-axis");
    const brushG = svg.append("g").attr("class", "x-brush");

  // ------------------------------------------------------------
  // TOOLTIP
  // ------------------------------------------------------------
  if (d3.select("#tooltip").empty()) {
    d3.select("body").append("div")
      .attr("id", "tooltip")
      .style("position", "absolute")
      .style("background", "white")
      .style("border", "1px solid #ccc")
      .style("padding", "6px 10px")
      .style("border-radius", "4px")
      .style("pointer-events", "none")
      .style("opacity", 0);
  }

  //------------------------------------------------------------
// CONTROLS (CATEGORY, SKIN TYPE, PRICE)
//------------------------------------------------------------
const categories = Array.from(new Set(data.map(d => d.Label))).sort();
const skinTypes = ["Combination", "Dry", "Normal", "Oily", "Sensitive"];
const maxPrice = d3.max(data, d => d.price);

const controls = d3.select("#controls").html(`
  <label>Category: </label>
  <select id="categorySelect">
    <option value="All">All</option>
    ${categories.map(c => `<option value="${c}">${c}</option>`).join("")}
  </select>
  &nbsp;&nbsp;
  <label>Skin Type: </label>
  <select id="skinSelect">
    <option value="All">All</option>
    ${skinTypes.map(s => `<option value="${s}">${s}</option>`).join("")}
  </select>
  &nbsp;&nbsp;
  <label>Max Price: </label>
  <input type="range" id="priceSlider" min="0" max="${maxPrice}" value="${maxPrice}" step="1" style="width:200px;">
  <span id="priceLabel">${maxPrice}</span>
  &nbsp;&nbsp;
  <button id="resetBtn">Reset Filters</button>
`);

  // ------------------------------------------------------------
  // SIZE SCALE (STATIC)
  // ------------------------------------------------------------
  const size = d3.scaleSqrt()
    .domain(d3.extent(data, d => d.price))
    .range([10, 60]);

  // ------------------------------------------------------------
  // LEGEND + ARROW MARKER SETUP
  // ------------------------------------------------------------
  const defs = svg.append("defs");

  // Color gradient
  const gradient = defs.append("linearGradient")
    .attr("id", "legend-gradient")
    .attr("x1", "0%")
    .attr("x2", "100%");

  // Arrow marker
  defs.append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 8)
    .attr("refY", 5)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", "#555");

  // Legend group
  const legendWidth = 200, legendHeight = 10;
  const legendGroup = svg.append("g")
    .attr("class", "legend-group")
    .attr("transform", `translate(${width - legendWidth - 40}, ${height - 60})`);

  legendGroup.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("fill", "url(#legend-gradient)");

  legendGroup.append("text")
    .attr("x", legendWidth / 2)
    .attr("y", -10)
    .attr("font-size", "12px")
    .attr("text-anchor", "middle")
    .text("Rating (relative)");

  // place legend in the center bottom area, make sure its below the axis, push the price axis up a bit 
  legendGroup.attr("transform", `translate(${(width - legendWidth) / 2}, ${height - 20})`);

  // ------------------------------------------------------------
  // UPDATE FUNCTION
  // ------------------------------------------------------------
  function updateChart() {
    const selectedCategory = d3.select("#categorySelect").property("value");
    const selectedSkin = d3.select("#skinSelect").property("value");
    const maxP = +d3.select("#priceSlider").property("value");
    d3.select("#priceLabel").text(maxP);

    let filtered = data.filter(d =>
      (selectedCategory === "All" || d.Label === selectedCategory) &&
      (selectedSkin === "All" || d[selectedSkin] === 1) &&
      (
        brushRange
          ? (d.price >= brushRange[0] && d.price <= brushRange[1])  // brush range active
          : (d.price <= maxP)                                       // otherwise slider max
      )
    );



    // Top 30 by rating
    filtered = filtered.sort((a, b) => d3.descending(a.rank, b.rank)).slice(0, 30);

    // ---- COLOR SCALE (dynamic with safe guard) ----
let rMin = d3.min(filtered, d => d.rank);
let rMax = d3.max(filtered, d => d.rank);

// If min==max (or undefined), widen a bit so we see variation and a valid gradient
if (!(rMin >= 0) || !(rMax >= 0)) {
  rMin = 3.0; rMax = 5.0;         // fallback
} else if (rMin === rMax) {
  rMin = Math.max(0, rMin - 0.2);
  rMax = Math.min(5, rMax + 0.2);
}

const color = d3.scaleSequential(d3.interpolateRdYlGn).domain([rMin, rMax]);

// ---- UPDATE GRADIENT STOPS (keep as is if you already have it) ----
const stops = gradient.selectAll("stop").data(d3.ticks(0, 1, 10));
stops.enter().append("stop")
  .merge(stops)
  .attr("offset", d => `${d * 100}%`)
  .attr("stop-color", d => d3.interpolateRdYlGn(d));
stops.exit().remove();

// ---- UPDATE LEGEND LABELS ----
svg.selectAll(".legend-min, .legend-max").remove();
legendGroup.append("text")
  .attr("class", "legend-min")
  .attr("x", 0)
  .attr("y", -2)
  .attr("font-size", "10px")
  .text(rMin.toFixed(1));
legendGroup.append("text")
  .attr("class", "legend-max")
  .attr("x", legendWidth)
  .attr("y", -2)
  .attr("font-size", "10px")
  .attr("text-anchor", "end")
  .text(rMax.toFixed(1));

// ---- APPLY COLOR TO BUBBLES ----
svg.selectAll("circle")
  .transition().duration(300)
  .attr("fill", d => color(d.rank));


    // Force simulation// --- Dynamic horizontal padding to prevent clipping on both sides ---
const maxRadius = d3.max(filtered, d => size(d.price)) || 60;

// Compute domain slightly extended beyond min/max
const priceExtent = d3.extent(filtered, d => d.price);
const priceRange = priceExtent[1] - priceExtent[0];
const domainMin = priceExtent[0] - priceRange * 0.05;
const domainMax = priceExtent[1] + priceRange * 0.15; // extra right-side buffer for legend area

// --- Compute full width range, respecting bubble radius ---
const leftPad = maxRadius + 20;
const rightPad = maxRadius + 40; // add a little extra on right for labels + arrow
const xScale = d3.scaleLinear()
  .domain([domainMin, domainMax])
  .range([leftPad, width - rightPad]);

  // ---------- FULL-WIDTH PRICE AXIS + ARROW ----------
const axisY = height - 80; // where the axis sits
axisG.attr("transform", `translate(0, ${axisY})`);



// Direction label
svg.selectAll(".price-arrow-label").data([1]).join("text")
  .attr("class", "price-arrow-label")
  .attr("x", (xScale.range()[0] + xScale.range()[1]) / 2)
  .attr("y", axisY - 10)
  .attr("text-anchor", "middle")
  .attr("font-size", "12px")
  .attr("fill", "#333")
  .text("Price");

// Full-width arrow on the axis
svg.selectAll(".price-axis-line").data([1]).join("line")
  .attr("class", "price-axis-line")
  .attr("x1", xScale.range()[0])
  .attr("y1", axisY)
  .attr("x2", xScale.range()[1])
  .attr("y2", axisY)
  .attr("stroke", "#555")
  .attr("stroke-width", 2)
  .attr("marker-end", "url(#arrowhead)");

// if we dont want to lock x positions to price, comment out this block
// ---- LOCK X POSITIONS TO PRICE VALUES ----

filtered.forEach(d => {
  d.fx = xScale(d.price);           // exact x at price
  if (!isFinite(d.y)) d.y = height / 2;
});

function ticked() {
  const [x0, x1] = xScale.range();
  const clampX = x => Math.max(x0, Math.min(x1, x));

  svg.selectAll("circle")
    .attr("cx", d => clampX(d.fx))
    .attr("cy", d => d.y); // keep your Y clamp if you use one

  svg.selectAll("g.brand-label")
    .attr("transform", d => `translate(${clampX(d.fx)},${d.y})`);
}

// axis generator
const xAxis = d3.axisBottom(xScale)
  .ticks(6)
  .tickFormat(d3.format("$~s"));

// render axis
axisG.call(xAxis);

// up to here for axis


// --- Force simulation (balanced + constrained layout) ---
const simulation = d3.forceSimulation(filtered)
  .alphaDecay(0.05)
  .force("charge", d3.forceManyBody().strength(1.8)) // gentle push so bubbles don't drift out
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(d => size(d.price) + 4))
  .force("x", d3.forceX(d => xScale(d.price)).strength(0.4))
  .force("y", d3.forceY(height / 2).strength(0.12))
  .on("tick", ticked);


    // Draw bubbles
    const node = svg.selectAll("circle")
      .data(filtered, d => d.name);

    node.enter()
      .append("circle")
      .attr("r", d => size(d.price))
      .attr("fill", d => color(d.rank))
      .attr("stroke", "#333")
      .attr("stroke-width", 1)
      .attr("opacity", 0.9)
      .attr("cursor", "pointer")
      .on("mouseover", (event, d) => {
        d3.select("#tooltip")
          .style("opacity", 1)
          .html(`
            <strong>${d.name}</strong><br>
            Brand: ${d.brand}<br>
            Category: ${d.Label}<br>
            💲${d.price}<br>
            ⭐ Rating: ${d.rank.toFixed(2)}<br>
            Skin Types: ${skinTypes.filter(s => d[s] === 1).join(", ")}
          `)
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY - 28 + "px");
      })
      .on("mouseout", () => d3.select("#tooltip").style("opacity", 0))
      .merge(node)
      .transition()
      .duration(800)
      .attr("r", d => size(d.price))
      .attr("fill", d => color(d.rank));

    node.exit().remove();

//     // Labels
//     const label = svg.selectAll("text.bubble-label")
//       .data(filtered, d => d.name);

//     label.enter()
//       .append("text")
//       .attr("class", "bubble-label")
//       .text(d => d.brand.length > 10 ? d.brand.slice(0, 10) + "…" : d.brand)
//       .attr("font-size", "10px")
//       .attr("text-anchor", "middle")
//       .attr("pointer-events", "none")
//       .merge(label)
//       .transition()
//       .duration(800)
//       .attr("font-size", "10px");

//     label.exit().remove();

//     function ticked() {
//   const maxRadius = d3.max(filtered, d => size(d.price)) || 60;

//   svg.selectAll("circle")
//     .attr("cx", d => Math.max(maxRadius, Math.min(width - maxRadius, d.x)))
//     .attr("cy", d => d.y);

//   svg.selectAll(".bubble-label")
//     .attr("x", d => Math.max(maxRadius, Math.min(width - maxRadius, d.x)))
//     .attr("y", d => d.y + 3);
// }

    // ===== FULL BRAND LABELS CENTERED INSIDE THE BUBBLE =====
const labelG = svg.selectAll("g.brand-label")
  .data(filtered, d => d.name);

labelG.exit().remove();

const labelGEnter = labelG.enter()
  .append("g")
  .attr("class", "brand-label")
  .attr("pointer-events", "none"); // labels won't block hover

// two layered texts for halo + fill, both centered
labelGEnter.append("text")
  .attr("class", "label-halo")
  .attr("text-anchor", "middle")
  .attr("dominant-baseline", "middle"); // vertical centering

labelGEnter.append("text")
  .attr("class", "label-text")
  .attr("text-anchor", "middle")
  .attr("dominant-baseline", "middle");

const labelGMerged = labelGEnter.merge(labelG);

// set text and auto-fit font size so it stays inside the circle
labelGMerged.each(function(d) {
  const g = d3.select(this);
  const halo = g.select(".label-halo").text(d.brand);
  const fill = g.select(".label-text").text(d.brand);

  // available width inside circle (diameter minus a small padding)
  const maxW = Math.max(0, 2 * size(d.price) - 6);

  // start from a readable size and shrink until it fits or reach min
  let fs = 12; // starting font size
  const minFS = 7;
  halo.attr("font-size", fs);
  fill.attr("font-size", fs);

  // measure & shrink loop
  // (need the element in the DOM before measuring)
  while (fill.node().getComputedTextLength() > maxW && fs > minFS) {
    fs -= 1;
    halo.attr("font-size", fs);
    fill.attr("font-size", fs);
  }
});

// ---- ticked(): keep circles and labels centered together ----
function ticked() {
  const maxRadius = d3.max(filtered, d => size(d.price)) || 60;

  // circles
  svg.selectAll("circle")
    .attr("cx", d => Math.max(maxRadius, Math.min(width - maxRadius, d.x)))
    .attr("cy", d => d.y);

  // label groups positioned at the bubble center
  svg.selectAll("g.brand-label")
    .attr("transform", d => {
      const cx = Math.max(maxRadius, Math.min(width - maxRadius, d.x));
      const cy = d.y;
      return `translate(${cx},${cy})`;
    });
}

  labelGMerged.each(function(d) {
  const g = d3.select(this);
  const halo = g.select(".label-halo").text(d.brand);
  const fill = g.select(".label-text").text(d.brand);

  const diameter = 2 * size(d.price);
  const base = 10 + 0.04 * diameter;        // scale up with bubble size
  const fs = Math.min(base, 16);            // cap at 16px
  halo.attr("font-size", fs);
  fill.attr("font-size", fs);
});
  }

  // ------------------------------------------------------------
  // RESET FILTERS
  // ------------------------------------------------------------
 d3.select("#resetBtn").on("click", () => {
  d3.select("#categorySelect").property("value", "All");
  d3.select("#skinSelect").property("value", "All");
  d3.select("#priceSlider").property("value", maxPrice);
  d3.select("#priceLabel").text(maxPrice);
  updateChart();
});


  // ------------------------------------------------------------
  // EVENT LISTENERS
  // ------------------------------------------------------------
  d3.selectAll("#categorySelect, #skinSelect, #priceSlider")
    .on("change input", updateChart);

  // INITIAL RENDER
  updateChart();
});
