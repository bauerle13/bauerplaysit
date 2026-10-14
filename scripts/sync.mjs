// Nightly sync: YouTube uploads + playlists, Google Sheet series/mods, Paradox Mods details, Discord counts.
// Writes data/site-data.json. Any source that fails keeps its previous data instead of blanking the site.

import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const CONFIG_PATH = new URL('config/site.json', ROOT);
const OUT_PATH = new URL('data/site-data.json', ROOT);
const UA = { 'User-Agent': 'Mozilla/5.0 (bauerplaysit.com sync)' };

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const previous = await readFile(OUT_PATH, 'utf8').then(JSON.parse).catch(() => ({}));
const warnings = [];

const warn = (msg) => { warnings.push(msg); console.warn('WARN', msg); };

async function getText(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// ---------- YouTube ----------

async function resolveChannelId() {
  if (process.env.YOUTUBE_CHANNEL_ID) return process.env.YOUTUBE_CHANNEL_ID;
  if (config.youtubeChannelId) return config.youtubeChannelId;
  if (previous.channel?.id) return previous.channel.id;
  const html = await getText(`https://www.youtube.com/@${config.youtubeHandle}`);
  const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/);
  if (!m) throw new Error('Could not find channel ID on the @handle page');
  return m[1];
}

const decode = (s = '') => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function parseFeed(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const pick = (re) => decode(e.match(re)?.[1] ?? '');
    const id = pick(/<yt:videoId>(.*?)<\/yt:videoId>/);
    const link = pick(/<link rel="alternate" href="(.*?)"/);
    return {
      id,
      title: pick(/<title>([\s\S]*?)<\/title>/),
      published: pick(/<published>(.*?)<\/published>/),
      url: link || `https://www.youtube.com/watch?v=${id}`,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      views: Number(pick(/<media:statistics views="(\d+)"/)) || null,
      isShort: link.includes('/shorts/')
    };
  });
  const title = decode(xml.match(/<title>(.*?)<\/title>/)?.[1] ?? '');
  return { title, entries };
}

async function fetchChannel() {
  const id = await resolveChannelId();
  const feed = parseFeed(await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`));
  return {
    channel: { id, title: feed.title, url: `https://www.youtube.com/@${config.youtubeHandle}` },
    videos: feed.entries.filter((v) => !v.isShort),
    shorts: feed.entries.filter((v) => v.isShort)
  };
}

async function fetchPlaylist(playlistId) {
  const feed = parseFeed(await getText(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`));
  return { title: feed.title, videos: feed.entries.filter((v) => !v.isShort) };
}

// ---------- Google Sheet ----------

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows;
  const keys = header.map((h) => h.trim().toLowerCase());
  return body
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

async function fetchTab(tab) {
  const sheetId = process.env.SHEET_ID || config.sheetId;
  if (!sheetId) throw new Error('No sheetId set in config/site.json');
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  return parseCsv(await getText(url));
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const playlistIdFrom = (url = '') => url.match(/[?&]list=([\w-]+)/)?.[1] || (/^PL[\w-]+$/.test(url) ? url : '');
const modIdFrom = (url = '') => url.match(/\/mods\/(\d+)/)?.[1] || (/^\d+$/.test(url) ? url : '');

// ---------- Paradox Mods ----------

const PDX = 'https://api.paradox-interactive.com/mods';
const playsetIdFrom = (url = '') => url.match(/playsets\/[\w-]+\/(\d+)/)?.[1] || '';

async function pdxJson(url) {
  const res = await fetch(url, { headers: UA });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.result !== 'OK') {
    throw new Error(body.errorCode === 'not-authorized'
      ? 'playset is private, set it to Public on Paradox Mods'
      : body.errorMessage || `HTTP ${res.status}`);
  }
  return body;
}

const toMod = (d) => ({
  id: String(d.modId),
  url: `https://mods.paradoxplaza.com/mods/${d.modId}/Windows`,
  name: d.displayName || `Mod ${d.modId}`,
  author: d.author || '',
  summary: d.shortDescription || '',
  version: d.userModVersion || '',
  updated: d.latestModUpdate || d.updated || '',
  thumb: d.displayImagePath || '',
  tags: d.tags || []
});

async function fetchPlayset(id) {
  const set = await pdxJson(`${PDX}/sets/${id}`);
  const version = set.latestPublicVersion || 1;
  const list = await pdxJson(`${PDX}/sets/${id}/mods?limit=10000&page=1&version=${version}`);
  return (list.mods || []).filter((m) => m.state === 'published' && m.enabled !== false).map(toMod);
}

async function fetchMod(id) {
  const body = await pdxJson(`${PDX}?modId=${id}&os=Windows`);
  return toMod({ ...body.modDetail, modId: id });
}

// ---------- Discord ----------

async function fetchDiscord() {
  const code = config.discordInvite;
  const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, { headers: UA });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  const j = await res.json();
  const g = j.guild || {};
  return {
    invite: `https://discord.gg/${code}`,
    name: g.name || '',
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : '',
    members: j.approximate_member_count ?? null,
    online: j.approximate_presence_count ?? null
  };
}

