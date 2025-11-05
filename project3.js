import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

//------------------------------------------------------------
// SECOND VISUAL: Clustered Bubble Chart of Brands (cleaner layout + abbrev labels)
//------------------------------------------------------------
d3.csv("data/cosmetic_p.csv").then(data => {
  data.forEach(d => {
    d.rank = +d.rank || 0;
  });

  const grouped = Array.from(
    d3.group(data, d => d.brand),
    ([brand, values]) => ({
      brand,
      count: values.length,
      avgRating: d3.mean(values, v => v.rank)
    })
  ).filter(d => d.brand && !isNaN(d.avgRating));

  const topBrands = grouped.sort((a, b) => d3.descending(a.count, b.count)).slice(0, 30);

  const width = 950, height = 650;
  const svg = d3.select("#brand-bubble-chart")
    .attr("width", width)
    .attr("height", height);

  const color = d3.scaleSequential(d3.interpolateRdYlGn)
    .domain([d3.min(topBrands, d => d.avgRating), d3.max(topBrands, d => d.avgRating)]);

  const size = d3.scaleSqrt()
    .domain(d3.extent(topBrands, d => d.count))
    .range([20, 70]);

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

  // Simulation with slightly stronger collision for spacing
  const simulation = d3.forceSimulation(topBrands)
    .force("charge", d3.forceManyBody().strength(8))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(d => size(d.count) + 8))
    .on("tick", ticked);

  const node = svg.selectAll("circle")
    .data(topBrands)
    .enter()
    .append("circle")
    .attr("r", d => size(d.count))
    .attr("fill", d => color(d.avgRating))
    .attr("stroke", "#333")
    .attr("stroke-width", 1)
    .attr("opacity", 0.9)
    .attr("cursor", "pointer")
    .on("mouseover", (event, d) => {
      d3.select("#tooltip")
        .style("opacity", 1)
        .html(`
          <strong>${d.brand}</strong><br>
          ${d.count} products<br>
          ⭐ Avg Rank: ${d.avgRating.toFixed(2)}
        `)
        .style("left", event.pageX + 10 + "px")
        .style("top", event.pageY - 28 + "px");
    })
    .on("mouseout", () => d3.select("#tooltip").style("opacity", 0));

  // Abbreviate long brand names visually (keep full name in tooltip)
  const label = svg.selectAll("text")
    .data(topBrands)
    .enter()
    .append("text")
    .text(d => d.brand.length > 10 ? d.brand.slice(0, 10) + "…" : d.brand)
    .attr("font-size", "10px")
    .attr("text-anchor", "middle")
    .attr("pointer-events", "none")  // avoids interfering with hover

  function ticked() {
    node.attr("cx", d => d.x)
        .attr("cy", d => d.y);
    label.attr("x", d => d.x)
         .attr("y", d => d.y + 3);
  }
});