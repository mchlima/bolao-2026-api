// 16 sedes da Copa do Mundo FIFA 2026 (EUA · Canadá · México), em pt-BR.
// state = estado dos EUA / província canadense / estado mexicano.

export interface StadiumSeed {
  name: string;
  city: string;
  state: string;
  country: string;
}

export const WC2026_STADIUMS: StadiumSeed[] = [
  // ── Estados Unidos (11) ──
  { name: 'MetLife Stadium', city: 'East Rutherford', state: 'New Jersey', country: 'Estados Unidos' },
  { name: 'AT&T Stadium', city: 'Arlington', state: 'Texas', country: 'Estados Unidos' },
  { name: 'NRG Stadium', city: 'Houston', state: 'Texas', country: 'Estados Unidos' },
  { name: 'Mercedes-Benz Stadium', city: 'Atlanta', state: 'Georgia', country: 'Estados Unidos' },
  { name: 'Hard Rock Stadium', city: 'Miami Gardens', state: 'Florida', country: 'Estados Unidos' },
  { name: 'Gillette Stadium', city: 'Foxborough', state: 'Massachusetts', country: 'Estados Unidos' },
  { name: 'Lincoln Financial Field', city: 'Filadélfia', state: 'Pennsylvania', country: 'Estados Unidos' },
  { name: 'Lumen Field', city: 'Seattle', state: 'Washington', country: 'Estados Unidos' },
  { name: "Levi's Stadium", city: 'Santa Clara', state: 'California', country: 'Estados Unidos' },
  { name: 'SoFi Stadium', city: 'Inglewood', state: 'California', country: 'Estados Unidos' },
  { name: 'Arrowhead Stadium', city: 'Kansas City', state: 'Missouri', country: 'Estados Unidos' },

  // ── Canadá (2) ──
  { name: 'BMO Field', city: 'Toronto', state: 'Ontário', country: 'Canadá' },
  { name: 'BC Place', city: 'Vancouver', state: 'Colúmbia Britânica', country: 'Canadá' },

  // ── México (3) ──
  { name: 'Estádio Azteca', city: 'Cidade do México', state: 'Cidade do México', country: 'México' },
  { name: 'Estádio Akron', city: 'Guadalajara', state: 'Jalisco', country: 'México' },
  { name: 'Estádio BBVA', city: 'Monterrey', state: 'Nuevo León', country: 'México' },
];
