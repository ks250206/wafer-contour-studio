export interface PointProps {
  no: number;
  x: number;
  y: number;
  value: Map<string, number>;
}

export interface Points {
  points: PointProps[];
}
