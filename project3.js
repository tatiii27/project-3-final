import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

/* ==========================
   Helpers & text
   ========================== */
const BUDGET_BANDS = [25, 40, 60, 80, 120, 200, 0]; // 0 = "∞"
const money = v => `$${(+v).toFixed(0)}`;
function bandFor(price){ const p=+price||0; for (const t of BUDGET_BANDS) if (t && p<=t) return t; return 0; }

const SKIN_TIPS = {
  Dry: "Look for hyaluronic acid or glycerin — they pull water into the skin. Ceramides help seal moisture so skin doesn’t feel tight.",
  Oily: "Salicylic acid can clear pores and reduce shine. Niacinamide helps with oil balance; lighter gel textures avoid heaviness.",
  Combination: "Aim for light hydration (hyaluronic acid) without heavy creams. If T-zone is shiny, a touch of salicylic acid helps.",
  Sensitive: "Keep it simple and fragrance-free. Centella, aloe, or oat can feel calming; avoid strong exfoliants unless you already tolerate them.",
  Normal: "Pick by goal: brightening (vitamin C), smoothing (gentle acids), or hydration (HA/glycerin). Gentle formulas keep the barrier happy."
};
function budgetNote(band){
  if (band===0) return "Higher prices often bundle multiple actives or luxe textures. Results can be similar — check rating, not just price.";
  if (band<=40) return "You can get gentle, well-rated options without going luxury in this price range.";
  if (band<=80) return "Mid-range often adds brighteners or pore helpers without luxury pricing.";
  return "This tier usually adds more actives/polish. Consider whether ratings justify the spend.";
}

/* ==========================
   Annotation helpers
   ========================== */
function ensurePanel(){
  let panel = d3.select("#annotations");
  if (!panel.empty()) return panel;               // if present, use it

  // Fallback: create before the <figure> inside .page
  const page = d3.select(".page");
  panel = page.insert("aside", "figure")
    .attr("id","annotations")
    .attr("class","anno");

  panel.append("h3").attr("id","anno-head").attr("class","anno-head");
  panel.append("p").attr("id","anno-tip").attr("class","anno-tip");
  panel.append("p").attr("id","anno-budget").attr("class","anno-budget");
  panel.append("p").attr("id","anno-compare").attr("class","anno-compare");
  return panel;
}
function comparisonLine(filtered){
  if (!filtered || filtered.length<2) return "";
  const sorted=[...filtered].sort((a,b)=>d3.descending(a.rank,b.rank)||d3.ascending(a.price,b.price));
  const a=sorted[0], b=sorted.find(x=>x!==a && Math.abs((x.rank||0)-(a.rank||0))<=0.1) || sorted[1];
  if(!a||!b) return "";
  const left=a.price<=b.price?a:b, right=a.price<=b.price?b:a;
  return `Both **${a.brand}** and **${b.brand}** are highly rated (≈ ${a.rank.toFixed(2)}), but ${left.brand} is the more budget-friendly pick (${money(left.price)} vs ${money(right.price)}).`;
}

