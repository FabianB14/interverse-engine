/**
 * A gentle, cyclic weather + season clock. Weather changes every ~40s;
 * seasons every ~4 minutes. Rain auto-waters the whole farm, so the loop
 * stays relaxing rather than demanding.
 */
export type Weather = 'sunny' | 'cloudy' | 'rain' | 'storm';
export type Season = 'spring' | 'summer' | 'fall' | 'winter';

export const SEASONS: Season[] = ['spring', 'summer', 'fall', 'winter'];

export const WEATHER_ICON: Record<Weather, string> = {
  sunny: '☀️',
  cloudy: '⛅',
  rain: '🌧️',
  storm: '⛈️',
};

export const SEASON_ICON: Record<Season, string> = {
  spring: '🌱',
  summer: '🌻',
  fall: '🍂',
  winter: '❄️',
};

const WEATHER_EVERY = 40; // seconds
const SEASON_EVERY = 240; // seconds

/** Weather odds shift a little by season (more rain in spring, dry summers). */
const WEATHER_TABLE: Record<Season, Weather[]> = {
  spring: ['sunny', 'cloudy', 'rain', 'rain', 'cloudy', 'storm'],
  summer: ['sunny', 'sunny', 'sunny', 'cloudy', 'rain', 'storm'],
  fall: ['cloudy', 'cloudy', 'rain', 'sunny', 'rain', 'storm'],
  winter: ['cloudy', 'cloudy', 'sunny', 'rain', 'storm', 'cloudy'],
};

export interface WeatherState {
  season: Season;
  weather: Weather;
  /** seconds elapsed in the whole clock (persisted). */
  t: number;
}

export function seasonAt(t: number): Season {
  return SEASONS[Math.floor(t / SEASON_EVERY) % SEASONS.length] as Season;
}

export function weatherAt(t: number): Weather {
  const season = seasonAt(t);
  const table = WEATHER_TABLE[season];
  // Deterministic-ish per weather slot so it's stable across reloads.
  const slot = Math.floor(t / WEATHER_EVERY);
  const hash = (slot * 2654435761) >>> 0;
  return table[hash % table.length] as Weather;
}

export function isWet(w: Weather): boolean {
  return w === 'rain' || w === 'storm';
}

export function computeWeather(t: number): WeatherState {
  return { season: seasonAt(t), weather: weatherAt(t), t };
}
