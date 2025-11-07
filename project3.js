import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

/* ==========================
   Helpers & copy
   ========================== */
const BUDGET_BANDS = [25, 40, 60, 80, 120, 200, 0]; // 0 = "∞"
const money = v => `$${(+v).toFixed(0)}`;
const highlight_color = "#FF2D9B";                 // ring color
let highlightedBrands = new Set();

function bandFor(price){
  const p = +price || 0;
  for (const t of BUDGET_BANDS) if (t && p <= t) return t;
  return 0;
}

const SKIN_TIPS = {
  Dry: "Look for hyaluronic acid or glycerin — they pull water into the skin. Ceramides help seal moisture so skin doesn’t feel tight.",
  Oily: "Salicylic acid can clear pores and reduce shine. Niacinamide helps with oil balance; lighter gel textures avoid heaviness.",
  Combination: "Aim for light hydration (hyaluronic acid) without heavy creams. If T-zone is shiny, a touch of salicylic acid helps.",
  Sensitive: "Keep it simple and fragrance-free. Centella, aloe, or oat can feel calming; avoid strong exfoliants unless you already tolerate them.",
  Normal: "Pick by goal: brightening (vitamin C), smoothing (gentle acids), or hydration (HA/glycerin). Gentle formulas keep the barrier happy."
};

function budgetNote(band){
  if (band === 0)   return "Higher prices often bundle multiple actives or luxe textures. Results can be similar — check rating, not just price.";
  if (band <= 40)   return "You can get gentle, well-rated options without going luxury in this price range.";
  if (band <= 80)   return "Mid-range often adds brighteners or pore helpers without luxury pricing.";
  return "This tier usually adds more actives/polish. Consider whether ratings justify the spend.";
}

/* ==========================
   Annotation bits
   ========================== */
function ensurePanel(){
  let panel = d3.select("#annotations");
  if (!panel.empty()) return panel;
  panel = d3.select(".page").insert("aside", "figure").attr("id","annotations").attr("class","anno");
  panel.append("h3").attr("id","anno-head").attr("class","anno-head");
  panel.append("p").attr("id","anno-tip").attr("class","anno-tip");
  panel.append("p").attr("id","anno-budget").attr("class","anno-budget");
  panel.append("p").attr("id","anno-compare").attr("class","anno-compare");
  return panel;
}

function comparisonLine(filtered){
  if (!filtered || filtered.length < 2) return "";
  const sorted = [...filtered].sort((a,b)=> d3.descending(a.rank,b.rank) || d3.ascending(a.price,b.price));
  const a = sorted[0];
  const b = sorted.find(x => x !== a && Math.abs((x.rank||0)-(a.rank||0)) <= 0.1) || sorted[1];
  if (!a || !b) return "";
  const left  = a.price <= b.price ? a : b;
  const right = a.price <= b.price ? b : a;
  return `Both **${a.brand}** and **${b.brand}** are highly rated (≈ ${a.rank.toFixed(2)}), but ${left.brand} is the more budget-friendly pick (${money(left.price)} vs ${money(right.price)}).`;
}

/* ==========================
   Data load
   ========================== */