/* ==========================
   Load data
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

  // JSON helpers (accept array or object shapes)
  function findBestBrandForSkin({skin, category}){
    const j=bestBrandBySkinJSON;
    if (Array.isArray(j)){
      const r=j.find(r=>(r.skin===skin||r.skin_type===skin)&&(r.category===category||r.Label===category));
      return r ? (r.brand||r.Brand) : null;
    }
    if (j && typeof j==="object"){
      const node=j[skin]||j[skin?.toLowerCase()]||j[skin?.toUpperCase()];
      if (node && typeof node==="object")
        return node[category]||node[category?.toLowerCase()]||node[category?.toUpperCase()]||null;
    }
    return null;
  }
  function findBestProductForBrand(brand){
    const j=bestProductsByBrandJSON;
    if (Array.isArray(j)){
      const rows=j.filter(r=>(r.brand||r.Brand)===brand);
      const top=rows.sort((a,b)=>(+b.rank||+b.rating||0)-(+a.rank||+a.rating||0))[0];
      if(!top) return null;
      return {name:top.name||top.product||"", rating:+top.rank||+top.rating||null, category:top.Label||top.category||null, price:+top.price||null};
    }
    if (j && typeof j==="object"){
      const node=j[brand];
      if (!node) return null;
      const top=Array.isArray(node)
        ? node.sort((a,b)=>(+b.rank||+b.rating||0)-(+a.rank||+a.rating||0))[0]
        : node;
      if(!top) return null;
      return {name:top.name||top.product||"", rating:+top.rank||+top.rating||null, category:top.Label||top.category||null, price:+top.price||null};
    }
    return null;
  }

  /* ==========================
     SVG & layers (grid behind!)
     ========================== */
  const width=1100, height=750, axisY=height-80, gridHeight=height-160;
  const svg=d3.select("#brand-bubble-chart")
    .attr("width",width)
    .attr("height",height)
    .attr("overflow","visible");  // prevent label/arrow clipping

  // layer order: grid (back) → bubbles → labels → axis (front)
  const gridG   = svg.append("g").attr("class","grid-layer");
  const bubbleG = svg.append("g").attr("class","bubble-layer");
  const labelG  = svg.append("g").attr("class","label-layer");
  const axisG   = svg.append("g").attr("class","x-axis");

  // defs: legend gradient + arrowhead for axis
  const defs = svg.append("defs");
  const legendGradient = defs.append("linearGradient")
    .attr("id","legend-gradient").attr("x1","0%").attr("x2","100%");
  defs.append("marker")
    .attr("id","axis-arrow").attr("viewBox","0 0 10 10").attr("refX",9).attr("refY",5)
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

  // legend
  const legendWidth=200, legendHeight=10;
  const legendGroup=svg.append("g").attr("class","legend-group")
    .attr("transform",`translate(${(width-legendWidth - 20)},${height-30})`);
  legendGroup.append("rect").attr("width",legendWidth).attr("height",legendHeight).style("fill","url(#legend-gradient)");
  legendGroup.append("text").attr("x",legendWidth/2).attr("y",-10).attr("font-size","12px").attr("text-anchor","middle").text("Rating (relative)");

   

  /* ==========================
     Annotations
     ========================== */
  function updateAnnotations({category, skin, maxPrice, filtered}){
    const panel = ensurePanel();
    const head = panel.select("#anno-head");
    const tip  = panel.select("#anno-tip");
    const budg = panel.select("#anno-budget");
    const comp = panel.select("#anno-compare");

    panel.attr("hidden", null); // show panel

    if (skin==="All" || category==="All" || !filtered?.length){
      panel.attr("hidden", true);
      head.text(""); tip.text(""); budg.text(""); comp.html("");
      return;
    }
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

  /* ==========================
     Update / render
     ========================== */
  function updateChart(){
    const category=d3.select("#categorySelect").property("value");
    const skin=d3.select("#skinSelect").property("value");
    const maxPrice=+d3.select("#priceSlider").property("value");
    d3.select("#priceLabel").text(money(maxPrice));

    let filtered=data.filter(d=>(category==="All"||d.Label===category)&&(skin==="All"||d[skin]===1)&&d.price<=maxPrice)
                     .sort((a,b)=>d3.descending(a.rank,b.rank)).slice(0,20);

    // color scale
    let rMin=d3.min(filtered,d=>d.rank), rMax=d3.max(filtered,d=>d.rank);
    if (!(rMin>=0) || !(rMax>=0)) { rMin=3.0; rMax=5.0; }
    else if (rMin===rMax) { rMin=Math.max(0,rMin-0.2); rMax=Math.min(5,rMax+0.2); }
    const color=d3.scaleSequential(d3.interpolateRdYlGn).domain([rMin,rMax]);

    // legend stops
    const stops=legendGradient.selectAll("stop").data(d3.ticks(0,1,10));
    stops.enter().append("stop").merge(stops).attr("offset",d=>`${d*100}%`).attr("stop-color",d=>d3.interpolateRdYlGn(d));
    stops.exit().remove();
    legendGroup.selectAll(".legend-min,.legend-max").remove();
    legendGroup.append("text").attr("class","legend-min").attr("x",0).attr("y",-2).attr("font-size","10px").text(rMin.toFixed(1));
    legendGroup.append("text").attr("class","legend-max").attr("x",legendWidth).attr("y",-2).attr("font-size","10px").attr("text-anchor","end").text(rMax.toFixed(1));

    // x scale
    const maxR=d3.max(filtered,d=>size(d.price))||60;
    const [minP,maxP]=d3.extent(filtered,d=>d.price);
    const pad=(maxP-minP)*0.1 || 10;
    const xScale=d3.scaleLinear().domain([minP-pad, maxP+pad]).range([maxR+20, width-maxR-40]);

    /* === GRIDLINES behind bubbles (own layer) === */
    const ticks=xScale.ticks(6);
    const lines=gridG.selectAll("line.vgrid").data(ticks, d=>d);
    lines.enter().append("line")
      .attr("class","vgrid")
      .attr("y1", axisY - gridHeight).attr("y2", axisY)
      .attr("stroke", "#e5e7eb").attr("stroke-width",1)
      .merge(lines)
      .attr("x1", d=>xScale(d)).attr("x2", d=>xScale(d));
    lines.exit().remove();

    // keep z-order correct every update
    gridG.lower();
    bubbleG.raise();
    labelG.raise();
    axisG.raise();

    /* === Axis (no tick lines) + centered label + arrow on domain === */
    const axis = d3.axisBottom(xScale).ticks(6).tickFormat(d3.format("$~s")).tickSize(0);
    axisG.attr("transform",`translate(0,${axisY})`).call(axis);

    axisG.select(".domain")
      .attr("stroke","#333")
      .attr("stroke-width",1.5)
      .attr("stroke-linecap","butt")
      .attr("marker-end","url(#axis-arrow)");

    axisG.selectAll(".price-label")
      .data([0])
      .join("text")
        .attr("class","price-label")
        .attr("x",(xScale.range()[0]+xScale.range()[1])/2)
        .attr("y",26)
        .attr("text-anchor","middle")
        .attr("fill","#333")
        .style("font-size","12px")
        .style("pointer-events","none")
        .text("Price");

    // simulation
    filtered.forEach(d=>{ d.fx=xScale(d.price); if(!isFinite(d.y)) d.y=height/2; });
    d3.forceSimulation(filtered)
      .alphaDecay(0.05)
      .force("collision", d3.forceCollide().radius(d=>size(d.price)+3))
      .force("x", d3.forceX(d=>xScale(d.price)).strength(0.4))
      .force("y", d3.forceY(height/2).strength(0.12))
      .on("tick", ()=>{
        const [x0,x1]=xScale.range();
        const clampX=x=>Math.max(x0,Math.min(x1,x));
        svg.selectAll("circle").attr("cx", d=>clampX(d.fx)).attr("cy", d=>d.y);
        svg.selectAll("g.brand-label").attr("transform", d=>`translate(${clampX(d.fx)},${d.y})`);
      });

    // bubbles — ring hover (no blue fill)
    const node=bubbleG.selectAll("circle").data(filtered, d=>d.name);
    node.enter().append("circle")
      .attr("r", d=>size(d.price))
      .attr("fill", d=>color(d.rank))
      .attr("stroke","#333").attr("stroke-width",1).attr("opacity",0.95).attr("cursor","pointer")
      .on("mouseover", function(event,d){
        d3.select(this).raise().transition().duration(150)
          .attr("r", size(d.price)*1.08)
          .attr("stroke","#3B82F6").attr("stroke-width",4);
        d3.select("#tooltip").style("opacity",1)
          .html(`<strong>${d.name}</strong><br/>Brand: ${d.brand}<br/>Category: ${d.Label}<br/>${money(d.price)}<br/>⭐ ${d.rank.toFixed(2)}<br/>Skin Types: ${["Combination","Dry","Normal","Oily","Sensitive"].filter(s=>d[s]===1).join(", ")}`)
          .style("left",(event.pageX+10)+"px").style("top",(event.pageY-28)+"px");
      })
      .on("mouseout", function(){
        d3.select(this).transition().duration(180)
          .attr("r", d=>size(d.price))
          .attr("stroke","#333").attr("stroke-width",1);
        d3.select("#tooltip").style("opacity",0);
      })
      .merge(node)
      .transition().duration(500)
      .attr("r", d=>size(d.price))
      .attr("fill", d=>color(d.rank));
    node.exit().remove();

    // labels
    const lab=labelG.selectAll("g.brand-label").data(filtered, d=>d.name);
    lab.exit().remove();
    const enter=lab.enter().append("g").attr("class","brand-label").attr("pointer-events","none");
    enter.append("text").attr("class","label-halo").attr("text-anchor","middle").attr("dominant-baseline","middle");
    enter.append("text").attr("class","label-text").attr("text-anchor","middle").attr("dominant-baseline","middle");
    enter.merge(lab).each(function(d){
      const g=d3.select(this);
      const diam=2*size(d.price);
      const fs=Math.min(10+0.04*diam,16);
      g.select(".label-halo").text(d.brand).attr("font-size",fs).attr("stroke","#fff").attr("stroke-width",3).attr("paint-order","stroke");
      g.select(".label-text").text(d.brand).attr("font-size",fs).attr("fill","#111");
    });

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