// ---------- Run ----------

const out = {
  generatedAt: new Date().toISOString(),
  channel: previous.channel || { url: `https://www.youtube.com/@${config.youtubeHandle}` },
  videos: previous.videos || [],
  shorts: previous.shorts || [],
  series: previous.series || [],
  mods: previous.mods || [],
  discord: previous.discord || { invite: `https://discord.gg/${config.discordInvite}` },
  patreonUrl: process.env.PATREON_URL || config.patreonUrl || ''
};

try {
  Object.assign(out, await fetchChannel());
  console.log(`YouTube: ${out.videos.length} videos, ${out.shorts.length} shorts`);
} catch (e) { warn(`YouTube channel: ${e.message}`); }

try {
  out.discord = await fetchDiscord();
  console.log(`Discord: ${out.discord.members} members`);
} catch (e) { warn(`Discord: ${e.message}`); }

let seriesRows = null, modRows = null;
try {
  seriesRows = await fetchTab(config.sheetTabs.series);
  modRows = await fetchTab(config.sheetTabs.mods);
  console.log(`Sheet: ${seriesRows.length} series, ${modRows.length} mod rows`);
} catch (e) { warn(`Google Sheet: ${e.message}`); }

if (seriesRows && modRows) {
  const prevSeries = Object.fromEntries((previous.series || []).map((s) => [s.slug, s]));
  const prevMods = Object.fromEntries((previous.mods || []).map(({ series: _s, notes: _n, ...m }) => [m.id, m]));
  const mods = new Map();
  const series = [];

  const addMod = (mod, s, note) => {
    const m = mods.get(mod.id) || { ...mod, series: [], notes: {} };
    if (!m.series.includes(s.slug)) m.series.push(s.slug);
    if (note) m.notes[s.slug] = note;
    mods.set(mod.id, m);
    s.modIds.push(mod.id);
  };

  for (const row of seriesRows) {
    const name = row['series'];
    if (!name) continue;
    const s = {
      slug: slug(name),
      name,
      status: row['status'] || 'Active',
      description: row['description'] || '',
      playlistId: playlistIdFrom(row['playlist url']),
      playlistUrl: '',
      videos: prevSeries[slug(name)]?.videos || [],
      modIds: []
    };
    if (s.playlistId) {
      s.playlistUrl = `https://www.youtube.com/playlist?list=${s.playlistId}`;
      try { s.videos = (await fetchPlaylist(s.playlistId)).videos; }
      catch (e) { warn(`Playlist "${name}": ${e.message}`); }
    }

    for (const row of modRows.filter((r) => slug(r['series'] || '') === s.slug)) {
      const link = row['mod url'] || '';
      const setId = playsetIdFrom(link);
      const modId = setId ? '' : modIdFrom(link);
      try {
        if (setId) {
          const list = await fetchPlayset(setId);
          console.log(`Playset for "${name}": ${list.length} mods`);
          list.forEach((mod) => addMod(mod, s));
        } else if (modId) {
          addMod(await fetchMod(modId), s, row['note']);
          await new Promise((r) => setTimeout(r, 250));
        } else if (link) {
          warn(`"${name}": not a Paradox Mods mod or playset link: ${link}`);
        }
      } catch (e) {
        warn(`"${name}" ${setId ? 'playset' : 'mod'}: ${e.message} (kept last good list)`);
        const keep = setId ? prevSeries[s.slug]?.modIds || [] : [modId];
        keep.forEach((id) => prevMods[id] && addMod(prevMods[id], s));
      }
    }
    s.modIds = [...new Set(s.modIds)];
    series.push(s);
  }

  const known = new Set(series.map((s) => s.slug));
  for (const row of modRows) {
    if (row['series'] && !known.has(slug(row['series']))) warn(`Mods tab: "${row['series']}" doesn't match any name on the Series tab`);
  }

  out.series = series;
  out.mods = [...mods.values()].sort((a, b) => a.name.localeCompare(b.name));
}

out.warnings = warnings;

const strip = ({ generatedAt, warnings: _w, ...rest }) => JSON.stringify(rest);
if (strip(out) === strip(previous)) {
  console.log('No content changes.');
} else {
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log('Wrote data/site-data.json');
}