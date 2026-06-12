// 2026 FIFA World Cup — tournament + full 104-match schedule.
// Source: official FIFA schedule grid (Feb 2024) + final draw (Dec 5, 2025), cross-checked
// against Wikipedia (draw / knockout stage) and ESPN. See bolao-2026-docs.
//
// Teams are referenced by ISO alpha-2 countryCode (links to seeded national teams).
// Knockout matches (73-104) have no teams yet — homeLabel/awayLabel hold the pt-BR bracket slot.
//
// CAVEATS (see notes in commit / docs):
//  - Group-stage kickoff times are the venue-local times; some derived by TZ conversion (±minutes).
//  - Knockout kickoff times are PLACEHOLDERS (timeTbd=true): exact local times not confirmed pre-draw.

export const WC2026_TOURNAMENT = {
  name: 'Copa do Mundo FIFA 2026',
  startDate: '2026-06-11',
  endDate: '2026-07-19',
  status: 'ONGOING' as const,
};

// Venue local UTC offset during the tournament (June–July 2026).
// US ET=-4, US CT=-5, US/Canada MT/PT handled per venue; Mexico has no DST (Central Mexico = -6).
export const VENUE_UTC_OFFSET: Record<string, string> = {
  'MetLife Stadium': '-04:00',
  'Gillette Stadium': '-04:00',
  'Lincoln Financial Field': '-04:00',
  'Mercedes-Benz Stadium': '-04:00',
  'Hard Rock Stadium': '-04:00',
  'BMO Field': '-04:00',
  'NRG Stadium': '-05:00',
  'AT&T Stadium': '-05:00',
  'Arrowhead Stadium': '-05:00',
  'Lumen Field': '-07:00',
  "Levi's Stadium": '-07:00',
  'SoFi Stadium': '-07:00',
  'BC Place': '-07:00',
  'Estadio Azteca': '-06:00',
  'Estadio Akron': '-06:00',
  'Estadio BBVA': '-06:00',
};

export interface MatchSeed {
  matchNumber: number;
  date: string; // YYYY-MM-DD (venue-local)
  time: string; // HH:mm (venue-local)
  timeTbd?: boolean; // true → time is a placeholder (knockout)
  venue: string; // canonical seeded stadium name
  phaseLabel: string;
  group: string | null;
  homeCode: string | null;
  awayCode: string | null;
  homeLabel: string | null; // pt-BR bracket slot when team is TBD
  awayLabel: string | null;
}

const GS = 'Fase de Grupos';
const R32 = '16-avos de final';
const R16 = 'Oitavas de final';
const QF = 'Quartas de final';
const SF = 'Semifinais';
const TP = 'Disputa de 3º lugar';
const FN = 'Final';

// Group-stage match: teams known.
const g = (
  matchNumber: number,
  date: string,
  time: string,
  venue: string,
  group: string,
  homeCode: string,
  awayCode: string,
): MatchSeed => ({
  matchNumber,
  date,
  time,
  venue,
  phaseLabel: GS,
  group,
  homeCode,
  awayCode,
  homeLabel: null,
  awayLabel: null,
});

// Knockout match: teams TBD (placeholder time).
const k = (
  matchNumber: number,
  date: string,
  venue: string,
  phaseLabel: string,
  homeLabel: string,
  awayLabel: string,
): MatchSeed => ({
  matchNumber,
  date,
  time: '18:00',
  timeTbd: true,
  venue,
  phaseLabel,
  group: null,
  homeCode: null,
  awayCode: null,
  homeLabel,
  awayLabel,
});

