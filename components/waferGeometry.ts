export const ORIFLA_LENGTH_MM = 32.5;
export const WAFER_MAP_PADDING = 22;

export const getWaferFlatY = (diameter: number, flatLength: number = ORIFLA_LENGTH_MM) => {
  const radius = diameter / 2;
  const halfFlat = flatLength / 2;
  return -Math.sqrt(radius ** 2 - halfFlat ** 2);
};

export const isInsideWafer = (
  x: number,
  y: number,
  diameter: number,
  flatLength: number = ORIFLA_LENGTH_MM,
) => {
  const radius = diameter / 2;
  const flatY = getWaferFlatY(diameter, flatLength);
  return x * x + y * y <= radius ** 2 && y >= flatY;
};

export const getWaferSvgPath = (
  centerX: number,
  centerY: number,
  pxPerUnitX: number,
  pxPerUnitY: number,
  diameter: number,
  flatLength: number = ORIFLA_LENGTH_MM,
) => {
  const radius = diameter / 2;
  const halfFlat = flatLength / 2;
  const flatY = getWaferFlatY(diameter, flatLength);
  const startAngle = Math.atan2(flatY, halfFlat);
  const endAngle = Math.atan2(flatY, -halfFlat) + Math.PI * 2;
  const segments = 180;

  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + ((endAngle - startAngle) * index) / segments;
    const x = centerX + Math.cos(angle) * radius * pxPerUnitX;
    const y = centerY - Math.sin(angle) * radius * pxPerUnitY;
    return `${x} ${y}`;
  });

  return `M ${points.join(" L ")} Z`;
};
