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
  { name: 'MetLife Stadium', city: 'East Rutherford', state: 'New Jersey', country: 'United States' },
  { name: 'AT&T Stadium', city: 'Arlington', state: 'Texas', country: 'United States' },
  { name: 'NRG Stadium', city: 'Houston', state: 'Texas', country: 'United States' },
  { name: 'Mercedes-Benz Stadium', city: 'Atlanta', state: 'Georgia', country: 'United States' },
  { name: 'Hard Rock Stadium', city: 'Miami Gardens', state: 'Florida', country: 'United States' },
  { name: 'Gillette Stadium', city: 'Foxborough', state: 'Massachusetts', country: 'United States' },
  { name: 'Lincoln Financial Field', city: 'Philadelphia', state: 'Pennsylvania', country: 'United States' },
  { name: 'Lumen Field', city: 'Seattle', state: 'Washington', country: 'United States' },
  { name: "Levi's Stadium", city: 'Santa Clara', state: 'California', country: 'United States' },
  { name: 'SoFi Stadium', city: 'Inglewood', state: 'California', country: 'United States' },
  { name: 'Arrowhead Stadium', city: 'Kansas City', state: 'Missouri', country: 'United States' },

  // ── Canada (2) ──
  { name: 'BMO Field', city: 'Toronto', state: 'Ontario', country: 'Canada' },
  { name: 'BC Place', city: 'Vancouver', state: 'British Columbia', country: 'Canada' },

  // ── Mexico (3) ──
  { name: 'Estadio Azteca', city: 'Mexico City', state: 'Mexico City', country: 'Mexico' },
  { name: 'Estadio Akron', city: 'Guadalajara', state: 'Jalisco', country: 'Mexico' },
  { name: 'Estadio BBVA', city: 'Monterrey', state: 'Nuevo León', country: 'Mexico' },
];