export const WC2026_MATCHES: MatchSeed[] = [
  // ── Group stage (1–72) ──
  g(1, '2026-06-11', '12:00', 'Estadio Azteca', 'A', 'MX', 'ZA'),
  g(2, '2026-06-11', '19:00', 'Estadio Akron', 'A', 'KR', 'CZ'),
  g(3, '2026-06-12', '15:00', 'BMO Field', 'B', 'CA', 'BA'),
  g(4, '2026-06-12', '18:00', 'SoFi Stadium', 'D', 'US', 'PY'),
  g(5, '2026-06-13', '12:00', "Levi's Stadium", 'B', 'QA', 'CH'),
  g(6, '2026-06-13', '18:00', 'MetLife Stadium', 'C', 'BR', 'MA'),
  g(7, '2026-06-13', '21:00', 'Gillette Stadium', 'C', 'HT', 'GB-SCT'),
  g(8, '2026-06-13', '21:00', 'BC Place', 'D', 'AU', 'TR'),
  g(9, '2026-06-14', '12:00', 'NRG Stadium', 'E', 'DE', 'CW'),
  g(10, '2026-06-14', '15:00', 'AT&T Stadium', 'F', 'NL', 'JP'),
  g(11, '2026-06-14', '19:00', 'Lincoln Financial Field', 'E', 'CI', 'EC'),
  g(12, '2026-06-14', '20:00', 'Estadio BBVA', 'F', 'SE', 'TN'),
  g(13, '2026-06-15', '12:00', 'Mercedes-Benz Stadium', 'H', 'ES', 'CV'),
  g(14, '2026-06-15', '15:00', 'Lumen Field', 'G', 'BE', 'EG'),
  g(15, '2026-06-15', '18:00', 'Hard Rock Stadium', 'H', 'SA', 'UY'),
  g(16, '2026-06-15', '21:00', 'SoFi Stadium', 'G', 'IR', 'NZ'),
  g(17, '2026-06-16', '15:00', 'MetLife Stadium', 'I', 'FR', 'SN'),
  g(18, '2026-06-16', '18:00', 'Gillette Stadium', 'I', 'IQ', 'NO'),
  g(19, '2026-06-16', '20:00', 'Arrowhead Stadium', 'J', 'AR', 'DZ'),
  g(20, '2026-06-16', '21:00', "Levi's Stadium", 'J', 'AT', 'JO'),
  g(21, '2026-06-17', '12:00', 'NRG Stadium', 'K', 'PT', 'CD'),
  g(22, '2026-06-17', '15:00', 'AT&T Stadium', 'L', 'GB-ENG', 'HR'),
  g(23, '2026-06-17', '19:00', 'BMO Field', 'L', 'GH', 'PA'),
  g(24, '2026-06-17', '20:00', 'Estadio Azteca', 'K', 'UZ', 'CO'),
  g(25, '2026-06-18', '12:00', 'Mercedes-Benz Stadium', 'A', 'CZ', 'ZA'),
  g(26, '2026-06-18', '12:00', 'SoFi Stadium', 'B', 'CH', 'BA'),
  g(27, '2026-06-18', '15:00', 'BC Place', 'B', 'CA', 'QA'),
  g(28, '2026-06-18', '21:00', 'Estadio Akron', 'A', 'MX', 'KR'),
  g(29, '2026-06-19', '12:00', 'Lumen Field', 'D', 'US', 'AU'),
  g(30, '2026-06-19', '18:00', 'Gillette Stadium', 'C', 'GB-SCT', 'MA'),
  g(31, '2026-06-19', '21:00', 'Lincoln Financial Field', 'C', 'BR', 'HT'),
  g(32, '2026-06-19', '21:00', "Levi's Stadium", 'D', 'TR', 'PY'),
  g(33, '2026-06-20', '12:00', 'NRG Stadium', 'F', 'NL', 'SE'),
  g(34, '2026-06-20', '15:00', 'BMO Field', 'E', 'DE', 'CI'),
  g(35, '2026-06-20', '19:00', 'Arrowhead Stadium', 'E', 'EC', 'CW'),
  g(36, '2026-06-20', '22:00', 'Estadio BBVA', 'F', 'TN', 'JP'),
  g(37, '2026-06-21', '12:00', 'Mercedes-Benz Stadium', 'H', 'ES', 'SA'),
  g(38, '2026-06-21', '12:00', 'SoFi Stadium', 'G', 'BE', 'IR'),
  g(39, '2026-06-21', '18:00', 'Hard Rock Stadium', 'H', 'UY', 'CV'),
  g(40, '2026-06-21', '18:00', 'BC Place', 'G', 'NZ', 'EG'),
  g(41, '2026-06-22', '12:00', 'AT&T Stadium', 'J', 'AR', 'AT'),
  g(42, '2026-06-22', '17:00', 'Lincoln Financial Field', 'I', 'FR', 'IQ'),
  g(43, '2026-06-22', '20:00', 'MetLife Stadium', 'I', 'NO', 'SN'),
  g(44, '2026-06-22', '20:00', "Levi's Stadium", 'J', 'JO', 'DZ'),
  g(45, '2026-06-23', '12:00', 'NRG Stadium', 'K', 'PT', 'UZ'),
  g(46, '2026-06-23', '16:00', 'Gillette Stadium', 'L', 'GB-ENG', 'GH'),
  g(47, '2026-06-23', '19:00', 'BMO Field', 'L', 'PA', 'HR'),
  g(48, '2026-06-23', '20:00', 'Estadio Akron', 'K', 'CO', 'CD'),
  g(49, '2026-06-24', '12:00', 'BC Place', 'B', 'CH', 'CA'),
  g(50, '2026-06-24', '12:00', 'Lumen Field', 'B', 'BA', 'QA'),
  g(51, '2026-06-24', '18:00', 'Hard Rock Stadium', 'C', 'GB-SCT', 'BR'),
  g(52, '2026-06-24', '18:00', 'Mercedes-Benz Stadium', 'C', 'MA', 'HT'),
  g(53, '2026-06-24', '20:00', 'Estadio Azteca', 'A', 'CZ', 'MX'),
  g(54, '2026-06-24', '20:00', 'Estadio BBVA', 'A', 'ZA', 'KR'),
  g(55, '2026-06-25', '16:00', 'MetLife Stadium', 'E', 'EC', 'DE'),
  g(56, '2026-06-25', '16:00', 'Lincoln Financial Field', 'E', 'CW', 'CI'),
  g(57, '2026-06-25', '18:00', 'AT&T Stadium', 'F', 'JP', 'SE'),
  g(58, '2026-06-25', '18:00', 'Arrowhead Stadium', 'F', 'TN', 'NL'),
  g(59, '2026-06-25', '19:00', 'SoFi Stadium', 'D', 'TR', 'US'),
  g(60, '2026-06-25', '19:00', "Levi's Stadium", 'D', 'PY', 'AU'),
  g(61, '2026-06-26', '15:00', 'Gillette Stadium', 'I', 'NO', 'FR'),
  g(62, '2026-06-26', '15:00', 'BMO Field', 'I', 'SN', 'IQ'),
  g(63, '2026-06-26', '19:00', 'NRG Stadium', 'H', 'CV', 'SA'),
  g(64, '2026-06-26', '20:00', 'Lumen Field', 'H', 'UY', 'ES'),
  g(65, '2026-06-26', '20:00', 'Estadio BBVA', 'G', 'EG', 'IR'),
  g(66, '2026-06-26', '20:00', 'BC Place', 'G', 'NZ', 'BE'),
  g(67, '2026-06-27', '17:00', 'MetLife Stadium', 'L', 'PA', 'GB-ENG'),
  g(68, '2026-06-27', '17:00', 'Lincoln Financial Field', 'L', 'HR', 'GH'),
  g(69, '2026-06-27', '19:30', 'Hard Rock Stadium', 'K', 'CO', 'PT'),
  g(70, '2026-06-27', '19:30', 'Mercedes-Benz Stadium', 'K', 'CD', 'UZ'),
  g(71, '2026-06-27', '20:00', 'Arrowhead Stadium', 'J', 'DZ', 'AT'),
  g(72, '2026-06-27', '20:00', 'AT&T Stadium', 'J', 'JO', 'AR'),

  // ── Round of 32 (73–88) ──
  k(73, '2026-06-28', 'SoFi Stadium', R32, '2º Grupo A', '2º Grupo B'),
  k(74, '2026-06-29', 'Gillette Stadium', R32, 'Vencedor Grupo E', '3º (A/B/C/D/F)'),
  k(75, '2026-06-29', 'Estadio BBVA', R32, 'Vencedor Grupo F', '2º Grupo C'),
  k(76, '2026-06-29', 'NRG Stadium', R32, 'Vencedor Grupo C', '2º Grupo F'),
  k(77, '2026-06-30', 'MetLife Stadium', R32, 'Vencedor Grupo I', '3º (C/D/F/G/H)'),
  k(78, '2026-06-30', 'AT&T Stadium', R32, '2º Grupo E', '2º Grupo I'),
  k(79, '2026-06-30', 'Estadio Azteca', R32, 'Vencedor Grupo A', '3º (C/E/F/H/I)'),
  k(80, '2026-07-01', 'Mercedes-Benz Stadium', R32, 'Vencedor Grupo L', '3º (E/H/I/J/K)'),
  k(81, '2026-07-01', "Levi's Stadium", R32, 'Vencedor Grupo D', '3º (B/E/F/I/J)'),
  k(82, '2026-07-01', 'Lumen Field', R32, 'Vencedor Grupo G', '3º (A/E/H/I/J)'),
  k(83, '2026-07-02', 'BMO Field', R32, '2º Grupo K', '2º Grupo L'),
  k(84, '2026-07-02', 'SoFi Stadium', R32, 'Vencedor Grupo H', '2º Grupo J'),
  k(85, '2026-07-02', 'BC Place', R32, 'Vencedor Grupo B', '3º (E/F/G/I/J)'),
  k(86, '2026-07-03', 'Hard Rock Stadium', R32, 'Vencedor Grupo J', '2º Grupo H'),
  k(87, '2026-07-03', 'Arrowhead Stadium', R32, 'Vencedor Grupo K', '3º (D/E/I/J/L)'),
  k(88, '2026-07-03', 'AT&T Stadium', R32, '2º Grupo D', '2º Grupo G'),

  // ── Round of 16 (89–96) ──
  k(89, '2026-07-04', 'Lincoln Financial Field', R16, 'Vencedor Jogo 74', 'Vencedor Jogo 77'),
  k(90, '2026-07-04', 'NRG Stadium', R16, 'Vencedor Jogo 73', 'Vencedor Jogo 75'),
  k(91, '2026-07-05', 'MetLife Stadium', R16, 'Vencedor Jogo 76', 'Vencedor Jogo 78'),
  k(92, '2026-07-05', 'Estadio Azteca', R16, 'Vencedor Jogo 79', 'Vencedor Jogo 80'),
  k(93, '2026-07-06', 'AT&T Stadium', R16, 'Vencedor Jogo 83', 'Vencedor Jogo 84'),
  k(94, '2026-07-06', 'Lumen Field', R16, 'Vencedor Jogo 81', 'Vencedor Jogo 82'),
  k(95, '2026-07-07', 'Mercedes-Benz Stadium', R16, 'Vencedor Jogo 86', 'Vencedor Jogo 88'),
  k(96, '2026-07-07', 'BC Place', R16, 'Vencedor Jogo 85', 'Vencedor Jogo 87'),

  // ── Quarter-finals (97–100) ──
  k(97, '2026-07-09', 'Gillette Stadium', QF, 'Vencedor Jogo 89', 'Vencedor Jogo 90'),
  k(98, '2026-07-10', 'SoFi Stadium', QF, 'Vencedor Jogo 93', 'Vencedor Jogo 94'),
  k(99, '2026-07-11', 'Hard Rock Stadium', QF, 'Vencedor Jogo 91', 'Vencedor Jogo 92'),
  k(100, '2026-07-11', 'Arrowhead Stadium', QF, 'Vencedor Jogo 95', 'Vencedor Jogo 96'),

  // ── Semi-finals (101–102) ──
  k(101, '2026-07-14', 'AT&T Stadium', SF, 'Vencedor Jogo 97', 'Vencedor Jogo 98'),
  k(102, '2026-07-15', 'Mercedes-Benz Stadium', SF, 'Vencedor Jogo 99', 'Vencedor Jogo 100'),

  // ── Third place (103) & Final (104) ──
  k(103, '2026-07-18', 'Hard Rock Stadium', TP, 'Perdedor Jogo 101', 'Perdedor Jogo 102'),
  k(104, '2026-07-19', 'MetLife Stadium', FN, 'Vencedor Jogo 101', 'Vencedor Jogo 102'),
];
