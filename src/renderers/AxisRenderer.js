import * as d3 from "d3";

export function renderAxis({
  svg,
  scale,
  orientation,
  width,
  height
}) {

  const axisX = 50;

  const domain = scale.domain();
  const domainWidth = Math.abs(domain[1] - domain[0]);

  // ---- UNIT SWITCHING ----
  let unit = "Ma";
  let conversion = 1;

  if (domainWidth < 0.001) {        // < 1 ka
    unit = "yr";
    conversion = 1_000_000;
  }
  else if (domainWidth < 1) {       // < 1 Ma
    unit = "ka";
    conversion = 1_000;
  }

  const tickCount = 12;
  const ticks = scale.ticks(tickCount);

  // ---- DRAW AXIS LINE ----
  const axisLine = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "line"
  );

  if (orientation === "vertical") {
    axisLine.setAttribute("x1", axisX);
    axisLine.setAttribute("x2", axisX);
    axisLine.setAttribute("y1", 0);
    axisLine.setAttribute("y2", height);
  } else {
    axisLine.setAttribute("x1", 0);
    axisLine.setAttribute("x2", width);
    axisLine.setAttribute("y1", axisX);
    axisLine.setAttribute("y2", axisX);
  }

  axisLine.setAttribute("stroke", "black");
  axisLine.setAttribute("stroke-width", 2);
  svg.appendChild(axisLine);

  // ---- DRAW TICKS ----
  ticks.forEach(age => {

    const pos = scale(age);

    const tick = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );

    if (orientation === "vertical") {
      tick.setAttribute("x1", axisX - 8);
      tick.setAttribute("x2", axisX + 8);
      tick.setAttribute("y1", pos);
      tick.setAttribute("y2", pos);
    } else {
      tick.setAttribute("x1", pos);
      tick.setAttribute("x2", pos);
      tick.setAttribute("y1", axisX - 8);
      tick.setAttribute("y2", axisX + 8);
    }

    tick.setAttribute("stroke", "black");
    svg.appendChild(tick);

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );

    if (orientation === "vertical") {
      label.setAttribute("x", axisX + 15);
      label.setAttribute("y", pos + 4);
    } else {
      label.setAttribute("x", pos);
      label.setAttribute("y", axisX + 20);
      label.setAttribute("text-anchor", "middle");
    }

    label.setAttribute("font-size", "10");

    const convertedValue = age * conversion;

    if (unit === "Ma") {
      label.textContent = convertedValue.toFixed(2) + " Ma";
    }
    else if (unit === "ka") {
      label.textContent = convertedValue.toFixed(1) + " ka";
    }
    else {
      label.textContent = Math.round(convertedValue) + " yr";
    }

    svg.appendChild(label);
  });

}
