// 16 venues of the 2026 FIFA World Cup (USA · Canada · Mexico).
// state = US state / Canadian province / Mexican state.

export interface StadiumSeed {
  name: string;
  city: string;
  state: string;
  country: string;
}

export const WC2026_STADIUMS: StadiumSeed[] = [
  // ── United States (11) ──
  { name: 'MetLife Stadium', city: 'East Rutherford', state: 'New Jersey', country: 'Estados Unidos' },
  { name: 'AT&T Stadium', city: 'Arlington', state: 'Texas', country: 'Estados Unidos' },
  { name: 'NRG Stadium', city: 'Houston', state: 'Texas', country: 'Estados Unidos' },
  { name: 'Mercedes-Benz Stadium', city: 'Atlanta', state: 'Geórgia', country: 'Estados Unidos' },
  { name: 'Hard Rock Stadium', city: 'Miami Gardens', state: 'Flórida', country: 'Estados Unidos' },
  { name: 'Gillette Stadium', city: 'Foxborough', state: 'Massachusetts', country: 'Estados Unidos' },
  { name: 'Lincoln Financial Field', city: 'Filadélfia', state: 'Pensilvânia', country: 'Estados Unidos' },
  { name: 'Lumen Field', city: 'Seattle', state: 'Washington', country: 'Estados Unidos' },
  { name: "Levi's Stadium", city: 'Santa Clara', state: 'Califórnia', country: 'Estados Unidos' },
  { name: 'SoFi Stadium', city: 'Inglewood', state: 'Califórnia', country: 'Estados Unidos' },
  { name: 'Arrowhead Stadium', city: 'Kansas City', state: 'Missouri', country: 'Estados Unidos' },

  // ── Canada (2) ──
  { name: 'BMO Field', city: 'Toronto', state: 'Ontário', country: 'Canadá' },
  { name: 'BC Place', city: 'Vancouver', state: 'Colúmbia Britânica', country: 'Canadá' },

  // ── Mexico (3) ──
  { name: 'Estádio Azteca', city: 'Cidade do México', state: 'Cidade do México', country: 'México' },
  { name: 'Estádio Akron', city: 'Guadalajara', state: 'Jalisco', country: 'México' },
  { name: 'Estádio BBVA', city: 'Monterrey', state: 'Nuevo León', country: 'México' },
];