Promise.all([
  d3.csv("data/cosmetic_p.csv"),
  d3.json("data/best_brand_for_skin_types.json"),
  d3.json("data/best_products_for_brand.json")
]).then(([raw, bestBrandBySkinJSON, bestProductsByBrandJSON]) => {

  const data = raw.map(d => ({
    ...d,
    price:+d.price||0, rank:+d.rank||0,
    Combination:+d.Combination||0, Dry:+d.Dry||0, Normal:+d.Normal||0, Oily:+d.Oily||0, Sensitive:+d.Sensitive||0
  }));

  // JSON helpers (accept array/object shapes)
  function findBestBrandForSkin({skin, category}){
    const j = bestBrandBySkinJSON;
    if (Array.isArray(j)){
      const r = j.find(r => (r.skin===skin || r.skin_type===skin) && (r.category===category || r.Label===category));
      return r ? (r.brand||r.Brand) : null;
    }
    if (j && typeof j === "object"){
      const node = j[skin] || j[skin?.toLowerCase()] || j[skin?.toUpperCase()];
      if (node && typeof node === "object")
        return node[category] || node[category?.toLowerCase()] || node[category?.toUpperCase()] || null;
    }
    return null;
  }

  function findBestProductForBrand(brand){
    const j = bestProductsByBrandJSON;
    if (Array.isArray(j)){
      const rows = j.filter(r => (r.brand||r.Brand) === brand);
      const top  = rows.sort((a,b)=>(+b.rank||+b.rating||0)-(+a.rank||+a.rating||0))[0];
      if (!top) return null;
      return {name:top.name||top.product||"", rating:+top.rank||+top.rating||null, category:top.Label||top.category||null, price:+top.price||null};
    }
    if (j && typeof j === "object"){
      const node = j[brand];
      if (!node) return null;
      const top = Array.isArray(node) ? node.sort((a,b)=>(+b.rank||+b.rating||0)-(+a.rank||+a.rating||0))[0] : node;
      if (!top) return null;
      return {name:top.name||top.product||"", rating:+top.rank||+top.rating||null, category:top.Label||top.category||null, price:+top.price||null};
    }
    return null;
  }

  /* ==========================
     SVG & layers
     ========================== */
  const width=1100, height=750, axisY=height-80, gridHeight=height-160;
  const svg=d3.select("#brand-bubble-chart").attr("width",width).attr("height",height).attr("overflow","visible");

  const gridG   = svg.append("g").attr("class","grid-layer");   // back
  const bubbleG = svg.append("g").attr("class","bubble-layer");
  const labelG  = svg.append("g").attr("class","label-layer");
  const axisG   = svg.append("g").attr("class","x-axis");        // front

  // defs: legend gradient + axis arrow
  const defs = svg.append("defs");
  const legendGradient = defs.append("linearGradient").attr("id","legend-gradient").attr("x1","0%").attr("x2","100%");
  defs.append("marker").attr("id","axis-arrow").attr("viewBox","0 0 10 10").attr("refX",9).attr("refY",5)
    .attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto")
    .append("path").attr("d","M0,0 L10,5 L0,10 Z").attr("fill","#333");

  // Tooltip (singleton)
  if (d3.select("#tooltip").empty()) d3.select("body").append("div").attr("id","tooltip");

  // Controls
  const categories=[...new Set(data.map(d=>d.Label))].sort();
  const skinTypes=["Combination","Dry","Normal","Oily","Sensitive"];
  const maxPGlobal=d3.max(data,d=>d.price);

  d3.select("#controls").html(`
    <label>Category:</label>
    <select id="categorySelect"><option value="All">All</option>${categories.map(c=>`<option value="${c}">${c}</option>`).join("")}</select>
    <label>Skin Type:</label>
    <select id="skinSelect"><option value="All">All</option>${skinTypes.map(s=>`<option value="${s}">${s}</option>`).join("")}</select>
    <label>Max Price:</label>
    <input id="priceSlider" type="range" min="0" max="${maxPGlobal}" step="1" value="${maxPGlobal}">
    <span id="priceLabel">${money(maxPGlobal)}</span>
    <button id="resetBtn">Reset Filters</button>
  `);

  const size=d3.scaleSqrt().domain(d3.extent(data,d=>d.price)).range([10,60]);

  // Legend (right, horizontal)
  const legendWidth=200, legendHeight=10;
  const legendGroup=svg.append("g").attr("class","legend-group")
    .attr("transform",`translate(${(width-legendWidth - 20)},${height-30})`);
  legendGroup.append("rect").attr("width",legendWidth).attr("height",legendHeight).style("fill","url(#legend-gradient)");
  legendGroup.append("text").attr("x",legendWidth/2).attr("y",-10).attr("font-size","12px").attr("text-anchor","middle").text("Rating (relative)");

  /* ==========================
     Annotations + helpers
     ========================== */
  function updateAnnotations({category, skin, maxPrice, filtered}){
    const panel = ensurePanel();
    const head = panel.select("#anno-head");
    const tip  = panel.select("#anno-tip");
    const budg = panel.select("#anno-budget");
    const comp = panel.select("#anno-compare");

    if (skin==="All" || category==="All" || !filtered?.length){
      panel.attr("hidden", true);
      head.text(""); tip.text(""); budg.text(""); comp.html("");
      return;
    }
    panel.attr("hidden", null);

    const band=bandFor(maxPrice);
    head.text(`Tips for ${skin} skin — ${category}s under ${band?money(band):"no price limit"}`);
    tip.text(SKIN_TIPS[skin]||"");
    budg.text(budgetNote(band));

    const line=comparisonLine(filtered);
    const bestBrand=findBestBrandForSkin({skin,category});
    let jsonLine="";
    if (bestBrand){
      const bestProd=findBestProductForBrand(bestBrand);
      if (bestProd){
        const pricePart=Number.isFinite(bestProd.price)?` for about ${money(bestProd.price)}`:"";
        const ratingPart=Number.isFinite(bestProd.rating)?` (⭐ ${bestProd.rating.toFixed(2)})`:"";
        jsonLine=`For ${skin.toLowerCase()} skin in ${category.toLowerCase()}, <strong>${bestBrand}</strong>’s top pick is <strong>${bestProd.name}</strong>${pricePart}${ratingPart}.`;
      } else {
        jsonLine=`For ${skin.toLowerCase()} skin in ${category.toLowerCase()}, <strong>${bestBrand}</strong> is a frequent top brand in our summary.`;
      }
    }
    comp.html([line,jsonLine].filter(Boolean).join("<br>"));
  }

  function pickComparisonPair(filtered){
    if (!filtered || filtered.length < 2) return null;
    const sorted = [...filtered].sort((a,b)=> d3.descending(a.rank,b.rank) || d3.ascending(a.price,b.price));
    const a = sorted[0];
    const b = sorted.find(x => x !== a && Math.abs((x.rank||0)-(a.rank||0)) <= 0.1) || sorted[1];
    return (a && b) ? {a,b} : null;
  }

  /* ==========================
     Update / render
     ========================== */
  function updateChart(){
    const category = d3.select("#categorySelect").property("value");
    const skin     = d3.select("#skinSelect").property("value");
    const maxPrice = +d3.select("#priceSlider").property("value");
    d3.select("#priceLabel").text(money(maxPrice));

    let filtered = data
      .filter(d => (category==="All"||d.Label===category) && (skin==="All"||d[skin]===1) && d.price<=maxPrice)
      .sort((a,b)=> d3.descending(a.rank,b.rank))
      .slice(0,20);
     


    // early exit if no rows
    if (!filtered.length){
      bubbleG.selectAll("circle").remove();
      labelG.selectAll("g.brand-label").remove();
      updateAnnotations({category, skin, maxPrice, filtered});
      return;
    }

    // Which brands to highlight (for the comparison line)
    const pair = pickComparisonPair(filtered);
    highlightedBrands = new Set(pair ? [pair.a.brand, pair.b.brand] : []);

     // best product from the brand if more than 1 per category
   // account for the tie within same brand --- to find best product
     const highlightNames = new Set();
     if (pair) {
        const comparedBrands = new Set([pair.a.brand, pair.b.brand]);
        const tie_determinant = .001;

        const byBrand = d3.group(
           filtered.filter(d => comparedBrands.has(d.brand)), d => d.brand);

        byBrand.forEach(items => {
           const maxR = d3.max(items, d => d.rank);
           items.forEach(d => {
              if (Math.abs(d.rank - maxR) <= tie_determinant) {
                 highlightNames.add(d.name);
              }
           });
        });
     }
    

    // color scale
    let rMin=d3.min(filtered,d=>d.rank), rMax=d3.max(filtered,d=>d.rank);
    if (!(rMin>=0) || !(rMax>=0)) { rMin=3.0; rMax=5.0; }
    else if (rMin===rMax) { rMin=Math.max(0,rMin-0.2); rMax=Math.min(5,rMax+0.2); }
    const color=d3.scaleSequential(d3.interpolateRdYlGn).domain([rMin,rMax]);

    // legend stops + min/max labels
    const stops=legendGradient.selectAll("stop").data(d3.ticks(0,1,10));
    stops.enter().append("stop").merge(stops)
      .attr("offset",d=>`${d*100}%`).attr("stop-color",d=>d3.interpolateRdYlGn(d));
    stops.exit().remove();

    legendGroup.selectAll(".legend-min,.legend-max").remove();
    legendGroup.append("text").attr("class","legend-min").attr("x",0).attr("y",-2).attr("font-size","10px").text(rMin.toFixed(1));
    legendGroup.append("text").attr("class","legend-max").attr("x",legendWidth).attr("y",-2).attr("font-size","10px").attr("text-anchor","end").text(rMax.toFixed(1));

    // x scale
    const maxR=d3.max(filtered,d=>size(d.price))||60;
    const [minP,maxP]=d3.extent(filtered,d=>d.price);
    const pad=(maxP-minP)*0.1 || 10;
    const xScale=d3.scaleLinear().domain([minP-pad, maxP+pad]).range([maxR+20, width-maxR-40]);

    // GRIDLINES (behind)
    const ticks=xScale.ticks(6);
    const lines=gridG.selectAll("line.vgrid").data(ticks, d=>d);
    lines.enter().append("line").attr("class","vgrid")
      .attr("y1", axisY - gridHeight).attr("y2", axisY).attr("stroke", "#e5e7eb").attr("stroke-width",1)
      .merge(lines).attr("x1", d=>xScale(d)).attr("x2", d=>xScale(d));
    lines.exit().remove();
    gridG.lower(); bubbleG.raise(); labelG.raise(); axisG.raise();

    // AXIS with label + arrow
    const axis = d3.axisBottom(xScale).ticks(6).tickFormat(d3.format("$~s")).tickSize(0);
    axisG.attr("transform",`translate(0,${axisY})`).call(axis);
    axisG.select(".domain").attr("stroke","#333").attr("stroke-width",1.5).attr("stroke-linecap","butt").attr("marker-end","url(#axis-arrow)");
    axisG.selectAll(".price-label").data([0]).join("text")
      .attr("class","price-label")
      .attr("x",(xScale.range()[0]+xScale.range()[1])/2)
      .attr("y",26).attr("text-anchor","middle").attr("fill","#333")
      .style("font-size","12px").style("pointer-events","none").text("Price");

    // Force simulation (position)
    filtered.forEach(d=>{ d.fx=xScale(d.price); if(!isFinite(d.y)) d.y=height/2; });
    d3.forceSimulation(filtered)
      .alphaDecay(0.05)
      .force("collision", d3.forceCollide().radius(d=>size(d.price)+3))
      .force("x", d3.forceX(d=>xScale(d.price)).strength(0.4))
      .force("y", d3.forceY(height/2).strength(0.12))
      .on("tick", ()=>{
        const [x0,x1]=xScale.range();
        const clampX=x=>Math.max(x0,Math.min(x1,x));
        bubbleG.selectAll("circle").attr("cx", d=>clampX(d.fx)).attr("cy", d=>d.y);
        labelG.selectAll("g.brand-label").attr("transform", d=>`translate(${clampX(d.fx)},${d.y})`);
      });

    // BUBBLES
    const node = bubbleG.selectAll("circle").data(filtered, d => d.name);
    const enter = node.enter().append("circle")
      .attr("r", d => size(d.price))
      .attr("fill", d => color(d.rank))
      .attr("opacity", 0.95)
      .attr("cursor", "pointer");

    const merged = enter.merge(node);

    // Set ring + highlighted class immediately (no flicker)
    merged
      .classed("highlighted", d => highlightNames.has(d.name))
      .attr("stroke", d => highlightNames.has(d.name) ? highlight_color : "#333")
      .attr("stroke-width", d => highlightNames.has(d.name) ? 3 : 1)
      .transition().duration(500)
      .attr("r", d => size(d.price))
      .attr("fill", d => color(d.rank));

    // Interactions
    merged
      .on("mouseover", function(event,d){
        d3.select(this).raise().transition().duration(150)
          .attr("r", size(d.price)*1.08)
          .attr("stroke", highlight_color)
          .attr("stroke-width", highlightNames.has(d.name) ? 5 : 4);
        d3.select("#tooltip").style("opacity",1)
          .html(`<strong>${d.name}</strong><br/>Brand: ${d.brand}<br/>Category: ${d.Label}<br/>${money(d.price)}<br/>⭐ ${d.rank.toFixed(2)}<br/>Skin Types: ${["Combination","Dry","Normal","Oily","Sensitive"].filter(s=>d[s]===1).join(", ")}`);
      })
      .on("mousemove", function(event){
        d3.select("#tooltip")
          .style("left",(event.pageX+10)+"px")
          .style("top",(event.pageY-28)+"px");
      })
      .on("mouseout", function(event,d){
        d3.select(this).transition().duration(180)
          .attr("r", size(d.price))
          .attr("stroke", highlightNames.has(d.name) ? highlight_color : "#333")
          .attr("stroke-width", highlightNames.has(d.name) ? 3 : 1);
        d3.select("#tooltip").style("opacity",0);
      });

    node.exit().remove();

    // LABELS
    const lab = labelG.selectAll("g.brand-label").data(filtered, d=>d.name);
    const labEnter = lab.enter().append("g").attr("class","brand-label").attr("pointer-events","none");
    labEnter.append("text").attr("class","label-halo").attr("text-anchor","middle").attr("dominant-baseline","middle");
    labEnter.append("text").attr("class","label-text").attr("text-anchor","middle").attr("dominant-baseline","middle");

    labEnter.merge(lab).each(function(d){
      const g=d3.select(this);
      const diam=2*size(d.price);
      const fs=Math.min(10+0.04*diam,16);
      g.select(".label-halo").text(d.brand).attr("font-size",fs).attr("stroke","#fff").attr("stroke-width",3).attr("paint-order","stroke");
      g.select(".label-text").text(d.brand).attr("font-size",fs).attr("fill","#111");
    });

    lab.exit().remove();

    updateAnnotations({category, skin, maxPrice, filtered});
  }

  // listeners
  d3.select("#resetBtn").on("click", ()=>{
    d3.select("#categorySelect").property("value","All");
    d3.select("#skinSelect").property("value","All");
    d3.select("#priceSlider").property("value", maxPGlobal);
    d3.select("#priceLabel").text(money(maxPGlobal));
    updateChart();
  });
  d3.selectAll("#categorySelect,#skinSelect,#priceSlider").on("change input", updateChart);

  updateChart();
}).catch(err => console.error("Data load error:", err));




