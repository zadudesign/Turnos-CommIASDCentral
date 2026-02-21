export type ServiceType = "Domingo" | "Miércoles" | "Sábado Mañana" | "Sábado Tarde";

export type RoleFunction = 
  | "Consola" 
  | "Transmisión" 
  | "Proyección" 
  | "Medios Digitales" 
  | "Coordinación";

export interface Volunteer {
  id: number;
  name: string;
  functions: RoleFunction[];
  availability: ServiceType[];
  restrictions: string[];
  total_score: number;
}

export interface ScoreRecord {
  id: number;
  volunteer_id: number;
  puntualidad: number;
  responsabilidad: number;
  orden: number;
  date: string;
  week_start: string;
}

export interface ScheduleAssignment {
  id?: number;
  week_start: string;
  service_type: ServiceType;
  function_name: RoleFunction;
  volunteer_id: number | null;
}

export const ALL_FUNCTIONS: RoleFunction[] = [
  "Consola",
  "Transmisión",
  "Proyección",
  "Medios Digitales",
  "Coordinación"
];

export const ALL_SERVICES: ServiceType[] = [
  "Domingo",
  "Miércoles",
  "Sábado Mañana",
  "Sábado Tarde"
];

export const ADMIN_PIN = "2025";

export const COLORS = {
  primary: "#2e4f76",
  secondary: "#0f1e3f",
  accent: "#ce7e27",
  bg: "#d6d6d6"
};
