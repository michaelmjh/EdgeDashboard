/* weather.js - Duck Dashboard
   Weather provider abstraction. Every provider returns the same normalised
   shape, so the widget never cares where the data came from:

   {
     location, temp, feelsLike, humidity, wind, high, low,   (°C, %, mph)
     condition,  one of: clear, partly, cloudy, rain, snow, storm, fog
     description, isDay, provider, demo, fetchedAt
   }

   Providers:
   - openweathermap : needs a free API key (Settings > Weather)
   - openmeteo      : free, no key needed
   - mock           : demo data, used automatically when no key is set

   To add a provider, call WeatherService.registerProvider(id, { label,
   needsKey, fetch(location, prefs) }) and return the shape above. */

(function () {
  'use strict';

  const PRESETS = {
    glasgow: { name: 'Glasgow', lat: 55.8642, lon: -4.2518, q: 'Glasgow,GB' },
    london: { name: 'London', lat: 51.5072, lon: -0.1276, q: 'London,GB' },
    edinburgh: { name: 'Edinburgh', lat: 55.9533, lon: -3.1883, q: 'Edinburgh,GB' }
  };

  const CONDITION_LABELS = {
    clear: 'Clear',
    partly: 'Partly cloudy',
    cloudy: 'Cloudy',
    rain: 'Rain',
    snow: 'Snow',
    storm: 'Thunderstorm',
    fog: 'Fog'
  };

  /* Friendly error with a code the widget can turn into a nice message. */
  class WeatherError extends Error {
    constructor(code) {
      super(code);
      this.code = code; // no-location, not-found, bad-key, network
    }
  }

  function resolveLocation(prefs) {
    if (prefs.location === 'custom') {
      const name = (prefs.custom || '').trim();
      if (!name) throw new WeatherError('no-location');
      return { name, q: name };
    }
    return PRESETS[prefs.location] || PRESETS.glasgow;
  }

  async function fetchJSON(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (res.status === 401) throw new WeatherError('bad-key');
      if (res.status === 404) throw new WeatherError('not-found');
      if (!res.ok) throw new WeatherError('network');
      return await res.json();
    } catch (err) {
      if (err instanceof WeatherError) throw err;
      throw new WeatherError('network');
    } finally {
      clearTimeout(timer);
    }
  }

  const round = (n) => Math.round(Number(n));
  const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /* ---------- Providers ---------- */

  const providers = {};

  function registerProvider(id, provider) {
    providers[id] = Object.assign({ id }, provider);
  }

  // OpenWeatherMap: current weather + 24h forecast for the daily high and low.
  function owmCondition(id) {
    if (id >= 200 && id < 300) return 'storm';
    if (id >= 300 && id < 600) return 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id >= 700 && id < 800) return 'fog';
    if (id === 800) return 'clear';
    if (id === 801 || id === 802) return 'partly';
    return 'cloudy';
  }

  registerProvider('openweathermap', {
    label: 'OpenWeatherMap (API key)',
    needsKey: true,
    async fetch(loc, prefs) {
      const params = new URLSearchParams({ units: 'metric', appid: prefs.apiKey.trim() });
      if (loc.lat != null) {
        params.set('lat', loc.lat);
        params.set('lon', loc.lon);
      } else {
        params.set('q', loc.q);
      }
      const base = 'https://api.openweathermap.org/data/2.5/';
      const [now, forecast] = await Promise.all([
        fetchJSON(base + 'weather?' + params),
        fetchJSON(base + 'forecast?' + params + '&cnt=8').catch(() => null)
      ]);

      // High and low for the location's local day.
      const tz = (now.timezone || 0) * 1000;
      const dayOf = (unix) => new Date(unix * 1000 + tz).toISOString().slice(0, 10);
      const today = dayOf(now.dt);
      const temps = [now.main.temp, now.main.temp_min, now.main.temp_max];
      if (forecast && Array.isArray(forecast.list)) {
        forecast.list.filter((f) => dayOf(f.dt) === today).forEach((f) => temps.push(f.main.temp_min, f.main.temp_max));
      }

      const w = (now.weather && now.weather[0]) || {};
      return {
        location: loc.lat != null ? loc.name : now.name || loc.name,
        temp: round(now.main.temp),
        feelsLike: round(now.main.feels_like),
        humidity: round(now.main.humidity),
        wind: round((now.wind ? now.wind.speed : 0) * 2.23694),
        high: round(Math.max(...temps)),
        low: round(Math.min(...temps)),
        condition: owmCondition(w.id || 803),
        description: capitalise(w.description) || CONDITION_LABELS[owmCondition(w.id || 803)],
        isDay: !(w.icon || '').endsWith('n')
      };
    }
  });

  // Open-Meteo: free and keyless. Custom places are geocoded first.
  function wmoCondition(code) {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'rain';
  }

  const WMO_LABELS = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail'
  };

  registerProvider('openmeteo', {
    label: 'Open-Meteo (free, no key)',
    needsKey: false,
    async fetch(loc) {
      let place = loc;
      if (place.lat == null) {
        const geo = await fetchJSON('https://geocoding-api.open-meteo.com/v1/search?' +
          new URLSearchParams({ name: loc.q, count: '1', language: 'en', format: 'json' }));
        const hit = geo.results && geo.results[0];
        if (!hit) throw new WeatherError('not-found');
        place = { name: hit.name, lat: hit.latitude, lon: hit.longitude };
      }
      const params = new URLSearchParams({
        latitude: place.lat,
        longitude: place.lon,
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
        daily: 'temperature_2m_max,temperature_2m_min',
        wind_speed_unit: 'mph',
        timezone: 'auto',
        forecast_days: '1'
      });
      const data = await fetchJSON('https://api.open-meteo.com/v1/forecast?' + params);
      const c = data.current;
      return {
        location: place.name,
        temp: round(c.temperature_2m),
        feelsLike: round(c.apparent_temperature),
        humidity: round(c.relative_humidity_2m),
        wind: round(c.wind_speed_10m),
        high: round(data.daily.temperature_2m_max[0]),
        low: round(data.daily.temperature_2m_min[0]),
        condition: wmoCondition(c.weather_code),
        description: WMO_LABELS[c.weather_code] || CONDITION_LABELS[wmoCondition(c.weather_code)],
        isDay: c.is_day === 1
      };
    }
  });

  // Demo data: stable for a given place and day, so it doesn't flicker.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const MOCK_BASE = {
    Glasgow: { condition: 'rain', temp: 9 },
    London: { condition: 'partly', temp: 13 },
    Edinburgh: { condition: 'cloudy', temp: 8 }
  };

  registerProvider('mock', {
    label: 'Demo data',
    needsKey: false,
    async fetch(loc) {
      const seed = hash(loc.name.toLowerCase() + new Date().toDateString());
      const conditions = ['clear', 'partly', 'cloudy', 'rain', 'snow', 'fog'];
      const base = MOCK_BASE[loc.name] || { condition: conditions[seed % conditions.length], temp: 6 + (seed % 14) };
      const temp = base.temp + ((seed >> 3) % 5) - 2;
      const hour = new Date().getHours();
      return {
        location: loc.name,
        temp,
        feelsLike: temp - 1 - ((seed >> 5) % 3),
        humidity: 60 + ((seed >> 7) % 30),
        wind: 5 + ((seed >> 9) % 15),
        high: temp + 2 + ((seed >> 11) % 3),
        low: temp - 3 - ((seed >> 13) % 3),
        condition: base.condition === 'snow' && temp > 3 ? 'rain' : base.condition,
        description: CONDITION_LABELS[base.condition === 'snow' && temp > 3 ? 'rain' : base.condition],
        isDay: hour >= 7 && hour < 19
      };
    }
  });

  /* ---------- Public API ---------- */

  async function getWeather(prefs) {
    const loc = resolveLocation(prefs);
    let providerId = providers[prefs.provider] ? prefs.provider : 'openweathermap';
    let provider = providers[providerId];
    let demo = providerId === 'mock';

    // No key yet: fall back to demo data instead of failing.
    if (provider.needsKey && !(prefs.apiKey || '').trim()) {
      providerId = 'mock';
      provider = providers.mock;
      demo = true;
    }

    const data = await provider.fetch(loc, prefs);
    return Object.assign(data, { provider: providerId, demo, fetchedAt: Date.now() });
  }

  /* Cache key: changes whenever a setting that affects the result changes. */
  function cacheKey(prefs) {
    return [prefs.provider, prefs.location, (prefs.custom || '').trim().toLowerCase(), (prefs.apiKey || '').trim() ? 'key' : 'nokey'].join('|');
  }

  /* ---------- Icons (inline SVG, no network) ---------- */

  const SUN = '<g class="wx-sun"><circle cx="32" cy="32" r="11"/>' +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) =>
      `<rect x="30.5" y="8" width="3" height="8" rx="1.5" transform="rotate(${a} 32 32)"/>`).join('') + '</g>';
  const MOON = '<path class="wx-moon" d="M38 12a20 20 0 1 0 14 30A17 17 0 0 1 38 12z"/>';
  const CLOUD = (dx = 0, dy = 0) =>
    `<path class="wx-cloud" transform="translate(${dx} ${dy})" d="M19 48h28a10 10 0 0 0 1-20 14 14 0 0 0-27-2A11 11 0 0 0 19 48z"/>`;
  const SMALL_SUN = '<g transform="translate(-8 -8) scale(.75)">' + SUN + '</g>';
  const SMALL_MOON = '<g transform="translate(-6 -6) scale(.7)">' + MOON + '</g>';

  function icon(condition, isDay = true) {
    let body;
    switch (condition) {
      case 'clear':
        body = isDay ? SUN : MOON;
        break;
      case 'partly':
        body = (isDay ? SMALL_SUN : SMALL_MOON) + CLOUD(2, 4);
        break;
      case 'rain':
        body = CLOUD(0, -4) + '<g class="wx-rain">' +
          [[22, 50], [32, 52], [42, 50]].map(([x, y]) =>
            `<rect x="${x}" y="${y}" width="3" height="9" rx="1.5" transform="rotate(15 ${x} ${y})"/>`).join('') + '</g>';
        break;
      case 'snow':
        body = CLOUD(0, -4) + '<g class="wx-snow">' +
          [[22, 54], [32, 57], [42, 54]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6"/>`).join('') + '</g>';
        break;
      case 'storm':
        body = CLOUD(0, -4) + '<path class="wx-bolt" d="M33 44l-7 11h6l-3 8 10-13h-6l3-6z"/>';
        break;
      case 'fog':
        body = CLOUD(0, -8) + '<g class="wx-fog">' +
          [46, 52, 58].map((y, i) => `<rect x="${14 + i * 3}" y="${y}" width="${36 - i * 4}" height="3" rx="1.5"/>`).join('') + '</g>';
        break;
      default:
        body = CLOUD(0, 0);
    }
    return `<svg class="wx-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  window.WeatherService = {
    PRESETS,
    WeatherError,
    providers,
    registerProvider,
    getWeather,
    cacheKey,
    icon,
    CACHE_TTL: 30 * 60 * 1000
  };
})();
