(function () {
  'use strict';

  var LAT = 45.9003, LON = 12.17, TZ = 'Europe/Rome';
  var NDAYS = 7, TTL = 30 * 60 * 1000, TIMEOUT = 10000, RETRIES = 2;
  var NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  var VARS = ['tmin', 'tmax', 'prec', 'prob', 'wind', 'gust'];
  var RANGE = { tmin: 20, tmax: 20, prec: 20, prob: 100, wind: 40, gust: 60 };
  var LIMITS = { tmin: [-60, 60], tmax: [-60, 60], prec: [0, 600], prob: [0, 100], wind: [0, 250], gust: [0, 400] };
  var PREC7 = [0, 0.1, 0.6, 2.5, 7, 13, 23, 40, 62, 80];
  var WIND7 = { 1: 0.15, 2: 1.9, 3: 5.7, 4: 9.4, 5: 14, 6: 20.9, 7: 28.5, 8: 35 };

  // ---------- utilità ----------
  var dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  function dayOf(d) { return dayFmt.format(d); }
  function num(x) { return (x === null || x === undefined || x === '') ? NaN : Number(x); }
  function ok(x) { return typeof x === 'number' && isFinite(x); }
  function red(arr, fn) { var a = arr.filter(ok); return a.length ? fn(a) : NaN; }
  function MIN(a) { return Math.min.apply(null, a); }
  function MAX(a) { return Math.max.apply(null, a); }
  function SUM(a) { return a.reduce(function (s, x) { return s + x; }, 0); }
  function MEAN(a) { return SUM(a) / a.length; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function row(date, tmin, tmax, prec, prob, wind, gust) {
    return { date: date, tmin: num(tmin), tmax: num(tmax), prec: num(prec), prob: num(prob), wind: num(wind), gust: num(gust) };
  }
  function windowDates() {
    var b = dayOf(new Date()).split('-').map(Number), out = [], i;
    for (i = 0; i < NDAYS; i++) out.push(dayFmt.format(new Date(Date.UTC(b[0], b[1] - 1, b[2] + i, 12))));
    return out;
  }
  function toDate(s) { var p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); }
  function fmtWd(d) { return new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(d).replace('.', ''); }
  function fmtDm(d) { return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace('.', ''); }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } }
  function getKeys() { try { return JSON.parse(lsGet('meteo.keys') || '{}'); } catch (e) { return {}; } }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function getJson(url, headers) {
    var attempt = 0;
    function go() {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
      return fetch(url, { signal: ctrl.signal, headers: headers || undefined })
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function (e) {
          clearTimeout(timer);
          if (attempt < RETRIES) { var w = Math.pow(2, attempt) * 1000; attempt++; return sleep(w).then(go); }
          throw new Error(e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'errore di rete');
        });
    }
    return go();
  }

  // ---------- fonti ----------
  function openMeteo(model) {
    var q = 'latitude=' + LAT + '&longitude=' + LON +
      '&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_mean,wind_speed_10m_max,wind_gusts_10m_max' +
      '&models=' + model + '&timezone=Europe%2FRome&forecast_days=' + NDAYS + '&wind_speed_unit=kmh';
    return getJson('https://api.open-meteo.com/v1/forecast?' + q).then(function (j) {
      var d = j.daily, out = [], i;
      function has(a) { return a && a.some(function (x) { return x !== null; }); }
      var wm = has(d.wind_speed_10m_mean) ? d.wind_speed_10m_mean : (d.wind_speed_10m_max || []);
      var pr = d.precipitation_probability_max || [];
      for (i = 0; i < d.time.length; i++) {
        out.push(row(d.time[i], d.temperature_2m_min[i], d.temperature_2m_max[i], d.precipitation_sum[i], pr[i], wm[i], d.wind_gusts_10m_max[i]));
      }
      return out;
    });
  }

  function metNo() {
    var url = 'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=' + LAT.toFixed(4) + '&lon=' + LON.toFixed(4);
    var headers = NATIVE ? { 'User-Agent': 'meteo-pieve-di-soligo-app/1.0' } : undefined;
    return getJson(url, headers).then(function (j) {
      var days = {};
      j.properties.timeseries.forEach(function (ts) {
        var day = dayOf(new Date(ts.time));
        var b = days[day] || (days[day] = { t: [], p: [], pr: [], w: [], g: [] });
        var det = ts.data.instant.details;
        b.t.push(num(det.air_temperature));
        b.w.push(num(det.wind_speed) * 3.6);
        b.g.push(num(det.wind_speed_of_gust) * 3.6);
        var n1 = ts.data.next_1_hours, n6 = ts.data.next_6_hours;
        if (n1) b.p.push(num(n1.details.precipitation_amount));
        else if (n6) b.p.push(num(n6.details.precipitation_amount));
        if (n6) b.pr.push(num(n6.details.probability_of_precipitation));
      });
      return Object.keys(days).sort().filter(function (d) { return days[d].t.length >= 4; }).map(function (d) {
        var b = days[d];
        return row(d, red(b.t, MIN), red(b.t, MAX), red(b.p, SUM), red(b.pr, MAX), red(b.w, MEAN), red(b.g, MAX));
      });
    });
  }

  function sevenTimer() {
    var url = 'https://www.7timer.info/bin/api.pl?lon=' + LON + '&lat=' + LAT + '&product=civil&output=json&unit=metric';
    return getJson(url).then(function (j) {
      var s = String(j.init);
      var init = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10));
      var days = {};
      j.dataseries.forEach(function (p) {
        var day = dayOf(new Date(init + p.timepoint * 3600000));
        var b = days[day] || (days[day] = { t: [], p: [], w: [] });
        b.t.push(num(p.temp2m));
        var cl = num(p.prec_amount);
        b.p.push((ok(cl) ? (PREC7[Math.min(Math.max(cl, 0), 9)] || 0) : 0) * 3);
        var ws = num(p.wind10m && p.wind10m.speed);
        b.w.push(ok(ws) && WIND7[ws] !== undefined ? WIND7[ws] * 3.6 : NaN);
      });
      return Object.keys(days).sort().filter(function (d) { return days[d].t.length >= 4; }).map(function (d) {
        var b = days[d];
        return row(d, red(b.t, MIN), red(b.t, MAX), red(b.p, SUM), NaN, red(b.w, MEAN), NaN);
      });
    });
  }

  function owm(key) {
    var url = 'https://api.openweathermap.org/data/2.5/forecast?lat=' + LAT + '&lon=' + LON + '&units=metric&appid=' + encodeURIComponent(key);
    return getJson(url).then(function (j) {
      var days = {};
      j.list.forEach(function (e) {
        var day = dayOf(new Date(e.dt * 1000));
        var b = days[day] || (days[day] = { tmin: [], tmax: [], p: [], pr: [], w: [], g: [] });
        b.tmin.push(num(e.main.temp_min));
        b.tmax.push(num(e.main.temp_max));
        var rain = e.rain ? num(e.rain['3h']) : 0, snow = e.snow ? num(e.snow['3h']) : 0;
        b.p.push((ok(rain) ? rain : 0) + (ok(snow) ? snow : 0));
        b.pr.push(num(e.pop) * 100);
        b.w.push(num(e.wind && e.wind.speed) * 3.6);
        b.g.push(num(e.wind && e.wind.gust) * 3.6);
      });
      return Object.keys(days).sort().filter(function (d) { return days[d].tmin.length >= 4; }).map(function (d) {
        var b = days[d];
        return row(d, red(b.tmin, MIN), red(b.tmax, MAX), red(b.p, SUM), red(b.pr, MAX), red(b.w, MEAN), red(b.g, MAX));
      });
    });
  }

  function weatherApi(key) {
    var url = 'https://api.weatherapi.com/v1/forecast.json?key=' + encodeURIComponent(key) + '&q=' + LAT + ',' + LON + '&days=' + NDAYS + '&aqi=no&alerts=no';
    return getJson(url).then(function (j) {
      return j.forecast.forecastday.map(function (fd) {
        var d = fd.day, hrs = fd.hour || [];
        var wind = hrs.length ? red(hrs.map(function (h) { return num(h.wind_kph); }), MEAN) : num(d.maxwind_kph);
        var gust = hrs.length ? red(hrs.map(function (h) { return num(h.gust_kph); }), MAX) : NaN;
        var prob = red([num(d.daily_chance_of_rain), num(d.daily_chance_of_snow)], MAX);
        return row(fd.date, d.mintemp_c, d.maxtemp_c, d.totalprecip_mm, prob, wind, gust);
      });
    });
  }

  function visualCrossing(key) {
    var url = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/' + LAT + ',' + LON +
      '/next7days?unitGroup=metric&include=days&contentType=json&key=' + encodeURIComponent(key);
    return getJson(url).then(function (j) {
      return j.days.map(function (d) { return row(d.datetime, d.tempmin, d.tempmax, d.precip, d.precipprob, d.windspeed, d.windgust); });
    });
  }

  function tomorrow(key) {
    var url = 'https://api.tomorrow.io/v4/weather/forecast?location=' + LAT + ',' + LON + '&timesteps=1d&units=metric&apikey=' + encodeURIComponent(key);
    return getJson(url).then(function (j) {
      return j.timelines.daily.map(function (e) {
        var v = e.values;
        var prec = v.rainAccumulationSum !== undefined ? v.rainAccumulationSum : v.rainAccumulationAvg;
        var prob = v.precipitationProbabilityMax !== undefined ? v.precipitationProbabilityMax : v.precipitationProbabilityAvg;
        return row(dayOf(new Date(e.time)), v.temperatureMin, v.temperatureMax, prec, prob, num(v.windSpeedAvg) * 3.6, num(v.windGustMax) * 3.6);
      });
    });
  }

  var SOURCES = [
    { id: 'ecmwf', name: 'Open-Meteo · ECMWF IFS', run: function () { return openMeteo('ecmwf_ifs025'); } },
    { id: 'icon', name: 'Open-Meteo · DWD ICON', run: function () { return openMeteo('icon_seamless'); } },
    { id: 'gfs', name: 'Open-Meteo · NOAA GFS', run: function () { return openMeteo('gfs_seamless'); } },
    { id: 'arpege', name: 'Open-Meteo · Météo-France ARPEGE', run: function () { return openMeteo('meteofrance_seamless'); } },
    { id: 'metno', name: 'MET Norway', run: metNo },
    { id: '7timer', name: '7Timer', run: sevenTimer },
    { id: 'owm', name: 'OpenWeatherMap', key: 'owm', run: owm },
    { id: 'wapi', name: 'WeatherAPI', key: 'wapi', run: weatherApi },
    { id: 'vc', name: 'Visual Crossing', key: 'vc', run: visualCrossing },
    { id: 'tio', name: 'Tomorrow.io', key: 'tio', run: tomorrow }
  ];

  function valid(rows) {
    if (!rows || !rows.length) return false;
    var any = false;
    for (var i = 0; i < rows.length; i++) {
      for (var k = 0; k < VARS.length; k++) {
        var v = rows[i][VARS[k]];
        if (ok(v)) { if (v < LIMITS[VARS[k]][0] || v > LIMITS[VARS[k]][1]) return false; if (k < 2) any = true; }
      }
    }
    return any;
  }
  function readCache(id) {
    try {
      var c = JSON.parse(lsGet('meteo.c.' + id) || 'null');
      if (!c) return null;
      return { t: c.t, rows: c.rows.map(function (r) { return row(r.date, r.tmin, r.tmax, r.prec, r.prob, r.wind, r.gust); }) };
    } catch (e) { return null; }
  }
  function load(src, force) {
    var keys = getKeys();
    if (src.key && !keys[src.key]) return Promise.resolve({ src: src, status: 'nokey', rows: [] });
    var c = readCache(src.id), now = Date.now();
    if (c && !force && now - c.t < TTL && valid(c.rows)) return Promise.resolve({ src: src, status: 'ok', rows: c.rows, t: c.t });
    return src.run(src.key ? keys[src.key] : undefined).then(function (rows) {
      if (!valid(rows)) throw new Error('dati vuoti o fuori intervallo');
      lsSet('meteo.c.' + src.id, JSON.stringify({ t: now, rows: rows }));
      return { src: src, status: 'ok', rows: rows, t: now };
    }).catch(function (e) {
      if (c && valid(c.rows)) return { src: src, status: 'stale', rows: c.rows, t: c.t, error: e.message };
      return { src: src, status: 'err', rows: [], error: e.message };
    });
  }

  // ---------- stato e aggregazione ----------
  var state = { dates: [], results: [], frames: {}, ids: [], sel: 0, mode: 'mean', A: null, loading: false, last: null };

  function val(id, d, v) {
    var r = state.frames[id] && state.frames[id][state.dates[d]];
    return r ? r[v] : NaN;
  }
  function median(a) {
    var s = a.filter(ok).sort(function (x, y) { return x - y; });
    if (!s.length) return NaN;
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function aggregate(ids) {
    var days = [], weights = {}, d;
    for (d = 0; d < NDAYS; d++) days.push({ agr: [], n: 0 });
    VARS.forEach(function (v) {
      var piv = [];
      for (d = 0; d < NDAYS; d++) piv.push(ids.map(function (id) { return val(id, d, v); }));
      var med = piv.map(median);
      var w = ids.map(function (id, k) {
        var s = 0, c = 0, dd;
        for (dd = 0; dd < NDAYS; dd++) { var x = piv[dd][k]; if (ok(x) && ok(med[dd])) { s += Math.pow(x - med[dd], 2); c++; } }
        return c ? 1 / (Math.max(s / c, 0.25) + 1e-6) : 0;
      });
      weights[v] = w;
      for (d = 0; d < NDAYS; d++) {
        var xs = piv[d], num_ = 0, den = 0, vals = [], k;
        for (k = 0; k < xs.length; k++) if (ok(xs[k])) { num_ += w[k] * xs[k]; den += w[k]; vals.push(xs[k]); }
        var sd = NaN;
        if (vals.length) { var mu = MEAN(vals); sd = Math.sqrt(SUM(vals.map(function (x) { return Math.pow(x - mu, 2); })) / vals.length); }
        days[d][v] = { mean: den > 0 ? num_ / den : NaN, med: median(xs), min: vals.length ? MIN(vals) : NaN, max: vals.length ? MAX(vals) : NaN, sd: sd, n: vals.length };
        days[d].n = Math.max(days[d].n, vals.length);
        if (vals.length >= 2) days[d].agr.push(1 - Math.min(1, sd / RANGE[v]));
      }
    });
    days.forEach(function (o) { o.agreement = o.agr.length ? 100 * MEAN(o.agr) : NaN; });
    return { days: days, weights: weights };
  }

  // ---------- interfaccia ----------
  function pick(o) { return state.mode === 'mean' ? o.mean : o.med; }
  function f(x, nd) { return ok(x) ? x.toFixed(nd === undefined ? 1 : nd).replace('.', ',') : 'n/d'; }
  function cls(a) { return !ok(a) ? 'off' : a >= 85 ? 'ok' : a >= 65 ? 'warn' : 'bad'; }
  function lab(a) { return !ok(a) ? 'n/d' : a >= 85 ? 'Alto' : a >= 65 ? 'Medio' : 'Basso'; }
  function $(id) { return document.getElementById(id); }

  function renderDays(A) {
    var h = '';
    A.days.forEach(function (o, i) {
      var t = toDate(state.dates[i]);
      h += '<button type="button" class="day" data-d="' + i + '" aria-pressed="' + (i === state.sel) + '">' +
        '<span class="dn">' + fmtWd(t) + '</span><span class="dd">' + fmtDm(t) + '</span>' +
        '<span class="tt"><span class="tmax">' + f(pick(o.tmax), 0) + '°</span><span class="tmin">' + f(pick(o.tmin), 0) + '°</span></span>' +
        '<span class="rr">' + f(pick(o.prec)) + ' mm · ' + f(pick(o.prob), 0) + '%</span>' +
        '<span class="pill ' + cls(o.agreement) + '">Accordo ' + lab(o.agreement) + '</span></button>';
    });
    $('days').innerHTML = h;
  }

  function renderChart(A) {
    var W = 720, H = 280, L = 40, R = 16, T = 16, B = 36, mn = Infinity, mx = -Infinity;
    A.days.forEach(function (o) {
      ['tmin', 'tmax'].forEach(function (v) { if (ok(o[v].min)) mn = Math.min(mn, o[v].min); if (ok(o[v].max)) mx = Math.max(mx, o[v].max); });
    });
    if (!isFinite(mn) || !isFinite(mx)) { $('chart').innerHTML = '<div class="empty">Nessun dato di temperatura.</div>'; return; }
    var lo = Math.floor(mn / 2) * 2 - 2, hi = Math.ceil(mx / 2) * 2 + 2;
    function X(d) { return L + (W - L - R) * (d + 0.5) / NDAYS; }
    function Y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    var bw = (W - L - R) / NDAYS;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Temperature minime e massime per giorno con intervallo tra fonti">', t;
    for (t = lo; t <= hi; t += 2) s += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/><text class="ax" x="' + (L - 8) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + t + '°</text>';
    s += '<rect x="' + (X(state.sel) - bw / 2) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="var(--sel)"/>';
    [['tmax', 'var(--tmax)'], ['tmin', 'var(--tmin)']].forEach(function (p) {
      var pts = [];
      A.days.forEach(function (o, d) {
        var c = o[p[0]]; if (!ok(c.min)) return;
        s += '<rect x="' + (X(d) - 6) + '" y="' + Y(c.max) + '" width="12" height="' + Math.max(2, Y(c.min) - Y(c.max)) + '" rx="3" fill="' + p[1] + '" fill-opacity="0.35"/>';
        pts.push(X(d) + ',' + Y(pick(c)));
      });
      s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + p[1] + '" stroke-width="2"/>';
      A.days.forEach(function (o, d) { var c = o[p[0]]; if (ok(pick(c))) s += '<circle cx="' + X(d) + '" cy="' + Y(pick(c)) + '" r="4" fill="' + p[1] + '" stroke="var(--surface)" stroke-width="2"/>'; });
    });
    A.days.forEach(function (o, d) {
      var dt = toDate(state.dates[d]);
      s += '<text class="ax" x="' + X(d) + '" y="' + (H - 14) + '" text-anchor="middle">' + fmtWd(dt) + ' ' + dt.getUTCDate() + '</text>';
      s += '<rect data-d="' + d + '" x="' + (X(d) - bw / 2) + '" y="' + T + '" width="' + bw + '" height="' + (H - T) + '" fill="transparent" style="cursor:pointer"/>';
    });
    $('chart').innerHTML = s + '</svg>';
  }

  function renderTable(A) {
    var h = '<thead><tr><th>Data</th><th>Tmin</th><th>Tmax</th><th>Pioggia mm</th><th>Prob. %</th><th>Vento km/h</th><th>Raffica km/h</th><th>Accordo</th><th>Fonti</th></tr></thead><tbody>';
    A.days.forEach(function (o, i) {
      var dt = toDate(state.dates[i]);
      h += '<tr data-d="' + i + '" class="' + (i === state.sel ? 'sel' : '') + '"><td>' +
        new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(dt) + '</td>' +
        '<td>' + f(pick(o.tmin)) + '</td><td>' + f(pick(o.tmax)) + '</td><td>' + f(pick(o.prec)) + '</td><td>' + f(pick(o.prob), 0) + '</td>' +
        '<td>' + f(pick(o.wind)) + '</td><td>' + f(pick(o.gust)) + '</td>' +
        '<td><span class="pill ' + cls(o.agreement) + '">' + (ok(o.agreement) ? o.agreement.toFixed(0) + '%' : 'n/d') + '</span></td><td>' + o.n + '</td></tr>';
    });
    $('tbl').innerHTML = h + '</tbody>';
  }

  function renderSources(A) {
    var d = state.sel, t = toDate(state.dates[d]), cons = pick(A.days[d].tmax);
    $('srch').textContent = 'Dettaglio fonti · Tmax ' + fmtWd(t) + ' ' + fmtDm(t);
    var h = '<div class="srchead"><span>Fonte</span><span>Tmax</span><span>Scarto</span></div>';
    state.results.forEach(function (r) {
      var used = state.ids.indexOf(r.src.id) >= 0;
      var x = used ? val(r.src.id, d, 'tmax') : NaN;
      var delta = ok(x) && ok(cons) ? x - cons : NaN;
      var note = r.status === 'ok' ? 'in uso' : r.status === 'stale' ? 'dati salvati (' + esc(r.error || 'offline') + ')' :
        r.status === 'nokey' ? 'serve una chiave API' : 'non disponibile: ' + esc(r.error || 'errore');
      if (used && !ok(x)) note += ' · nessun dato per questo giorno';
      h += '<div class="src' + (used ? '' : ' off') + '"><div class="nm">' + esc(r.src.name) + '<small>' + note + '</small></div>' +
        '<div class="v tmax">' + (ok(x) ? f(x) + '°' : 'n/d') + '</div>' +
        '<div class="v">' + (ok(delta) ? (delta > 0 ? '+' : '') + f(delta) : 'n/d') + '</div></div>';
    });
    $('srcs').innerHTML = h;
  }

  function render() {
    state.ids = state.results.filter(function (r) { return r.rows.length; }).map(function (r) { return r.src.id; });
    var okc = state.results.filter(function (r) { return r.status === 'ok'; }).length;
    var stale = state.results.filter(function (r) { return r.status === 'stale'; }).length;
    if (state.loading) { $('lead').textContent = 'Aggiorno le fonti...'; }
    else if (!state.ids.length) { $('lead').textContent = 'Nessuna fonte raggiungibile. Controlla la connessione.'; }
    else {
      var hh = state.last ? new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(state.last) : '';
      $('lead').textContent = 'Consenso tra ' + state.ids.length + ' fonti' + (stale ? ' (' + stale + ' da dati salvati)' : '') + ' · aggiornato alle ' + hh;
    }
    if (!state.ids.length) {
      $('days').innerHTML = ''; $('tbl').innerHTML = '';
      $('chart').innerHTML = '<div class="empty">' + (state.loading ? 'Caricamento...' : 'Nessun dato disponibile.') + '</div>';
      renderSources({ days: [{ tmax: {} }] });
      return;
    }
    state.A = aggregate(state.ids);
    renderDays(state.A); renderChart(state.A); renderTable(state.A); renderSources(state.A);
    void okc;
  }

  function refresh(force) {
    if (state.loading) return;
    state.loading = true;
    $('refresh').disabled = true;
    state.dates = windowDates();
    render();
    Promise.all(SOURCES.map(function (s) { return load(s, force); })).then(function (res) {
      state.results = res;
      state.frames = {};
      res.forEach(function (r) {
        var m = {};
        r.rows.forEach(function (x) { m[x.date] = x; });
        state.frames[r.src.id] = m;
      });
      state.last = new Date();
      state.loading = false;
      $('refresh').disabled = false;
      render();
    });
  }

  function setSel(e) {
    var el = e.target.closest('[data-d]');
    if (!el || !state.A) return;
    state.sel = Number(el.getAttribute('data-d'));
    render();
  }
  $('days').addEventListener('click', setSel);
  $('chart').addEventListener('click', setSel);
  $('tbl').addEventListener('click', setSel);
  $('refresh').addEventListener('click', function () { refresh(true); });
  function setMode(m) {
    state.mode = m;
    $('m-mean').setAttribute('aria-pressed', String(m === 'mean'));
    $('m-med').setAttribute('aria-pressed', String(m === 'med'));
    if (state.A) render();
  }
  $('m-mean').addEventListener('click', function () { setMode('mean'); });
  $('m-med').addEventListener('click', function () { setMode('med'); });

  var ids = { owm: 'k-owm', wapi: 'k-wapi', vc: 'k-vc', tio: 'k-tio' };
  (function fillKeys() { var k = getKeys(); Object.keys(ids).forEach(function (n) { $(ids[n]).value = k[n] || ''; }); })();
  $('keys').addEventListener('submit', function (e) {
    e.preventDefault();
    var k = {};
    Object.keys(ids).forEach(function (n) { var v = $(ids[n]).value.trim(); if (v) k[n] = v; });
    lsSet('meteo.keys', JSON.stringify(k));
    $('settings').open = false;
    refresh(false);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.last && Date.now() - state.last.getTime() > TTL) refresh(false);
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !NATIVE) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* facoltativo */ });
  }

  state.dates = windowDates();
  refresh(false);
})();
